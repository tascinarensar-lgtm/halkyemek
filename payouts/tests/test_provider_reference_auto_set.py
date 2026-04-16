from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from orders.models import Order
from payouts.models import BusinessEarning, Payout
from payouts.services import PayoutService
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


class ProviderReferenceAutoSetTests(TestCase):
    def test_provider_reference_is_set_on_batch_creation(self):
        customer = create_user(username="customer")
        business = create_business(name="Biz")
        category = create_category(business=business, name="Main")
        menu_item = create_menu_item(business=business, category=category, price_amount=100)
        seed_wallet(user=customer, amount=1000)
        order = Order.objects.create(user=customer, business=business, menu=menu_item, amount=100, status=Order.Status.CREATED)
        WalletService.purchase(user=customer, amount=100, description="buy", order=order)
        order.mark_paid(ttl_hours=24)
        order.save(update_fields=["status", "paid_at", "expires_at", "qr_token"])
        BusinessEarning.objects.create(
            business=business,
            order=order,
            gross_amount=100,
            platform_fee_amount=0,
            net_amount=100,
            currency="TRY",
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.ELIGIBLE,
        )
        batch = PayoutService.create_batch_for_eligible()
        payout = Payout.objects.get(batch=batch)
        self.assertTrue(payout.provider_reference)
