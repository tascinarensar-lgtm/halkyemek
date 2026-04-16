from datetime import timedelta

from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from django.utils import timezone

from orders.models import Order
from payouts.models import BusinessEarning
from payouts.services import create_business_earning_for_order, default_business_earning_eligible_at
from test_support import create_business, create_category, create_menu_item, create_user


class BusinessEarningCreationTests(TestCase):
    def setUp(self):
        self.customer = create_user(username="customer")
        self.business = create_business(name="Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=1000)

    def _order(self):
        return Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=1000,
            status=Order.Status.PAID,
            paid_at=timezone.now(),
            expires_at=timezone.now() + timedelta(hours=24),
        )

    @override_settings(BUSINESS_PLATFORM_FEE_BPS=1250)
    def test_create_business_earning_uses_breakdown_and_is_idempotent(self):
        order = self._order()
        earning = create_business_earning_for_order(order=order, gross_amount=1000, currency="TRY")
        same = create_business_earning_for_order(order=order, gross_amount=1000, currency="TRY")

        self.assertEqual(earning.id, same.id)
        self.assertEqual(earning.gross_amount, 1000)
        self.assertEqual(earning.platform_fee_amount, 125)
        self.assertEqual(earning.net_amount, 875)
        self.assertEqual(earning.net_amount, 875)

    def test_create_business_earning_rejects_existing_mismatch(self):
        order = self._order()
        BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=1000,
            platform_fee_amount=100,
            net_amount=900,
            currency="TRY",
            eligible_at=timezone.now(),
            status=BusinessEarning.Status.PENDING,
        )

        with self.assertRaises(ValidationError):
            create_business_earning_for_order(order=order, gross_amount=1000, platform_fee_amount=0, currency="TRY")

    @override_settings(BUSINESS_EARNING_HOLD_HOURS=72)
    def test_default_eligible_at_uses_hold_hours_setting(self):
        now = timezone.now()
        eligible_at = default_business_earning_eligible_at(now=now)
        self.assertEqual(eligible_at, now + timedelta(days=3))

    def test_create_business_earning_uses_order_snapshot_defaults_when_arguments_omitted(self):
        order = Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=1300,
            subtotal_amount=1200,
            customer_fee_amount=100,
            business_fee_amount=150,
            total_charged_amount=1300,
            business_net_amount=1050,
            item_count=2,
            pricing_snapshot={
                "subtotal_amount": 1200,
                "customer_fee_amount": 100,
                "business_fee_amount": 150,
                "total_payable_amount": 1300,
                "business_net_amount": 1050,
                "platform_total_fee_amount": 250,
                "currency": "TRY",
            },
            status=Order.Status.PAID,
            paid_at=timezone.now(),
            expires_at=timezone.now() + timedelta(hours=24),
        )

        earning = create_business_earning_for_order(order=order)

        self.assertEqual(earning.gross_amount, 1200)
        self.assertEqual(earning.platform_fee_amount, 150)
        self.assertEqual(earning.net_amount, 1050)

    def test_create_business_earning_rejects_order_snapshot_amount_drift(self):
        order = Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=1300,
            subtotal_amount=1200,
            customer_fee_amount=100,
            business_fee_amount=150,
            total_charged_amount=1300,
            business_net_amount=1050,
            item_count=1,
            pricing_snapshot={
                "subtotal_amount": 999,
                "customer_fee_amount": 100,
                "business_fee_amount": 150,
                "total_payable_amount": 1099,
                "business_net_amount": 849,
                "platform_total_fee_amount": 250,
                "currency": "TRY",
            },
            status=Order.Status.PAID,
            paid_at=timezone.now(),
            expires_at=timezone.now() + timedelta(hours=24),
        )

        with self.assertRaises(ValidationError):
            create_business_earning_for_order(order=order)
