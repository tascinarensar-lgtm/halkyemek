from datetime import timedelta
from unittest.mock import patch

import requests
from django.test import TestCase, override_settings
from django.utils import timezone

from orders.models import Order
from payouts.models import BusinessEarning, Payout
from payouts.services import PayoutService
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


class _FakeResponse:
    def __init__(self, *, status_code=200, data=None, text="", headers=None):
        self.status_code = status_code
        self._data = data or {}
        self.text = text or str(self._data)
        self.headers = headers or {}

    def json(self):
        return self._data


@override_settings(
    PAYOUT_PROVIDER="iyzico_marketplace",
    IYZICO_API_KEY="sandbox-key",
    IYZICO_SECRET_KEY="sandbox-secret",
    IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
)
class IyzicoMarketplacePayoutProviderTests(TestCase):
    def setUp(self):
        self.customer = create_user(username="customer")
        self.business = create_business(name="Biz")
        self.business.iyzico_submerchant_key = "subm-123"
        self.business.payout_onboarding_status = "APPROVED"
        self.business.kyc_iban = "TR330006100519786457841326"
        self.business.save(update_fields=["iyzico_submerchant_key", "payout_onboarding_status", "kyc_iban"])
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=100)
        seed_wallet(user=self.customer, amount=1000)

        order = Order.objects.create(user=self.customer, business=self.business, menu=self.menu_item, amount=100, status=Order.Status.CREATED)
        WalletService.purchase(user=self.customer, amount=100, description="buy", order=order)
        order.mark_paid(ttl_hours=24)
        order.save(update_fields=["status", "paid_at", "expires_at", "qr_token"])
        BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=100,
            platform_fee_amount=0,
            net_amount=100,
            currency="TRY",
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.ELIGIBLE,
        )
        self.batch = PayoutService.create_batch_for_eligible()
        self.payout = Payout.objects.get(batch=self.batch)



    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_moves_to_sent_when_init_external_id_is_stale(self, mock_request):
        mock_request.return_value = _FakeResponse(
            data={"status": "success", "requestId": "req-123", "externalId": "STALE-REF"}
        )

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.provider_payout_id, "req-123")
        self.assertEqual(self.payout.last_error_code, "INIT_EXTERNAL_ID_MISMATCH")
        self.assertIn("stage", self.payout.provider_dispatch_payload)

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_persists_invalid_json_snapshot(self, mock_request):
        class _InvalidJsonResponse(_FakeResponse):
            def json(self):
                raise ValueError("boom")

        mock_request.return_value = _InvalidJsonResponse(status_code=502, text="<html>bad gateway</html>")

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(self.payout.last_error_code, "INVALID_JSON")
        self.assertIn("response_text", self.payout.provider_dispatch_payload.get("error", {}))

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_sync_sent_payout_statuses_marks_manual_review_on_duplicate_item_external_id(self, mock_request):
        earning = self.payout.items.select_related("earning").get().earning
        self.payout.status = "SENT"
        self.payout.provider_payout_id = "req-123"
        self.payout.sent_at = timezone.now()
        self.payout.save(update_fields=["status", "provider_payout_id", "sent_at"])

        mock_request.return_value = _FakeResponse(
            data={
                "status": "success",
                "requestId": "req-123",
                "externalMassPayoutId": self.payout.provider_reference,
                "massPayout": {"massPayoutStatus": "COMPLETED"},
                "massPayoutItems": {
                    "items": [
                        {"itemExternalId": self.payout.provider_reference, "itemStatus": "SUCCESS", "referenceCode": "item-1"},
                        {"itemExternalId": self.payout.provider_reference, "itemStatus": "SUCCESS", "referenceCode": "item-2"},
                    ]
                },
            }
        )

        processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(self.payout.last_error_code, "PROVIDER_STATUS_EXCEPTION")
        self.assertEqual(earning.status, BusinessEarning.Status.ELIGIBLE)

    @override_settings(IYZICO_MASS_PAYOUT_LOCALE="de")
    def test_dispatch_due_payouts_fails_fast_on_invalid_locale_config(self):
        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(self.payout.last_error_code, "PROVIDER_EXCEPTION")
        self.assertIn("iyzico.invalid_mass_payout_locale", self.payout.provider_error)

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_moves_to_sent_when_auth_request_id_mismatch(self, mock_request):
        mock_request.side_effect = [
            _FakeResponse(data={"status": "success", "requestId": "req-123"}),
            _FakeResponse(data={"status": "success", "requestId": "req-999"}),
        ]

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.provider_payout_id, "req-123")
        self.assertEqual(self.payout.last_error_code, "AUTH_REQUEST_ID_MISMATCH")

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_sync_sent_payout_statuses_marks_manual_review_on_request_id_mismatch(self, mock_request):
        self.payout.status = "SENT"
        self.payout.provider_payout_id = "req-123"
        self.payout.sent_at = timezone.now()
        self.payout.save(update_fields=["status", "provider_payout_id", "sent_at"])

        mock_request.return_value = _FakeResponse(
            data={
                "status": "success",
                "requestId": "req-999",
                "externalMassPayoutId": self.payout.provider_reference,
                "massPayout": {"massPayoutStatus": "COMPLETED"},
                "massPayoutItems": {"items": []},
            }
        )

        processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(self.payout.last_error_code, "REQUEST_ID_MISMATCH")


    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_sync_sent_payout_statuses_fails_on_missing_mass_payout_status(self, mock_request):
        self.payout.status = "SENT"
        self.payout.provider_payout_id = "req-123"
        self.payout.sent_at = timezone.now()
        self.payout.save(update_fields=["status", "provider_payout_id", "sent_at"])

        mock_request.return_value = _FakeResponse(
            data={
                "status": "success",
                "requestId": "req-123",
                "externalMassPayoutId": self.payout.provider_reference,
                "massPayout": {},
                "massPayoutItems": {"items": []},
            }
        )

        processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(self.payout.last_error_code, "MASS_PAYOUT_STATUS_MISSING")

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_calls_mass_payout_init_and_auth(self, mock_request):
        mock_request.side_effect = [
            _FakeResponse(data={"status": "success", "requestId": "req-123"}),
            _FakeResponse(data={"status": "success"}),
        ]

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.batch.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.provider_payout_id, "req-123")
        self.assertIn("init_response", self.payout.provider_dispatch_payload)
        self.assertIn("auth_response", self.payout.provider_dispatch_payload)
        self.assertEqual(self.batch.external_batch_id, "req-123")
        self.assertEqual(mock_request.call_count, 2)

        init_payload = mock_request.call_args_list[0].kwargs["data"].decode("utf-8")
        auth_payload = mock_request.call_args_list[1].kwargs["data"].decode("utf-8")
        self.assertIn('"externalId":"HY-PAYOUT-', init_payload)
        self.assertIn('"recipientType":"IBAN"', init_payload)
        self.assertIn('"requestId":"req-123"', auth_payload)

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_sync_sent_payout_statuses_confirms_successful_item(self, mock_request):
        self.payout.status = "SENT"
        self.payout.provider_payout_id = "req-123"
        self.payout.sent_at = timezone.now()
        self.payout.save(update_fields=["status", "provider_payout_id", "sent_at"])

        mock_request.return_value = _FakeResponse(
            data={
                "status": "success",
                "massPayout": {"massPayoutStatus": "COMPLETED"},
                "massPayoutItems": {
                    "items": [
                        {
                            "itemExternalId": self.payout.provider_reference,
                            "referenceCode": "item-ref-1",
                            "itemStatus": "SUCCESS",
                            "errorMessages": [],
                        }
                    ]
                },
            }
        )

        processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        earning = self.payout.items.select_related("earning").get().earning
        earning.refresh_from_db()
        self.assertEqual(self.payout.status, "CONFIRMED")
        self.assertEqual(earning.status, BusinessEarning.Status.PAID)
        self.assertEqual(self.payout.confirm_source, "provider_status_sync")
        self.assertEqual(self.payout.provider_item_reference_code, "item-ref-1")
        self.assertIn("massPayout", self.payout.provider_status_payload)

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_sync_sent_payout_statuses_reopens_earning_on_final_failure(self, mock_request):
        earning = self.payout.items.select_related("earning").get().earning
        self.payout.status = "SENT"
        self.payout.provider_payout_id = "req-123"
        self.payout.sent_at = timezone.now()
        self.payout.save(update_fields=["status", "provider_payout_id", "sent_at"])

        mock_request.return_value = _FakeResponse(
            data={
                "status": "success",
                "massPayout": {"massPayoutStatus": "FAIL"},
                "massPayoutItems": {
                    "items": [
                        {
                            "itemExternalId": self.payout.provider_reference,
                            "referenceCode": "item-ref-1",
                            "itemStatus": "FAILED",
                            "errorMessages": ["bank rejected"],
                        }
                    ]
                },
            }
        )

        processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(earning.status, BusinessEarning.Status.ELIGIBLE)
        self.assertEqual(self.payout.last_error_code, "FAILED")
        self.assertIn("massPayout", self.payout.provider_status_payload)

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_sync_sent_payout_statuses_marks_manual_review_on_final_item_missing_inconsistency(self, mock_request):
        earning = self.payout.items.select_related("earning").get().earning
        self.payout.status = "SENT"
        self.payout.provider_payout_id = "req-123"
        self.payout.sent_at = timezone.now()
        self.payout.save(update_fields=["status", "provider_payout_id", "sent_at"])

        mock_request.return_value = _FakeResponse(
            data={
                "status": "success",
                "massPayout": {"massPayoutStatus": "COMPLETED"},
                "massPayoutItems": {
                    "items": [
                        {
                            "itemExternalId": "SOME-OTHER-ITEM",
                            "referenceCode": "item-ref-2",
                            "itemStatus": "SUCCESS",
                            "errorMessages": [],
                        }
                    ]
                },
            }
        )

        processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.last_error_code, "STATUS_SYNC_PROVIDER_INCONSISTENT")
        self.assertTrue(self.payout.provider_status_payload.get("manual_review_required"))
        self.assertTrue(self.payout.provider_status_payload.get("provider_inconsistency"))
        self.assertEqual(earning.status, BusinessEarning.Status.IN_PAYOUT)


    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_sync_sent_payout_statuses_skips_not_due_retry(self, mock_request):
        self.payout.status = "SENT"
        self.payout.provider_payout_id = "req-123"
        self.payout.sent_at = timezone.now()
        self.payout.next_retry_at = timezone.now() + timedelta(minutes=30)
        self.payout.save(update_fields=["status", "provider_payout_id", "sent_at", "next_retry_at"])

        processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 0)
        mock_request.assert_not_called()

    @override_settings(PAYOUT_STATUS_SYNC_MAX_ATTEMPTS=1)
    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_sync_sent_payout_statuses_keeps_sent_for_manual_review_on_retry_exhaustion(self, mock_request):
        earning = self.payout.items.select_related("earning").get().earning
        self.payout.status = "SENT"
        self.payout.provider_payout_id = "req-123"
        self.payout.sent_at = timezone.now()
        self.payout.save(update_fields=["status", "provider_payout_id", "sent_at"])

        mock_request.return_value = _FakeResponse(
            data={
                "status": "success",
                "massPayout": {"massPayoutStatus": "IN_PROGRESS"},
                "massPayoutItems": {
                    "items": [
                        {
                            "itemExternalId": self.payout.provider_reference,
                            "referenceCode": "item-ref-1",
                            "itemStatus": "PROCESSING",
                            "errorMessages": [],
                        }
                    ]
                },
            }
        )

        processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.last_error_code, "STATUS_SYNC_RETRY_EXHAUSTED")
        self.assertEqual(self.payout.status_sync_attempt_count, 1)
        self.assertIsNone(self.payout.next_retry_at)
        self.assertTrue(self.payout.provider_status_payload.get("manual_review_required"))
        self.assertEqual(earning.status, BusinessEarning.Status.IN_PAYOUT)


    @override_settings(PAYOUT_STATUS_SYNC_MAX_ATTEMPTS=1)
    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_sync_sent_payout_statuses_uses_status_sync_attempt_budget(self, mock_request):
        self.payout.status = "SENT"
        self.payout.provider_payout_id = "req-123"
        self.payout.sent_at = timezone.now()
        self.payout.attempt_count = 7
        self.payout.status_sync_attempt_count = 0
        self.payout.save(update_fields=["status", "provider_payout_id", "sent_at", "attempt_count", "status_sync_attempt_count"])

        mock_request.return_value = _FakeResponse(
            data={
                "status": "success",
                "massPayout": {"massPayoutStatus": "IN_PROGRESS"},
                "massPayoutItems": {
                    "items": [
                        {
                            "itemExternalId": self.payout.provider_reference,
                            "referenceCode": "item-ref-1",
                            "itemStatus": "PROCESSING",
                            "errorMessages": [],
                        }
                    ]
                },
            }
        )

        processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.attempt_count, 7)
        self.assertEqual(self.payout.status_sync_attempt_count, 1)
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.last_error_code, "STATUS_SYNC_RETRY_EXHAUSTED")
        self.assertIsNone(self.payout.next_retry_at)


    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_moves_to_sent_when_auth_timeout_after_request_id(self, mock_request):
        mock_request.side_effect = [
            _FakeResponse(data={"status": "success", "requestId": "req-123"}),
            requests.Timeout("provider timeout after init"),
            requests.Timeout("provider timeout after init"),
            requests.Timeout("provider timeout after init"),
        ]

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.provider_payout_id, "req-123")
        self.assertEqual(self.payout.status_sync_attempt_count, 0)
        self.assertEqual(self.payout.last_error_code, "NETWORK_ERROR")
        self.assertIn("auth", str(self.payout.provider_dispatch_payload.get("stage", "")))

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_moves_to_sent_when_auth_returns_non_retryable_after_request_id(self, mock_request):
        earning = self.payout.items.select_related("earning").get().earning
        mock_request.side_effect = [
            _FakeResponse(data={"status": "success", "requestId": "req-123"}),
            _FakeResponse(data={"status": "failure", "errorCode": "20001", "errorMessage": "auth rejected"}),
        ]

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.provider_payout_id, "req-123")
        self.assertEqual(self.payout.last_error_code, "20001")
        self.assertEqual(earning.status, BusinessEarning.Status.IN_PAYOUT)


    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_uses_locale_query_string_for_iyzico_requests(self, mock_request):
        mock_request.side_effect = [
            _FakeResponse(data={"status": "success", "requestId": "req-123"}),
            _FakeResponse(data={"status": "success"}),
        ]

        PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        first_url = mock_request.call_args_list[0].kwargs["url"]
        second_url = mock_request.call_args_list[1].kwargs["url"]
        self.assertTrue(first_url.endswith("/v1/mass/payout/init?locale=tr"))
        self.assertTrue(second_url.endswith("/v1/mass/payout/auth?locale=tr"))

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_keeps_retryable_init_error_retryable(self, mock_request):
        mock_request.return_value = _FakeResponse(
            data={"status": "failure", "errorCode": "10051", "errorMessage": "temporary timeout"}
        )

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(self.payout.last_error_code, "10051")
        self.assertIsNotNone(self.payout.next_retry_at)

    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_marks_failed_when_init_returns_non_retryable_error_status(self, mock_request):
        mock_request.return_value = _FakeResponse(
            data={"status": "failure", "errorCode": "20001", "errorMessage": "invalid iban"}
        )

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")
        processed_again = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.assertEqual(processed_again, 0)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(self.payout.last_error_code, "20001")
        self.assertIsNone(self.payout.next_retry_at)

    @override_settings(PAYOUT_MAX_ATTEMPTS=1)
    @patch("payouts.providers.iyzico_marketplace_payout.requests.request")
    def test_dispatch_due_payouts_keeps_earning_in_payout_when_retryable_budget_exhausted(self, mock_request):
        earning = self.payout.items.select_related("earning").get().earning
        mock_request.return_value = _FakeResponse(
            data={"status": "failure", "errorCode": "10051", "errorMessage": "temporary timeout"}
        )

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertIsNone(self.payout.next_retry_at)
        self.assertEqual(earning.status, BusinessEarning.Status.IN_PAYOUT)
