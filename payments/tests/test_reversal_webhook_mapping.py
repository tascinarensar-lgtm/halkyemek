import hashlib
import hmac
import json
from datetime import timedelta

from django.conf import settings
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from orders.models import Order
from payments.models import PaymentIntent, PaymentReversal
from payouts.models import BusinessEarning
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def iyzico_sig_v3_direct(secret: str, payload: dict) -> str:
    msg = f"{secret}{payload['iyziEventType']}{payload['paymentId']}{payload['paymentConversationId']}{payload['status']}"
    return hmac.new(secret.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()


class ReversalWebhookMappingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username="wh-customer")
        self.business = create_business(name="Webhook Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, name="Menu", slug="webhook-menu", price_amount=100)
        seed_wallet(user=self.customer, amount=1000)

    def _paid_order(self):
        order = Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=100,
            status=Order.Status.CREATED,
        )
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
        return order

    def test_mock_provider_order_refund_webhook_maps_to_domain_reversal(self):
        order = self._paid_order()
        payload = {
            "type": "payment.order_refund",
            "data": {"order_id": order.id, "amount": 30, "reason_code": "PROVIDER_REFUND"},
        }
        body = json.dumps(payload).encode("utf-8")
        sig = sign(settings.PAYMENT_WEBHOOK_SECRET, body)

        response = self.client.post(
            reverse("payments:provider-webhook"),
            data=body,
            content_type="application/json",
            HTTP_X_PROVIDER_EVENT_ID="evt-order-refund-1",
            HTTP_X_PROVIDER_SIGNATURE=sig,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "order_refund_applied")
        reversal = PaymentReversal.objects.get(order=order)
        self.assertEqual(reversal.reversal_type, PaymentReversal.Type.ORDER_REFUND)
        self.assertEqual(int(reversal.amount), 30)

    def test_mock_provider_chargeback_webhook_is_idempotent(self):
        intent = PaymentIntent.objects.create(
            user=self.customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
            provider_payment_id="pay-wh-chargeback-1",
        )
        WalletService.topup(user=self.customer, amount=300, payment_intent=intent, description="available")
        payload = {
            "type": "payment.chargeback",
            "data": {"intent_id": intent.id, "amount": 120, "provider_payment_id": "pay-wh-chargeback-1"},
        }
        body = json.dumps(payload).encode("utf-8")
        sig = sign(settings.PAYMENT_WEBHOOK_SECRET, body)
        url = reverse("payments:provider-webhook")

        first = self.client.post(url, data=body, content_type="application/json", HTTP_X_PROVIDER_EVENT_ID="evt-chargeback-mock-1", HTTP_X_PROVIDER_SIGNATURE=sig)
        second = self.client.post(url, data=body, content_type="application/json", HTTP_X_PROVIDER_EVENT_ID="evt-chargeback-mock-1", HTTP_X_PROVIDER_SIGNATURE=sig)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(PaymentReversal.objects.filter(payment_intent=intent, reversal_type=PaymentReversal.Type.CHARGEBACK).count(), 1)

    def test_iyzico_reversal_webhook_maps_to_topup_reversal(self):
        intent = PaymentIntent.objects.create(
            user=self.customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
            marketplace_conversation_id="HY-PI-1",
        )
        intent.marketplace_conversation_id = f"HY-PI-{intent.pk}"
        intent.provider_payment_id = "iyzi-pay-reversal-1"
        intent.save(update_fields=["marketplace_conversation_id", "provider_payment_id"])
        WalletService.topup(user=self.customer, amount=300, payment_intent=intent, description="available")

        payload = {
            "paymentConversationId": intent.marketplace_conversation_id,
            "merchantId": "MID",
            "paymentId": intent.provider_payment_id,
            "status": "SUCCESS",
            "iyziReferenceCode": "REF-REV-1",
            "iyziEventType": "PAYMENT_REVERSAL",
            "amount": 100,
            "iyziEventTime": 1234567890,
        }
        sig = iyzico_sig_v3_direct(settings.IYZICO_SECRET_KEY, payload)

        response = self.client.post(reverse("payments:iyzico-webhook"), data=payload, format="json", HTTP_X_IYZ_SIGNATURE_V3=sig)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], "topup_reversal_applied")
        reversal = PaymentReversal.objects.get(payment_intent=intent)
        self.assertEqual(reversal.reversal_type, PaymentReversal.Type.TOPUP_REVERSAL)
        self.assertEqual(int(reversal.amount), 100)
