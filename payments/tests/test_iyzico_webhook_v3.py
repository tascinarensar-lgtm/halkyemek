import hashlib
import hmac

from django.conf import settings
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import User
from payments.models import PaymentIntent
from wallets.models import Wallet


def iyzico_sig_v3_direct(secret: str, payload: dict) -> str:
    msg = f"{secret}{payload['iyziEventType']}{payload['paymentId']}{payload['paymentConversationId']}{payload['status']}"
    return hmac.new(secret.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


class IyzicoWebhookV3Tests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="u1", password="pass", role=User.Role.CUSTOMER)
        Wallet.objects.get_or_create(user=self.user)

    def test_success_creates_pending_and_marks_intent_paid(self):
        intent = PaymentIntent.objects.create(
            user=self.user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=1000,
            status=PaymentIntent.Status.INITIATED,
            marketplace_conversation_id="HY-PI-1",
        )
        intent.marketplace_conversation_id = f"HY-PI-{intent.pk}"
        intent.save(update_fields=["marketplace_conversation_id"])

        payload = {
            "paymentConversationId": intent.marketplace_conversation_id,
            "merchantId": "MID",
            "paymentId": "P123",
            "status": "SUCCESS",
            "iyziReferenceCode": "REF_1",
            "iyziEventType": "PAYMENT_API",
            "iyziEventTime": 1234567890,
        }
        sig = iyzico_sig_v3_direct(settings.IYZICO_SECRET_KEY, payload)

        resp = self.client.post(reverse("payments:iyzico-webhook"), data=payload, format="json", HTTP_X_IYZ_SIGNATURE_V3=sig)
        self.assertEqual(resp.status_code, 200)

        intent.refresh_from_db()
        self.assertEqual(intent.status, PaymentIntent.Status.PAID)
        self.assertTrue(intent.is_processed)

        w = Wallet.objects.get(user=self.user)
        self.assertEqual(w.pending_balance, 1000)

    def test_cancelled_marks_intent_cancelled_without_wallet_change(self):
        intent = PaymentIntent.objects.create(
            user=self.user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=1000,
            status=PaymentIntent.Status.INITIATED,
        )
        payload = {
            "paymentConversationId": str(intent.pk),
            "merchantId": "MID",
            "paymentId": "P124",
            "status": "CANCELLED",
            "iyziReferenceCode": "REF_2",
            "iyziEventType": "PAYMENT_API",
            "iyziEventTime": 1234567891,
        }
        sig = iyzico_sig_v3_direct(settings.IYZICO_SECRET_KEY, payload)

        resp = self.client.post(reverse("payments:iyzico-webhook"), data=payload, format="json", HTTP_X_IYZ_SIGNATURE_V3=sig)
        self.assertEqual(resp.status_code, 200)

        intent.refresh_from_db()
        self.assertEqual(intent.status, PaymentIntent.Status.CANCELLED)
        self.assertFalse(intent.is_processed)

        w = Wallet.objects.get(user=self.user)
        self.assertEqual(w.pending_balance, 0)
        self.assertEqual(w.balance, 0)
