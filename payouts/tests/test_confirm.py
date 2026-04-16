from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from orders.models import Order
from payouts.models import BusinessEarning, Payout
from payouts.services import PayoutService
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


class ConfirmRegressionTests(TestCase):
    def setUp(self):
        customer = create_user(username="customer")
        self.business = create_business(name="Biz")
        category = create_category(business=self.business, name="Main")
        menu_item = create_menu_item(business=self.business, category=category, price_amount=100)
        seed_wallet(user=customer, amount=1000)
        order = Order.objects.create(user=customer, business=self.business, menu=menu_item, amount=100, status=Order.Status.CREATED)
        WalletService.purchase(user=customer, amount=100, description="buy", order=order)
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
        batch = PayoutService.create_batch_for_eligible()
        self.payout = Payout.objects.get(batch=batch)

    def test_confirm_requires_sent_state(self):
        PayoutService.confirm_payout(payout_id=self.payout.id)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "CREATED")
