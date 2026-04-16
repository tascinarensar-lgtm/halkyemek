import hashlib
import hmac
import json
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from payments.models import PaymentIntent, ProviderEvent
from payments.providers.iyzico import IyzicoRetrieveResult
from payments.services import create_topup_payment_intent, settle_intent_from_provider
from test_support import create_user
from wallets.models import PendingWalletTransaction, Wallet, WalletTransaction


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


class PaymentWebhookTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_user(username="customer")

    def test_duplicate_webhook_blocked(self):
        intent = create_topup_payment_intent(user=self.user, amount=1000)
        payload = {
            "type": "payment.paid",
            "event_id": "evt_123",
            "data": {"intent_id": intent.pk, "provider_payment_id": "pay_1"},
        }
        body = json.dumps(payload).encode("utf-8")
        sig = sign(settings.PAYMENT_WEBHOOK_SECRET, body)

        url = reverse("payments:provider-webhook")
        first = self.client.post(url, data=body, content_type="application/json", HTTP_X_PROVIDER_EVENT_ID="evt_123", HTTP_X_PROVIDER_SIGNATURE=sig)
        second = self.client.post(url, data=body, content_type="application/json", HTTP_X_PROVIDER_EVENT_ID="evt_123", HTTP_X_PROVIDER_SIGNATURE=sig)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(ProviderEvent.objects.filter(event_id="evt_123").count(), 1)
        self.assertEqual(PendingWalletTransaction.objects.filter(payment_intent=intent).count(), 1)

    def test_financial_integrity_verification_passes_after_settlement(self):
        intent = create_topup_payment_intent(user=self.user, amount=1000)
        payload = {
            "type": "payment.paid",
            "event_id": "evt_paid",
            "data": {"intent_id": intent.pk, "provider_payment_id": "pay_2"},
        }
        body = json.dumps(payload).encode("utf-8")
        sig = sign(settings.PAYMENT_WEBHOOK_SECRET, body)
        self.client.post(reverse("payments:provider-webhook"), data=body, content_type="application/json", HTTP_X_PROVIDER_EVENT_ID="evt_paid", HTTP_X_PROVIDER_SIGNATURE=sig)

        result = settle_intent_from_provider(
            provider="MOCK",
            provider_event_id="evt_settle",
            intent_id=intent.pk,
            provider_payment_id="pay_2",
            settlement_reference_code="sett-1",
            amount=1000,
            raw_row={"amount": 1000},
        )
        self.assertEqual(result.status, "settled")
        wallet_tx = WalletTransaction.objects.get(payment_intent=intent)
        wallet = Wallet.objects.get(user=self.user)
        wallet.refresh_from_db()
        self.assertEqual(int(wallet.balance), int(wallet_tx.after_balance))

    @override_settings(
        IYZICO_WEBHOOK_IP_ALLOWLIST=["203.0.113.0/24"],
        TRUST_X_FORWARDED_FOR=True,
        TRUSTED_PROXY_IPS=["10.0.0.0/8"],
    )
    def test_iyzico_webhook_blocks_spoofed_forwarded_ip_from_untrusted_source(self):
        response = self.client.post(
            reverse("payments:iyzico-webhook"),
            data={"status": "SUCCESS"},
            format="json",
            REMOTE_ADDR="198.51.100.10",
            HTTP_X_FORWARDED_FOR="203.0.113.25",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json().get("error", {}).get("code"), "webhook.ip_not_allowed")

