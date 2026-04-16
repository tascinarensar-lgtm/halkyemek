from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from businesses.models import BusinessProfile


class ContactSemanticsCleanupTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin-clean", password="pass", role=User.Role.ADMIN)
        self.contact = User.objects.create_user(
            username="kyc-provenance",
            password="pass",
            email="contact-user@example.com",
            google_email="contact-google@example.com",
            role=User.Role.CUSTOMER,
        )
        self.business = BusinessProfile.objects.create(
            contact_user=self.contact,
            business_name="Semantic Biz",
            category="Food",
            adress="Adres",
            district=BusinessProfile.District.BEYLIKDUZU,
            is_active=True,
            is_approved=True,
            is_listed=True,
            kyc_contact_name="Semantik",
            kyc_contact_surname="Test",
            kyc_email="official-ops@example.com",
            kyc_gsm_number="05550001122",
        )

    def test_ops_business_search_uses_explicit_contact_fields_not_contact_user_email(self):
        self.client.force_authenticate(self.admin)

        response = self.client.get("/api/v1/ops/businesses/", {"q": "contact-user@example.com"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["count"], 0)

        response = self.client.get("/api/v1/ops/businesses/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["count"], 1)
        result = response.data["data"]["results"][0]
        self.assertEqual(result["contact"]["email"], "official-ops@example.com")
        self.assertEqual(result["contact"]["gsm_number"], "05550001122")
