from datetime import timedelta

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from orders.models import Order
from payments.models import PaymentIntent, PaymentReversal
from payments.services_reversals import PaymentReversalService
from payouts.models import BusinessEarning
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


class OpsReversalApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_user(username="ops-admin", role=User.Role.ADMIN, is_staff=True)
        self.client.force_authenticate(self.admin)
        self.customer = create_user(username="ops-customer")
        self.business = create_business(name="Ops Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, name="Menu", slug="ops-menu", price_amount=100)
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


    def test_ops_refund_requires_idempotency_key(self):
        order = self._paid_order()

        response = self.client.post(
            reverse("payments:ops-order-refund", kwargs={"order_id": order.id}),
            {"amount": 40, "reason_code": "OPS_REFUND", "note": "cashier correction"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("idempotency_key", response.json()["error"]["message"])

    def test_ops_order_refund_endpoint_applies_reversal_and_returns_contract(self):
        order = self._paid_order()

        response = self.client.post(
            reverse("payments:ops-order-refund", kwargs={"order_id": order.id}),
            {"amount": 40, "reason_code": "OPS_REFUND", "note": "cashier correction", "idempotency_key": "ops-refund-1"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()["data"]
        self.assertEqual(body["reversal"]["reversal_type"], PaymentReversal.Type.ORDER_REFUND)
        self.assertEqual(body["reversal"]["amount"], 40)
        self.assertEqual(body["business_mode"], "pre_payout_reversed")
        order.refresh_from_db()
        self.assertEqual(int(order.refunded_amount), 40)

    def test_ops_topup_reversal_endpoint_returns_requested_status_for_manual_review_case(self):
        risk_user = create_user(username="ops-risk-customer")
        intent = PaymentIntent.objects.create(
            user=risk_user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=risk_user, amount=100, payment_intent=intent)

        response = self.client.post(
            reverse("payments:ops-topup-reversal", kwargs={"intent_id": intent.id}),
            {"amount": 300, "reason_code": "OPS_TOPUP_REVERSAL", "note": "bank reversal", "idempotency_key": "ops-topup-reversal-1"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        reversal = response.json()["data"]["reversal"]
        self.assertEqual(reversal["status"], PaymentReversal.Status.REQUESTED)
        self.assertIn("MANUAL_REVIEW", reversal["failure_reason"])

    def test_ops_chargeback_endpoint_supports_order_source(self):
        order = self._paid_order()

        response = self.client.post(
            reverse("payments:ops-chargeback"),
            {"source": "order", "order_id": order.id, "amount": 100, "note": "scheme chargeback", "idempotency_key": "ops-chargeback-1"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()["data"]
        self.assertEqual(body["reversal"]["reversal_type"], PaymentReversal.Type.CHARGEBACK)
        self.assertEqual(body["business_mode"], "pre_payout_reversed")


    def test_ops_reversal_resolve_endpoint_clears_manual_review_and_unblocks_wallet(self):
        risk_user = create_user(username="ops-risk-resolve")
        intent = PaymentIntent.objects.create(
            user=risk_user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=risk_user, amount=100, payment_intent=intent)
        WalletService.topup(user=risk_user, amount=50, payment_intent=intent, description="available")
        reversal = PaymentReversalService.apply_chargeback(payment_intent=intent, amount=300).reversal
        WalletService.topup(user=risk_user, amount=150, payment_intent=intent, description="recovery funds")

        response = self.client.post(
            reverse("payments:ops-payment-reversal-resolve", kwargs={"reversal_id": reversal.id}),
            {"idempotency_key": "ops-resolve-1", "note": "customer repaid"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        reversal.refresh_from_db()
        risk_user.wallet.refresh_from_db()
        self.assertEqual(reversal.review_status, PaymentReversal.ReviewStatus.RESOLVED)
        self.assertTrue(risk_user.wallet.is_active)

    def test_ops_reversal_list_endpoint_filters_by_status(self):
        intent = PaymentIntent.objects.create(
            user=self.customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup(user=self.customer, amount=300, payment_intent=intent, description="seed")
        PaymentReversal.objects.create(
            user=self.customer,
            payment_intent=intent,
            reversal_type=PaymentReversal.Type.TOPUP_REVERSAL,
            status=PaymentReversal.Status.REQUESTED,
            amount=10,
            idempotency_key="ops-list-requested-1",
            failure_reason="INSUFFICIENT_AVAILABLE_BALANCE_MANUAL_REVIEW",
        )

        response = self.client.get(reverse("payments:ops-payment-reversal-list"), {"status": PaymentReversal.Status.REQUESTED})

        self.assertEqual(response.status_code, 200)
        results = response.json()["data"]["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["status"], PaymentReversal.Status.REQUESTED)
