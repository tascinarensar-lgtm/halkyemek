from datetime import timedelta

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from orders.models import CheckoutSession
from orders.services_cart import CartService
from test_support import create_business, create_category, create_menu_item, create_user


class CleanupCheckoutSessionsCommandTests(TestCase):
    def test_command_does_not_overwrite_consumed_sessions(self):
        customer = create_user(username="cleanup-user")
        cashier = create_user(username="cleanup-cashier")
        business = create_business(name="Cleanup Biz")
        category = create_category(business=business, name="Main")
        menu_item = create_menu_item(business=business, category=category, price_amount=1500)
        now = timezone.now()
        CartService.add_item(user=customer, menu_item=menu_item, quantity=1)
        cart = customer.carts.get(status="ACTIVE")
        pricing = (cart.snapshot or {}).get("pricing") or {}

        pending_session = CheckoutSession.objects.create(
            user=customer,
            business=business,
            cart=cart,
            token=CheckoutSession.generate_token(),
            status=CheckoutSession.Status.PENDING,
            amount=int(pricing.get("total_payable_amount") or 0),
            subtotal_amount=int(pricing.get("subtotal_amount") or 0),
            customer_fee_amount=int(pricing.get("customer_fee_amount") or 0),
            business_fee_amount=int(pricing.get("business_fee_amount") or 0),
            business_net_amount=int(pricing.get("business_net_amount") or 0),
            platform_total_fee_amount=int(pricing.get("platform_total_fee_amount") or 0),
            item_count=int((cart.snapshot or {}).get("item_count") or 0),
            currency="TRY",
            business_name=business.business_name,
            pricing_snapshot=pricing,
            cart_snapshot=cart.snapshot,
            expires_at=now - timedelta(minutes=10),
        )
        consumed_session = CheckoutSession.objects.create(
            user=customer,
            business=business,
            cart=cart,
            token=CheckoutSession.generate_token(),
            status=CheckoutSession.Status.CONSUMED,
            amount=menu_item.price_amount + 1000,
            subtotal_amount=menu_item.price_amount,
            customer_fee_amount=1000,
            business_fee_amount=1000,
            business_net_amount=menu_item.price_amount - 1000,
            platform_total_fee_amount=2000,
            item_count=1,
            currency="TRY",
            business_name=business.business_name,
            pricing_snapshot={"subtotal_amount": menu_item.price_amount, "customer_fee_amount": 1000, "business_fee_amount": 1000},
            cart_snapshot={"item_count": 1, "items": []},
            expires_at=now - timedelta(minutes=10),
            consumed_at=now - timedelta(minutes=1),
            consumed_by=cashier,
        )

        call_command("cleanup_checkout_sessions", "--limit", "100")

        pending_session.refresh_from_db()
        consumed_session.refresh_from_db()
        self.assertEqual(pending_session.status, CheckoutSession.Status.EXPIRED)
        self.assertEqual(consumed_session.status, CheckoutSession.Status.CONSUMED)
