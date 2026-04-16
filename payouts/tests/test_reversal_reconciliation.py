from datetime import timedelta

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from orders.models import Order
from payments.models import PaymentReversal
from payouts.models import BusinessEarning, PayoutAdjustment
from payouts.reconciliation import reconcile_business
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


class ReversalReconciliationTests(TestCase):
    def setUp(self):
        self.customer = create_user(username="customer-reversal-recon")
        self.business = create_business(name="Biz Reverse Recon")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=100)
        seed_wallet(user=self.customer, amount=1000)

    def _earning(self, *, status=BusinessEarning.Status.ELIGIBLE, reversed_amount=0):
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
        return BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=100,
            platform_fee_amount=0,
            net_amount=100,
            currency="TRY",
            eligible_at=timezone.now() - timedelta(days=1),
            status=status,
            reversed_amount=reversed_amount,
        )

    def test_reconcile_business_reports_outstanding_amounts_and_reversed_count(self):
        self._earning(status=BusinessEarning.Status.ELIGIBLE, reversed_amount=40)
        self._earning(status=BusinessEarning.Status.REVERSED, reversed_amount=100)

        report = reconcile_business(self.business)

        self.assertEqual(report.summary["earnings_count"]["ELIGIBLE"], 1)
        self.assertEqual(report.summary["earnings_count"]["REVERSED"], 1)
        self.assertEqual(report.summary["earning_amounts"]["eligible_outstanding_amount"], 60)
        self.assertEqual(report.summary["earning_amounts"]["paid_outstanding_amount"], 0)

    def test_payout_adjustment_unique_per_payment_reversal(self):
        order = Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=100,
            status=Order.Status.PAID,
            paid_at=timezone.now(),
            expires_at=timezone.now() + timedelta(hours=24),
        )
        reversal = PaymentReversal.objects.create(
            user=self.customer,
            order=order,
            reversal_type=PaymentReversal.Type.ORDER_REFUND,
            status=PaymentReversal.Status.APPLIED,
            amount=100,
            idempotency_key="padj-unique-1",
            wallet_effect_applied=True,
            business_effect_applied=True,
            applied_at=timezone.now(),
        )
        PayoutAdjustment.objects.create(
            business=self.business,
            order=order,
            payment_reversal=reversal,
            amount=-100,
            reason_code="ORDER_REFUND",
            description="first adjustment",
        )

        with self.assertRaises(ValidationError):
            PayoutAdjustment.objects.create(
                business=self.business,
                order=order,
                payment_reversal=reversal,
                amount=-100,
                reason_code="ORDER_REFUND",
                description="duplicate adjustment",
            )

    def test_reconcile_business_includes_pending_adjustment_total(self):
        earning = self._earning(status=BusinessEarning.Status.ELIGIBLE, reversed_amount=0)
        PayoutAdjustment.objects.create(
            business=self.business,
            order=earning.order,
            amount=-30,
            reason_code="ORDER_REFUND",
            description="pending adjustment",
            status=PayoutAdjustment.Status.PENDING,
        )

        report = reconcile_business(self.business)

        self.assertEqual(report.summary["pending_adjustments_total"], -30)
