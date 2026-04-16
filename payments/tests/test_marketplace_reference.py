from django.test import TestCase
from payments.references import payment_conversation_id


class MarketplaceReferenceTests(TestCase):
    def test_payment_conversation_id_is_deterministic(self):
        self.assertEqual(payment_conversation_id(15), "HY-PI-15")