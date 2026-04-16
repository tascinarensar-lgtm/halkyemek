from unittest.mock import Mock, patch

import requests
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings

from accounts.models import User
from businesses.models import BusinessProfile
from payments.providers.iyzico_marketplace import (
    IyzicoMarketplaceClient,
    build_submerchant_create_payload,
    build_submerchant_update_payload,
    onboard_submerchant,
    validate_submerchant_business_or_raise,
)


@override_settings(
    IYZICO_API_KEY="sandbox-api-key",
    IYZICO_SECRET_KEY="sandbox-secret-key",
    IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
    IYZICO_ENV="sandbox",
    IYZICO_SUBMERCHANT_RETRY_BACKOFF_SECONDS=0,
)
class IyzicoMarketplaceProviderTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="merchant_contact",
            password="pass",
            role=User.Role.CUSTOMER,
            email="merchant@example.com",
            google_email="merchant@example.com",
        )
        self.business = BusinessProfile.objects.create(
            contact_user=self.user,
            business_name="Biz Market",
            category="Food",
            adress="Beylikdüzü Adres 123",
            district="BEYLIKDUZU",
            is_active=True,
            is_approved=True,
            is_listed=True,
            iyzico_submerchant_type="PRIVATE_COMPANY",
            kyc_contact_name="Ayşe",
            kyc_contact_surname="Yılmaz",
            kyc_email="merchant@example.com",
            kyc_gsm_number="05350000000",
            kyc_iban="TR180006200119000006672315",
            kyc_identity_number="11111111111",
            kyc_tax_number="1234567890",
            kyc_tax_office="Beylikdüzü",
            kyc_legal_company_title="Biz Market Ltd Şti",
            kyc_address="Beylikdüzü Mahallesi No:1",
            kyc_city="Istanbul",
            kyc_country="Turkey",
            kyc_zip_code="34520",
        )

    def test_build_create_payload_for_private_company_contains_required_fields(self):
        payload = build_submerchant_create_payload(self.business)
        self.assertEqual(payload["subMerchantType"], "PRIVATE_COMPANY")
        self.assertEqual(payload["subMerchantExternalId"], f"BUS-{self.business.id}")
        self.assertEqual(payload["taxOffice"], "Beylikdüzü")
        self.assertEqual(payload["legalCompanyTitle"], "Biz Market Ltd Şti")
        self.assertEqual(payload["taxNumber"], "1234567890")
        self.assertEqual(payload["gsmNumber"], "+905350000000")

    def test_build_update_payload_omits_submerchant_type_and_external_id(self):
        self.business.iyzico_submerchant_key = "subm-key-1"
        payload = build_submerchant_update_payload(self.business)
        self.assertEqual(payload["subMerchantKey"], "subm-key-1")
        self.assertNotIn("subMerchantType", payload)
        self.assertNotIn("subMerchantExternalId", payload)

    def test_build_update_payload_for_limited_company_includes_company_fields(self):
        self.business.iyzico_submerchant_key = "subm-key-limited"
        self.business.iyzico_submerchant_type = "LIMITED_OR_JOINT_STOCK_COMPANY"
        payload = build_submerchant_update_payload(self.business)

        self.assertEqual(payload["subMerchantKey"], "subm-key-limited")
        self.assertNotIn("identityNumber", payload)
        self.assertEqual(payload["taxOffice"], "Beylikdüzü")
        self.assertEqual(payload["legalCompanyTitle"], "Biz Market Ltd Şti")
        self.assertEqual(payload["taxNumber"], "1234567890")

    def test_private_company_payload_does_not_force_optional_identity_and_tax_number(self):
        self.business.kyc_identity_number = ""
        self.business.kyc_tax_number = ""

        validate_submerchant_business_or_raise(business=self.business)
        payload = build_submerchant_create_payload(self.business)

        self.assertNotIn("identityNumber", payload)
        self.assertNotIn("taxNumber", payload)

    def test_submerchant_validation_requires_kyc_email_without_contact_user_fallback(self):
        self.business.kyc_email = ""

        with self.assertRaises(ValidationError) as exc_ctx:
            validate_submerchant_business_or_raise(business=self.business)

        self.assertIn("email", str(exc_ctx.exception))

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_create_submerchant_uses_post_endpoint(self, request_mock):
        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "status": "success",
            "conversationId": "HY-SUB-1",
            "subMerchantKey": "subm-key-created",
        }
        request_mock.return_value = response

        client = IyzicoMarketplaceClient()
        result = client.create_submerchant(
            payload=build_submerchant_create_payload(self.business),
            correlation_id="test-correlation-create",
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.submerchant_key, "subm-key-created")
        _, kwargs = request_mock.call_args
        self.assertEqual(kwargs["method"], "POST")
        self.assertTrue(kwargs["url"].endswith("/onboarding/submerchant"))

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_update_submerchant_uses_put_endpoint(self, request_mock):
        self.business.iyzico_submerchant_key = "subm-key-existing"
        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "status": "success",
            "conversationId": "HY-SUB-1",
        }
        request_mock.return_value = response

        client = IyzicoMarketplaceClient()
        result = client.update_submerchant(
            payload=build_submerchant_update_payload(self.business),
            correlation_id="test-correlation-update",
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.submerchant_key, "subm-key-existing")
        _, kwargs = request_mock.call_args
        self.assertEqual(kwargs["method"], "PUT")
        self.assertTrue(kwargs["url"].endswith("/onboarding/submerchant"))

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_retrieve_submerchant_uses_external_id_and_correlation_header(self, request_mock):
        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-existing",
        }
        request_mock.return_value = response

        client = IyzicoMarketplaceClient()
        result = client.retrieve_submerchant(
            business=self.business,
            correlation_id="test-correlation-detail",
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.submerchant_key, "subm-key-existing")
        _, kwargs = request_mock.call_args
        self.assertEqual(kwargs["method"], "POST")
        self.assertTrue(kwargs["url"].endswith("/onboarding/submerchant/detail"))
        self.assertEqual(kwargs["headers"]["X-Correlation-ID"], "test-correlation-detail")


    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_create_submerchant_rejects_non_object_json_response(self, request_mock):
        response = Mock()
        response.status_code = 200
        response.text = '[1, 2, 3]'
        response.headers = {"Content-Type": "application/json"}
        response.json.return_value = [1, 2, 3]
        request_mock.return_value = response

        client = IyzicoMarketplaceClient()
        with self.assertRaises(Exception) as exc_ctx:
            client.create_submerchant(
                payload=build_submerchant_create_payload(self.business),
                correlation_id="test-correlation-shape",
            )

        self.assertEqual(getattr(exc_ctx.exception, "code", ""), "INVALID_RESPONSE_SHAPE")
        self.assertIn("response_text", getattr(exc_ctx.exception, "raw", {}))

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_onboard_submerchant_persists_key_and_active_status(self, request_mock):
        create_response = Mock()
        create_response.status_code = 200
        create_response.json.return_value = {
            "status": "success",
            "conversationId": f"HY-SUB-{self.business.id}",
            "subMerchantKey": "subm-key-created",
        }
        detail_response = Mock()
        detail_response.status_code = 200
        detail_response.json.return_value = {
            "status": "success",
            "conversationId": f"HY-SUB-DETAIL-{self.business.id}",
            "subMerchantKey": "subm-key-created",
            "subMerchantExternalId": f"BUS-{self.business.id}",
            "subMerchantStatus": "ACTIVE",
        }
        request_mock.side_effect = [create_response, detail_response]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_key, "subm-key-created")
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.ACTIVE)
        self.assertEqual(self.business.iyzico_last_error, "")
        self.assertIn("detail", self.business.iyzico_last_response)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_onboard_submerchant_marks_rejected_when_iyzico_returns_business_failure(self, request_mock):
        failed_response = Mock()
        failed_response.status_code = 400
        failed_response.json.return_value = {
            "status": "failure",
            "errorCode": "2005",
            "errorMessage": "IBAN is mandatory",
        }
        request_mock.return_value = failed_response

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.REJECTED)
        self.assertIn("IBAN is mandatory", self.business.iyzico_last_error)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_duplicate_external_id_recovers_by_detail_then_update(self, request_mock):
        duplicate_response = Mock()
        duplicate_response.status_code = 400
        duplicate_response.json.return_value = {
            "status": "failure",
            "errorCode": "2002",
            "errorMessage": "Sub merchant does exist for ID",
        }
        detail_response = Mock()
        detail_response.status_code = 200
        detail_response.json.return_value = {
            "status": "success",
            "conversationId": f"HY-SUB-DETAIL-{self.business.id}",
            "subMerchantKey": "subm-key-existing",
            "subMerchantStatus": "ACTIVE",
        }
        update_response = Mock()
        update_response.status_code = 200
        update_response.json.return_value = {
            "status": "success",
            "conversationId": f"HY-SUB-{self.business.id}",
            "subMerchantKey": "subm-key-existing",
        }
        detail_after_update = Mock()
        detail_after_update.status_code = 200
        detail_after_update.json.return_value = {
            "status": "success",
            "conversationId": f"HY-SUB-DETAIL-{self.business.id}",
            "subMerchantKey": "subm-key-existing",
            "subMerchantStatus": "ACTIVE",
        }
        request_mock.side_effect = [duplicate_response, detail_response, update_response, detail_after_update]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_key, "subm-key-existing")
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.ACTIVE)
        self.assertIn("duplicate_external_id", self.business.iyzico_last_response)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_duplicate_external_id_keeps_detail_authoritative_when_update_fails(self, request_mock):
        duplicate_response = Mock()
        duplicate_response.status_code = 400
        duplicate_response.json.return_value = {
            "status": "failure",
            "errorCode": "2002",
            "errorMessage": "Sub merchant does exist for ID",
        }
        detail_response = Mock()
        detail_response.status_code = 200
        detail_response.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-existing",
            "subMerchantStatus": "ACTIVE",
        }
        update_failure = Mock()
        update_failure.status_code = 400
        update_failure.json.return_value = {
            "status": "failure",
            "errorCode": "2005",
            "errorMessage": "validation failed",
        }
        final_detail = Mock()
        final_detail.status_code = 200
        final_detail.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-existing",
            "subMerchantStatus": "ACTIVE",
        }
        request_mock.side_effect = [duplicate_response, detail_response, update_failure, final_detail]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_key, "subm-key-existing")
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.ACTIVE)
        self.assertIn("update_error", self.business.iyzico_last_response)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_onboard_submerchant_marks_pending_when_provider_detail_is_waiting_for_approval(self, request_mock):
        create_response = Mock()
        create_response.status_code = 200
        create_response.json.return_value = {
            "status": "success",
            "conversationId": f"HY-SUB-{self.business.id}",
            "subMerchantKey": "subm-key-created",
        }
        detail_response = Mock()
        detail_response.status_code = 200
        detail_response.json.return_value = {
            "status": "success",
            "conversationId": f"HY-SUB-DETAIL-{self.business.id}",
            "subMerchantKey": "subm-key-created",
            "subMerchantStatus": "WAITING_FOR_APPROVAL",
        }
        request_mock.side_effect = [create_response, detail_response]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.PENDING)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_onboard_submerchant_marks_needs_review_on_network_failure(self, request_mock):
        request_mock.side_effect = requests.RequestException("socket closed")

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_retryable_error_code_is_retried_and_succeeds(self, request_mock):
        retryable_failure = Mock()
        retryable_failure.status_code = 400
        retryable_failure.json.return_value = {
            "status": "failure",
            "errorCode": "10051",
            "errorMessage": "request timeout",
        }
        success = Mock()
        success.status_code = 200
        success.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-retried",
        }
        request_mock.side_effect = [retryable_failure, success]

        client = IyzicoMarketplaceClient()
        result = client.create_submerchant(
            payload=build_submerchant_create_payload(self.business),
            correlation_id="test-correlation-retry",
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.submerchant_key, "subm-key-retried")
        self.assertEqual(request_mock.call_count, 2)

    @override_settings(IYZICO_SUBMERCHANT_MAX_ATTEMPTS=1)
    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_ambiguous_create_failure_reconciles_with_detail(self, request_mock):
        create_failure = Mock()
        create_failure.status_code = 504
        create_failure.json.return_value = {
            "status": "failure",
            "errorCode": "50000",
            "errorMessage": "gateway timeout",
        }
        reconcile_detail = Mock()
        reconcile_detail.status_code = 200
        reconcile_detail.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-reconciled",
            "subMerchantStatus": "ACTIVE",
        }
        final_detail = Mock()
        final_detail.status_code = 200
        final_detail.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-reconciled",
            "subMerchantStatus": "ACTIVE",
        }
        request_mock.side_effect = [create_failure, reconcile_detail, final_detail]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_key, "subm-key-reconciled")
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.ACTIVE)
        self.assertIn("create_error", self.business.iyzico_last_response)

    @override_settings(IYZICO_SUBMERCHANT_MAX_ATTEMPTS=1)
    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_ambiguous_update_failure_reconciles_with_detail(self, request_mock):
        self.business.iyzico_submerchant_key = "subm-existing"
        self.business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.ACTIVE
        self.business.save(update_fields=["iyzico_submerchant_key", "iyzico_submerchant_status"])

        update_failure = Mock()
        update_failure.status_code = 504
        update_failure.json.return_value = {
            "status": "failure",
            "errorCode": "50000",
            "errorMessage": "gateway timeout",
        }
        reconcile_detail = Mock()
        reconcile_detail.status_code = 200
        reconcile_detail.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-existing",
            "subMerchantStatus": "ACTIVE",
        }
        final_detail = Mock()
        final_detail.status_code = 200
        final_detail.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-existing",
            "subMerchantStatus": "ACTIVE",
        }
        request_mock.side_effect = [update_failure, reconcile_detail, final_detail]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_key, "subm-existing")
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.ACTIVE)
        self.assertIn("update_error", self.business.iyzico_last_response)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_empty_provider_status_does_not_downgrade_existing_active_state(self, request_mock):
        self.business.iyzico_submerchant_key = "subm-existing"
        self.business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.ACTIVE
        self.business.save(update_fields=["iyzico_submerchant_key", "iyzico_submerchant_status"])

        update_response = Mock()
        update_response.status_code = 200
        update_response.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-existing",
        }
        detail_response = Mock()
        detail_response.status_code = 200
        detail_response.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-existing",
        }
        request_mock.side_effect = [update_response, detail_response]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.ACTIVE)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_non_retryable_update_failure_reconciles_with_existing_detail_state(self, request_mock):
        self.business.iyzico_submerchant_key = "subm-existing"
        self.business.iyzico_submerchant_status = BusinessProfile.IyziSubmerchantStatus.ACTIVE
        self.business.save(update_fields=["iyzico_submerchant_key", "iyzico_submerchant_status"])

        update_failure = Mock()
        update_failure.status_code = 400
        update_failure.json.return_value = {
            "status": "failure",
            "errorCode": "2005",
            "errorMessage": "validation failed",
        }
        reconcile_detail = Mock()
        reconcile_detail.status_code = 200
        reconcile_detail.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-existing",
            "subMerchantStatus": "ACTIVE",
        }
        final_detail = Mock()
        final_detail.status_code = 200
        final_detail.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-existing",
            "subMerchantStatus": "ACTIVE",
        }
        request_mock.side_effect = [update_failure, reconcile_detail, final_detail]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.ACTIVE)
        self.assertIn("update_error", self.business.iyzico_last_response)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_auth_failure_is_marked_needs_review_not_rejected(self, request_mock):
        auth_failure = Mock()
        auth_failure.status_code = 401
        auth_failure.json.return_value = {
            "status": "failure",
            "errorCode": "1000",
            "errorMessage": "unauthorized",
        }
        request_mock.return_value = auth_failure

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW)
        self.assertIn("unauthorized", self.business.iyzico_last_error)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_nested_submerchant_fields_are_extracted_from_detail_response(self, request_mock):
        create_response = Mock()
        create_response.status_code = 200
        create_response.json.return_value = {
            "status": "success",
            "subMerchant": {
                "subMerchantKey": "subm-key-created",
            },
        }
        detail_response = Mock()
        detail_response.status_code = 200
        detail_response.json.return_value = {
            "status": "success",
            "result": {
                "subMerchant": {
                    "subMerchantKey": "subm-key-created",
                    "subMerchantStatus": "ACTIVE",
                }
            },
        }
        request_mock.side_effect = [create_response, detail_response]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_key, "subm-key-created")
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.ACTIVE)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_blank_provider_status_after_success_is_inconclusive_for_new_onboarding(self, request_mock):
        create_response = Mock()
        create_response.status_code = 200
        create_response.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-created",
        }
        detail_response = Mock()
        detail_response.status_code = 200
        detail_response.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-created",
        }
        request_mock.side_effect = [create_response, detail_response]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_update_with_stale_submerchant_key_falls_back_to_create(self, request_mock):
        self.business.iyzico_submerchant_key = "subm-stale-key"

        stale_update = Mock()
        stale_update.status_code = 400
        stale_update.json.return_value = {
            "status": "failure",
            "errorCode": "2001",
            "errorMessage": "Sub merchant not found",
        }
        create_success = Mock()
        create_success.status_code = 200
        create_success.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-new",
        }
        request_mock.side_effect = [stale_update, create_success]

        client = IyzicoMarketplaceClient()
        result = client.create_or_update_submerchant(
            business=self.business,
            correlation_id="test-correlation-stale-create",
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.submerchant_key, "subm-key-new")
        self.assertEqual(request_mock.call_count, 2)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_onboard_submerchant_marks_needs_review_when_detail_request_fails(self, request_mock):
        create_response = Mock()
        create_response.status_code = 200
        create_response.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-created",
        }
        detail_failure = Mock()
        detail_failure.status_code = 400
        detail_failure.json.return_value = {
            "status": "failure",
            "errorCode": "2001",
            "errorMessage": "Sub merchant not found",
        }
        request_mock.side_effect = [create_response, detail_failure]

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW)
        self.assertIn("detail_error", self.business.iyzico_last_response)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_stale_key_with_provider_history_requires_manual_review(self, request_mock):
        self.business.iyzico_submerchant_key = "subm-old"
        self.business.iyzico_last_response = {"status": "success"}
        self.business.save(update_fields=["iyzico_submerchant_key", "iyzico_last_response"])

        stale_update = Mock()
        stale_update.status_code = 400
        stale_update.json.return_value = {
            "status": "failure",
            "errorCode": "2001",
            "errorMessage": "Sub merchant not found",
        }
        request_mock.return_value = stale_update

        onboard_submerchant(business=self.business)

        self.business.refresh_from_db()
        self.assertEqual(self.business.iyzico_submerchant_status, BusinessProfile.IyziSubmerchantStatus.NEEDS_REVIEW)
        self.assertIn("stale_key_requires_manual_review", self.business.iyzico_last_error)

    @patch("payments.providers.iyzico_marketplace.requests.request")
    def test_timeout_error_is_retried_before_success(self, request_mock):
        success = Mock()
        success.status_code = 200
        success.json.return_value = {
            "status": "success",
            "subMerchantKey": "subm-key-after-timeout",
        }
        request_mock.side_effect = [requests.Timeout("timed out"), success]

        client = IyzicoMarketplaceClient()
        result = client.create_submerchant(
            payload=build_submerchant_create_payload(self.business),
            correlation_id="test-correlation-timeout",
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.submerchant_key, "subm-key-after-timeout")
        self.assertEqual(request_mock.call_count, 2)

    @override_settings(
        IYZICO_ENV="production",
        IYZICO_API_KEY="sandbox-api-key",
        IYZICO_SECRET_KEY="sandbox-secret-key",
        IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
    )
    def test_client_rejects_environment_mismatch(self):
        with self.assertRaises(ValidationError):
            IyzicoMarketplaceClient()

    @override_settings(IYZICO_SUBMERCHANT_RETRY_JITTER_RATIO=1.5)
    def test_client_rejects_invalid_retry_jitter_ratio(self):
        with self.assertRaises(ValidationError):
            IyzicoMarketplaceClient()

    @override_settings(IYZICO_BASE_URL="http://sandbox-api.iyzipay.com")
    def test_client_rejects_non_https_base_url(self):
        with self.assertRaises(ValidationError):
            IyzicoMarketplaceClient()
