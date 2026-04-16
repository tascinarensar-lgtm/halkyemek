from django.test import TestCase
from accounts.models import User
from businesses.models import BusinessProfile


class SubmerchantFieldsTests(TestCase):
    def test_business_has_marketplace_fields(self):
        u = User.objects.create_user(username="b1", password="pass", role=User.Role.CUSTOMER)
        b = BusinessProfile.objects.create(
            contact_user=u,
            business_name="Biz",
            category="Food",
            adress="Addr",
            district="Beylikduzu",
            is_approved=True,
        )
        self.assertEqual(b.iyzico_submerchant_status, "DRAFT")
        self.assertEqual(b.iyzico_submerchant_key, "")