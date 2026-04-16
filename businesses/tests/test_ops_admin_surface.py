from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from businesses.models import BusinessProfile


class OpsAdminSurfaceTests(TestCase):
    IDEMPOTENCY_KEY = "ops-submerchant-test-key"

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin", password="pass", role=User.Role.ADMIN)
        self.customer = User.objects.create_user(username="customer", password="pass", role=User.Role.CUSTOMER)
        self.business = BusinessProfile.objects.create(
            contact_user=self.customer,
            business_name="Biz",
            category="Food",
            adress="Adres",
            district="BEYLIKDUZU",
            is_active=True,
            is_approved=True,
            is_listed=True,
            kyc_contact_name="Ali",
            kyc_contact_surname="Veli",
            kyc_email="biz@example.com",
            kyc_gsm_number="05551234567",
            kyc_iban="TR000000000000000000000001",
            kyc_identity_number="11111111111",
            kyc_address="Adres",
        )

    def _post_onboarding(self):
        return self.client.post(
            f"/api/v1/ops/businesses/{self.business.id}/iyzico/submerchant/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=self.IDEMPOTENCY_KEY,
        )

    @patch("businesses.services.ops_onboarding.onboard_submerchant")
    def test_official_ops_endpoint_handles_onboarding(self, onboard_mock):
        def _apply(*, business):
            business.iyzico_submerchant_key = "subm-key-1"
            business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.ACTIVE
            business.iyzico_last_error = ""
            business.iyzico_last_response = {"status": "success"}
            business.save(update_fields=["iyzico_submerchant_key", "iyzico_submerchant_status", "iyzico_last_error", "iyzico_last_response"])
            return business

        onboard_mock.side_effect = _apply

        self.client.force_authenticate(self.admin)
        response = self._post_onboarding()

        self.assertEqual(response.status_code, 200)
        self.business.refresh_from_db()
        self.assertEqual(self.business.payout_onboarding_status, "APPROVED")
        self.assertEqual(self.business.iyzico_submerchant_key, "subm-key-1")
        self.assertIn("correlation_id", response.data["data"])

    @patch("businesses.services.ops_onboarding.onboard_submerchant")
    def test_ops_endpoint_returns_409_for_needs_review_state(self, onboard_mock):
        def _apply(*, business):
            business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW
            business.iyzico_last_error = "iyzico.network_timeout"
            business.save(update_fields=["iyzico_submerchant_status", "iyzico_last_error"])
            return business

        onboard_mock.side_effect = _apply

        self.client.force_authenticate(self.admin)
        response = self._post_onboarding()

        self.assertEqual(response.status_code, 409)
        self.business.refresh_from_db()
        self.assertEqual(self.business.payout_onboarding_status, BusinessProfile.PayoutOnboardingStatus.NEEDS_REVIEW)
        self.assertEqual(response.data["data"]["correlation_id"], "")

    @patch("businesses.services.ops_onboarding.onboard_submerchant")
    def test_ops_endpoint_extracts_trace_from_nested_detail_error_provider_raw(self, onboard_mock):
        def _apply(*, business):
            business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW
            business.iyzico_last_error = "iyzico.request_failed:unauthorized"
            business.iyzico_last_response = {
                "detail_error": {
                    "provider_raw": {
                        "meta": {
                            "correlation_id": "corr-nested-1",
                            "http_status": 401,
                            "attempt": 1,
                        }
                    }
                }
            }
            business.save(update_fields=["iyzico_submerchant_status", "iyzico_last_error", "iyzico_last_response"])
            return business

        onboard_mock.side_effect = _apply
        self.client.force_authenticate(self.admin)
        response = self._post_onboarding()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["data"]["correlation_id"], "corr-nested-1")

    @patch("businesses.services.ops_onboarding.onboard_submerchant")
    def test_ops_endpoint_returns_202_for_pending_state(self, onboard_mock):
        def _apply(*, business):
            business.iyzico_submerchant_key = "subm-key-1"
            business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.PENDING
            business.iyzico_last_error = "waiting_for_approval"
            business.save(update_fields=["iyzico_submerchant_key", "iyzico_submerchant_status", "iyzico_last_error"])
            return business

        onboard_mock.side_effect = _apply

        self.client.force_authenticate(self.admin)
        response = self._post_onboarding()

        self.assertEqual(response.status_code, 202)
        self.business.refresh_from_db()
        self.assertEqual(self.business.payout_onboarding_status, BusinessProfile.PayoutOnboardingStatus.PENDING)

    def test_legacy_marketplace_admin_route_is_removed(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/v1/payments/marketplace/onboard/", {"business_id": self.business.id}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_business_detail_exposes_single_contact_user_id_field(self):
        self.client.force_authenticate(self.admin)

        response = self.client.get(f"/api/v1/ops/businesses/{self.business.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["data"]["contact"],
            {
                "contact_user_id": self.customer.id,
                "email": self.business.kyc_email,
                "gsm_number": self.business.kyc_gsm_number,
            },
        )
        self.assertNotIn("metadata_contact_user_id", response.data["data"]["contact"])
        self.assertNotIn("iyzico_submerchant_key", response.data["data"])
        self.assertNotIn("iyzico_submerchant_status", response.data["data"])
        self.assertEqual(
            response.data["data"]["iyzico_onboarding"]["submerchant_key"],
            self.business.iyzico_submerchant_key,
        )

    @patch("businesses.services.ops_onboarding.onboard_submerchant")
    def test_official_ops_endpoint_replays_same_idempotency_key(self, onboard_mock):
        def _apply(*, business):
            business.iyzico_submerchant_key = "subm-key-1"
            business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.ACTIVE
            business.iyzico_last_error = ""
            business.iyzico_last_response = {"status": "success"}
            business.save(update_fields=["iyzico_submerchant_key", "iyzico_submerchant_status", "iyzico_last_error", "iyzico_last_response"])
            return business

        onboard_mock.side_effect = _apply
        self.client.force_authenticate(self.admin)

        first = self._post_onboarding()
        second = self._post_onboarding()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data, second.data)
        self.assertEqual(second["Idempotency-Replayed"], "true")
        self.assertEqual(onboard_mock.call_count, 1)

    @patch("businesses.services.ops_onboarding.onboard_submerchant")
    def test_terminal_payout_status_is_preserved_on_needs_review_refresh(self, onboard_mock):
        self.business.payout_onboarding_status = BusinessProfile.PayoutOnboardingStatus.APPROVED
        self.business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.ACTIVE
        self.business.iyzico_submerchant_key = "subm-key-approved"
        self.business.save(update_fields=["payout_onboarding_status", "iyzico_submerchant_status", "iyzico_submerchant_key"])

        def _apply(*, business):
            business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW
            business.iyzico_last_error = "iyzico.network_timeout"
            business.save(update_fields=["iyzico_submerchant_status", "iyzico_last_error"])
            return business

        onboard_mock.side_effect = _apply
        self.client.force_authenticate(self.admin)
        response = self._post_onboarding()

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data["error"]["code"], "submerchant_refresh_inconclusive")
        self.business.refresh_from_db()
        self.assertEqual(self.business.payout_onboarding_status, BusinessProfile.PayoutOnboardingStatus.APPROVED)
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.ACTIVE)

    @patch("businesses.services.ops_onboarding.onboard_submerchant")
    def test_pending_state_is_preserved_on_transient_needs_review_refresh(self, onboard_mock):
        self.business.payout_onboarding_status = BusinessProfile.PayoutOnboardingStatus.PENDING
        self.business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.PENDING
        self.business.iyzico_submerchant_key = "subm-key-pending"
        self.business.save(update_fields=["payout_onboarding_status", "iyzico_submerchant_status", "iyzico_submerchant_key"])

        def _apply(*, business):
            business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW
            business.iyzico_last_error = "iyzico.network_timeout"
            business.save(update_fields=["iyzico_submerchant_status", "iyzico_last_error"])
            return business

        onboard_mock.side_effect = _apply
        self.client.force_authenticate(self.admin)
        response = self._post_onboarding()

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data["error"]["code"], "submerchant_pending")
        self.business.refresh_from_db()
        self.assertEqual(self.business.payout_onboarding_status, BusinessProfile.PayoutOnboardingStatus.PENDING)
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.PENDING)
