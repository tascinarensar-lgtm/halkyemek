from django.test import TestCase
from payments.marketplace import calculate_split


class MarketplaceSplitTests(TestCase):
    def test_split_calculation(self):
        split = calculate_split(gross_amount=10000, commission_bps=1000)
        self.assertEqual(split["gross_price"], 10000)
        self.assertEqual(split["platform_fee"], 1000)
        self.assertEqual(split["submerchant_price"], 9000)