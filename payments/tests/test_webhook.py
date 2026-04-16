from __future__ import annotations

import hashlib
import hmac
import json

from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from payments.models import PaymentIntent
from wallets.models import Wallet


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


class ProviderWebhookTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="u1", password="pass", role=User.Role.CUSTOMER)
        Wallet.objects.get_or_create(user=self.user)
        self.intent = PaymentIntent.objects.create(
            user=self.user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=5000,
        )

    def test_webhook_rejects_bad_signature(self):
        url = "/api/v1/payments/webhook/provider/"
        payload = {"type": "payment.paid", "data": {"intent_id": self.intent.pk, "provider_payment_id": "p1"}}
        body = json.dumps(payload).encode("utf-8")

        res = self.client.post(
            url,
            data=body,
            content_type="application/json",
            HTTP_X_PROVIDER_EVENT_ID="evt_1",
            HTTP_X_PROVIDER_SIGNATURE="bad",
        )
        self.assertEqual(res.status_code, 400)

    def test_webhook_processes_once_duplicate_event_is_ignored(self):
        url = "/api/v1/payments/webhook/provider/"
        payload = {"type": "payment.paid", "data": {"intent_id": self.intent.pk, "provider_payment_id": "p1"}}
        body = json.dumps(payload).encode("utf-8")
        secret = getattr(settings, "PAYMENT_WEBHOOK_SECRET", "dev-webhook-secret")
        sig = sign(secret, body)

        res1 = self.client.post(
            url,
            data=body,
            content_type="application/json",
            HTTP_X_PROVIDER_EVENT_ID="evt_2",
            HTTP_X_PROVIDER_SIGNATURE=sig,
        )
        self.assertEqual(res1.status_code, 200)

        res2 = self.client.post(
            url,
            data=body,
            content_type="application/json",
            HTTP_X_PROVIDER_EVENT_ID="evt_2",
            HTTP_X_PROVIDER_SIGNATURE=sig,
        )
        self.assertEqual(res2.status_code, 200)
