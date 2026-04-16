from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from orders.models import Order
from payouts.models import BusinessEarning, Payout
from payouts.services import PayoutService
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


class PayoutFlowTests(TestCase):
    def setUp(self):
        self.customer = create_user(username="customer")
        self.business = create_business(name="Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, name="Menu", slug="menu", price_amount=100)
        seed_wallet(user=self.customer, amount=1000)

    def _paid_order_and_earning(self):
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
            status=BusinessEarning.Status.PENDING,
        )

    def test_payout_batch_creation(self):
        earning = self._paid_order_and_earning()
        moved = PayoutService.run_eligibility_sweep()
        self.assertEqual(moved, 1)
        batch = PayoutService.create_batch_for_eligible()
        payout = Payout.objects.get(batch=batch, business=self.business)
        self.assertEqual(batch.total_amount, 100)
        self.assertEqual(batch.earning_count, 1)
        self.assertEqual(payout.amount, 100)
        earning.refresh_from_db()
        self.assertEqual(earning.status, BusinessEarning.Status.IN_PAYOUT)

    def test_payout_confirm(self):
        earning = self._paid_order_and_earning()
        PayoutService.run_eligibility_sweep()
        batch = PayoutService.create_batch_for_eligible()
        payout = Payout.objects.get(batch=batch, business=self.business)
        PayoutService.mark_payout_sent(payout_id=payout.id, provider_payout_id="MANUAL1")
        PayoutService.confirm_payout(payout_id=payout.id)
        payout.refresh_from_db()
        earning.refresh_from_db()
        batch.refresh_from_db()
        self.assertEqual(payout.status, "CONFIRMED")
        self.assertEqual(earning.status, BusinessEarning.Status.PAID)
        self.assertEqual(batch.status, batch.Status.CONFIRMED)
