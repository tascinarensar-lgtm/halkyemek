from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase
from django.test.utils import override_settings
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User
from notifications.models import Device, Notification
from payments.models import PaymentIntent, ProviderEvent
from payments.services import create_topup_payment_intent
from wallets.models import Wallet, WalletTransaction


@override_settings(
    TOPUP_PROVIDER="manual",
    PAYOUT_PROVIDER="manual",
    MANUAL_TOPUP_ACCOUNT_NAME="HalkYemek",
    MANUAL_TOPUP_IBAN="",
    MANUAL_TOPUP_INSTRUCTIONS=["Odeme aciklamasina yukleme referansini yazin."],
    IYZICO_API_KEY="",
    IYZICO_SECRET_KEY="",
)
class ManualTopupFlowTests(TestCase):
    def setUp(self):
        self.customer = User.objects.create_user(username="manual-topup-customer", email="customer@example.com", password="pass")
        Device.objects.create(
            user=self.customer,
            platform=Device.Platform.WEB,
            fcm_token="manual-topup-device-token",
            permission_granted=True,
            is_active=True,
        )
        self.admin = User.objects.create_user(username="manual-topup-admin", password="pass", role=User.Role.ADMIN)
        self.customer_client = APIClient()
        self.customer_client.force_authenticate(self.customer)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(self.admin)

    def test_customer_topup_create_uses_manual_provider_without_iyzico(self):
        with patch("payments.services.IyzicoCheckoutFormClient") as iyzico_client:
            response = self.customer_client.post(
                "/api/v1/payments/topup/intents/",
                {"amount": 1250},
                format="json",
                HTTP_IDEMPOTENCY_KEY="manual-topup-create-1",
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payload = response.json()
        self.assertEqual(payload["provider"], PaymentIntent.Provider.MOCK)
        self.assertEqual(payload["status"], PaymentIntent.Status.INITIATED)
        self.assertEqual(payload["normalized_status"], "MANUAL_PENDING")
        self.assertEqual(payload["provider_page_url"], "")
        self.assertTrue(str(payload["payment_reference"]).startswith("HY-PAY-"))
        self.assertGreaterEqual(len(payload["manual_payment_instructions"]), 1)
        self.assertFalse(iyzico_client.called)

    def test_ops_manual_topup_confirm_credits_wallet_once(self):
        intent = create_topup_payment_intent(user=self.customer, amount=2500, callback_url="https://api.example.com/callback/")
        url = f"/api/v1/payments/ops/intents/{intent.id}/manual-topup-confirm/"

        first = self.admin_client.post(
            url,
            {"idempotency_key": "manual-confirm-1", "received_amount": 2500, "note": "bank transfer seen"},
            format="json",
        )
        second = self.admin_client.post(
            url,
            {"idempotency_key": "manual-confirm-1", "received_amount": 2500, "note": "replay"},
            format="json",
        )
        third = self.admin_client.post(
            url,
            {"idempotency_key": "manual-confirm-2", "received_amount": 2500, "note": "accidental second click"},
            format="json",
        )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(third.status_code, status.HTTP_200_OK)
        self.assertFalse(first.json()["data"]["already_confirmed"])
        self.assertTrue(second.json()["data"]["already_confirmed"])
        self.assertTrue(third.json()["data"]["already_confirmed"])

        wallet = Wallet.objects.get(user=self.customer)
        self.assertEqual(int(wallet.balance), 2500)
        self.assertEqual(
            WalletTransaction.objects.filter(
                wallet=wallet,
                transaction_type=WalletTransaction.Type.TOP_UP,
                payment_intent=intent,
            ).count(),
            1,
        )
        intent.refresh_from_db()
        self.assertEqual(intent.status, PaymentIntent.Status.PAID)
        self.assertEqual(intent.normalized_status, "MANUAL_CONFIRMED")
        self.assertTrue(intent.is_processed)
        self.assertTrue(intent.is_settled)
        self.assertEqual(ProviderEvent.objects.filter(provider=ProviderEvent.Provider.MOCK, event_type="manual.topup.confirmed").count(), 2)
        self.assertTrue(Notification.objects.filter(user=self.customer, dedupe_key=f"manual_topup_confirmed:{intent.pk}").exists())

    def test_ops_manual_topup_confirm_rejects_amount_mismatch(self):
        intent = create_topup_payment_intent(user=self.customer, amount=2500)
        response = self.admin_client.post(
            f"/api/v1/payments/ops/intents/{intent.id}/manual-topup-confirm/",
            {"idempotency_key": "manual-confirm-mismatch", "received_amount": 2400},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(WalletTransaction.objects.filter(payment_intent=intent).count(), 0)

    def test_non_admin_cannot_confirm_manual_topup(self):
        intent = create_topup_payment_intent(user=self.customer, amount=2500)
        response = self.customer_client.post(
            f"/api/v1/payments/ops/intents/{intent.id}/manual-topup-confirm/",
            {"idempotency_key": "manual-confirm-forbidden"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
