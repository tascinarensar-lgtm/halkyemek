from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings

from orders.services_pricing import build_checkout_pricing_breakdown


class PricingServiceTests(TestCase):
    @override_settings(CUSTOMER_FIXED_FEE_KURUS=1000, BUSINESS_FIXED_FEE_KURUS=1000)
    def test_build_checkout_pricing_breakdown_returns_expected_values(self):
        breakdown = build_checkout_pricing_breakdown(subtotal_amount=25000)

        self.assertEqual(breakdown.subtotal_amount, 25000)
        self.assertEqual(breakdown.customer_fee_amount, 1000)
        self.assertEqual(breakdown.business_fee_amount, 1000)
        self.assertEqual(breakdown.total_payable_amount, 26000)
        self.assertEqual(breakdown.business_net_amount, 24000)
        self.assertEqual(breakdown.platform_total_fee_amount, 2000)

    def test_build_checkout_pricing_breakdown_rejects_non_positive_subtotal(self):
        with self.assertRaises(ValidationError):
            build_checkout_pricing_breakdown(subtotal_amount=0)

    @override_settings(BUSINESS_FIXED_FEE_KURUS=1000)
    def test_build_checkout_pricing_breakdown_rejects_negative_business_net(self):
        with self.assertRaises(ValidationError):
            build_checkout_pricing_breakdown(subtotal_amount=500)