@override_settings(
    IYZICO_API_KEY="sandbox-test-api-key",
    IYZICO_SECRET_KEY="sandbox-test-secret-key-for-tests",
)
class IyzicoTopupCallbackTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_user(username="callback-user")
        self.callback_url = reverse("payments:iyzico-topup-callback")

    @staticmethod
    def _retrieve_result(*, token: str, conversation_id: str, payment_status: str, payment_id: str) -> IyzicoRetrieveResult:
        return IyzicoRetrieveResult(
            status="SUCCESS",
            payment_status=payment_status,
            conversation_id=conversation_id,
            token=token,
            payment_id=payment_id,
            raw={
                "status": "success",
                "paymentStatus": payment_status,
                "conversationId": conversation_id,
                "token": token,
                "paymentId": payment_id,
            },
        )

    def test_callback_success_is_idempotent_and_credits_pending_once(self):
        intent = create_topup_payment_intent(user=self.user, amount=2500)
        intent.provider_session_token = "cb-token-1"
        intent.save(update_fields=["provider_session_token", "updated_at"])

        with patch("payments.services.IyzicoCheckoutFormClient.retrieve") as retrieve_mock:
            retrieve_mock.return_value = self._retrieve_result(
                token="cb-token-1",
                conversation_id=intent.marketplace_conversation_id,
                payment_status="SUCCESS",
                payment_id="pay-cb-1",
            )

            first = self.client.post(self.callback_url, {"token": "cb-token-1"}, format="json")
            second = self.client.post(self.callback_url, {"token": "cb-token-1"}, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["data"]["status"], "paid")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["data"]["status"], "duplicate")
        self.assertEqual(retrieve_mock.call_count, 2)

        intent.refresh_from_db()
        self.assertEqual(intent.status, PaymentIntent.Status.PAID)
        self.assertTrue(intent.is_processed)
        self.assertEqual(PendingWalletTransaction.objects.filter(payment_intent=intent).count(), 1)
        self.assertEqual(ProviderEvent.objects.filter(provider=ProviderEvent.Provider.IYZICO).count(), 1)

    @override_settings(FRONTEND_APP_URL="http://localhost:3000")
    def test_browser_callback_redirects_to_frontend_result_page(self):
        intent = create_topup_payment_intent(user=self.user, amount=2500)
        intent.provider_session_token = "cb-token-browser"
        intent.save(update_fields=["provider_session_token", "updated_at"])

        with patch("payments.services.IyzicoCheckoutFormClient.retrieve") as retrieve_mock:
            retrieve_mock.return_value = self._retrieve_result(
                token="cb-token-browser",
                conversation_id=intent.marketplace_conversation_id,
                payment_status="SUCCESS",
                payment_id="pay-cb-browser",
            )
            response = self.client.post(self.callback_url, {"token": "cb-token-browser"})

        self.assertEqual(response.status_code, 302)
        self.assertEqual(
            response["Location"],
            f"http://localhost:3000/cuzdan/yukle/sonuc?status=paid&intent={intent.pk}",
        )
        intent.refresh_from_db()
        self.assertEqual(intent.status, PaymentIntent.Status.PAID)
        self.assertTrue(intent.is_processed)
        self.assertEqual(PendingWalletTransaction.objects.filter(payment_intent=intent).count(), 1)


    def test_callback_provider_error_returns_502_and_persists_error_snapshot(self):
        intent = create_topup_payment_intent(user=self.user, amount=4200)
        intent.provider_session_token = "cb-token-provider-error"
        intent.save(update_fields=["provider_session_token", "updated_at"])

        with patch("payments.services.IyzicoCheckoutFormClient.retrieve") as retrieve_mock:
            from payments.providers.iyzico import IyzicoRequestError

            retrieve_mock.side_effect = IyzicoRequestError(
                message="iyzico.network_timeout:provider timeout",
                code="NETWORK_TIMEOUT",
                retryable=True,
                raw={"meta": {"correlation_id": "test-corr"}, "response": {}},
            )
            response = self.client.post(self.callback_url, {"token": "cb-token-provider-error"}, format="json")

        self.assertEqual(response.status_code, 502)
        intent.refresh_from_db()
        self.assertEqual(intent.status, PaymentIntent.Status.INITIATED)
        self.assertEqual(intent.processing_error, "iyzico.network_timeout:provider timeout")
        self.assertEqual(intent.provider_raw_result.get("error_code"), "NETWORK_TIMEOUT")
        self.assertTrue(intent.provider_raw_result.get("retryable"))

    def test_callback_rejects_mismatched_retrieve_response(self):
        intent = create_topup_payment_intent(user=self.user, amount=2600)
        intent.provider_session_token = "cb-token-mismatch"
        intent.save(update_fields=["provider_session_token", "updated_at"])

        with patch("payments.providers.iyzico.requests.request") as request_mock:
            response_body = {
                "status": "success",
                "paymentStatus": "SUCCESS",
                "conversationId": "HY-PI-999999",
                "token": "cb-token-mismatch",
                "paymentId": "pay-mismatch-1",
            }
            fake = type("Resp", (), {"status_code": 200, "json": lambda self: response_body})()
            request_mock.return_value = fake
            response = self.client.post(self.callback_url, {"token": "cb-token-mismatch"}, format="json")

        self.assertEqual(response.status_code, 502)
        intent.refresh_from_db()
        self.assertEqual(intent.status, PaymentIntent.Status.INITIATED)
        self.assertEqual(intent.provider_raw_result.get("error_code"), "CONVERSATION_ID_MISMATCH")
        self.assertEqual(PendingWalletTransaction.objects.filter(payment_intent=intent).count(), 0)


    def test_callback_rejects_invalid_json_response_shape(self):
        intent = create_topup_payment_intent(user=self.user, amount=2600)
        intent.provider_session_token = "cb-token-shape"
        intent.save(update_fields=["provider_session_token", "updated_at"])

        with patch("payments.providers.iyzico.requests.request") as request_mock:
            fake = type(
                "Resp",
                (),
                {
                    "status_code": 200,
                    "headers": {"Content-Type": "application/json"},
                    "text": '[1,2,3]',
                    "json": lambda self: [1, 2, 3],
                },
            )()
            request_mock.return_value = fake
            response = self.client.post(self.callback_url, {"token": "cb-token-shape"}, format="json")

        self.assertEqual(response.status_code, 502)
        intent.refresh_from_db()
        self.assertEqual(intent.provider_raw_result.get("error_code"), "INVALID_RESPONSE_SHAPE")
        self.assertEqual(PendingWalletTransaction.objects.filter(payment_intent=intent).count(), 0)

    def test_callback_rejects_success_without_payment_status(self):
        intent = create_topup_payment_intent(user=self.user, amount=2600)
        intent.provider_session_token = "cb-token-missing-status"
        intent.save(update_fields=["provider_session_token", "updated_at"])

        with patch("payments.providers.iyzico.requests.request") as request_mock:
            response_body = {
                "status": "success",
                "conversationId": intent.marketplace_conversation_id,
                "token": "cb-token-missing-status",
                "paymentId": "pay-missing-status-1",
            }
            fake = type(
                "Resp",
                (),
                {
                    "status_code": 200,
                    "headers": {"Content-Type": "application/json"},
                    "text": str(response_body),
                    "json": lambda self: response_body,
                },
            )()
            request_mock.return_value = fake
            response = self.client.post(self.callback_url, {"token": "cb-token-missing-status"}, format="json")

        self.assertEqual(response.status_code, 502)
        intent.refresh_from_db()
        self.assertEqual(intent.provider_raw_result.get("error_code"), "PAYMENT_STATUS_MISSING")
        self.assertEqual(PendingWalletTransaction.objects.filter(payment_intent=intent).count(), 0)

    def test_callback_failure_marks_intent_failed(self):
        intent = create_topup_payment_intent(user=self.user, amount=3100)
        intent.provider_session_token = "cb-token-fail"
        intent.save(update_fields=["provider_session_token", "updated_at"])

        with patch("payments.services.IyzicoCheckoutFormClient.retrieve") as retrieve_mock:
            retrieve_mock.return_value = self._retrieve_result(
                token="cb-token-fail",
                conversation_id=intent.marketplace_conversation_id,
                payment_status="FAILURE",
                payment_id="pay-cb-fail",
            )
            response = self.client.post(self.callback_url, {"token": "cb-token-fail"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "failed")
        intent.refresh_from_db()
        self.assertEqual(intent.status, PaymentIntent.Status.FAILED)
        self.assertFalse(intent.is_processed)
        self.assertEqual(PendingWalletTransaction.objects.filter(payment_intent=intent).count(), 0)
