from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from businesses.models import BusinessMember, BusinessProfile


class OpsPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin", password="pass", role=User.Role.ADMIN)
        self.customer = User.objects.create_user(username="customer", password="pass", role=User.Role.CUSTOMER)
        self.cashier = User.objects.create_user(username="cashier", password="pass", role=User.Role.CUSTOMER)
        self.business = BusinessProfile.objects.create(
            contact_user=self.customer,
            business_name="Biz",
            category="Burger",
            adress="Adres",
            district="BEYLIKDUZU",
            is_active=True,
            is_approved=True,
            is_listed=True,
        )

    def test_non_admin_cannot_view_ops_business_list(self):
        self.client.force_authenticate(self.customer)
        response = self.client.get("/api/v1/ops/businesses/")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_view_ops_business_list(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/v1/ops/businesses/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("count", response.data["data"])
        self.assertIn("results", response.data["data"])

    def test_non_admin_cannot_create_ops_business(self):
        self.client.force_authenticate(self.customer)
        response = self.client.post(
            "/api/v1/ops/businesses/",
            {"business_name": "Yeni Lokanta", "category": "Döner"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_create_ops_business_with_owner(self):
        owner = User.objects.create_user(username="new-owner", password="pass", role=User.Role.CUSTOMER)
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/ops/businesses/",
            {
                "business_name": "Yeni Lokanta",
                "category": "Döner",
                "address_line": "Beylikdüzü, İstanbul",
                "latitude": "41.001000",
                "longitude": "28.641000",
                "owner_user_id": owner.id,
                "owner_role": BusinessMember.Role.OWNER,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        business = BusinessProfile.objects.get(id=response.data["data"]["id"])
        self.assertEqual(business.business_name, "Yeni Lokanta")
        self.assertEqual(business.address_line, "Beylikdüzü, İstanbul")
        self.assertTrue(business.is_active)
        self.assertTrue(business.is_approved)
        self.assertTrue(business.is_listed)
        membership = BusinessMember.objects.get(business=business, user=owner)
        self.assertEqual(membership.role, BusinessMember.Role.OWNER)
        self.assertEqual(membership.granted_by, self.admin)

    def test_admin_cannot_create_ops_business_with_unsupported_category(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/ops/businesses/",
            {
                "business_name": "Eski Kategori",
                "category": "Ev Yemekleri",
                "address_line": "Beylikdüzü, İstanbul",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_admin_can_create_halktasarruf_business_with_halktasarruf_category(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/ops/businesses/",
            {
                "business_name": "Tasarruf Fırını",
                "category": "Fırın & Pastane",
                "supports_halkyemek": False,
                "supports_halktasarruf": True,
                "address_line": "Beylikdüzü, İstanbul",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        business = BusinessProfile.objects.get(id=response.data["data"]["id"])
        self.assertEqual(business.category, "Fırın & Pastane")
        self.assertFalse(business.supports_halkyemek)
        self.assertTrue(business.supports_halktasarruf)

    def test_ops_business_create_validates_location_pair(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/ops/businesses/",
            {
                "business_name": "Eksik Konum",
                "category": "Burger",
                "latitude": "41.001000",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_ops_business_create_rounds_high_precision_coordinates(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/ops/businesses/",
            {
                "business_name": "Hassas Konum",
                "category": "Burger",
                "address_line": "Beylikdüzü, İstanbul",
                "latitude": "41.001234567",
                "longitude": "28.641987654",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        business = BusinessProfile.objects.get(id=response.data["data"]["id"])
        self.assertEqual(str(business.latitude), "41.001235")
        self.assertEqual(str(business.longitude), "28.641988")

    def test_non_admin_cannot_grant_business_membership(self):
        self.client.force_authenticate(self.customer)
        response = self.client.post(
            f"/api/v1/ops/businesses/{self.business.id}/memberships/",
            {"user_id": self.cashier.id, "role": BusinessMember.Role.CASHIER},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_grant_business_membership(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/v1/ops/businesses/{self.business.id}/memberships/",
            {"user_id": self.cashier.id, "role": BusinessMember.Role.CASHIER},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        membership = BusinessMember.objects.get(business=self.business, user=self.cashier)
        self.assertEqual(membership.role, BusinessMember.Role.CASHIER)
        self.assertEqual(membership.granted_by, self.admin)
        self.assertTrue(membership.is_active)

    def test_admin_can_grant_business_membership_by_email(self):
        email_user = User.objects.create_user(
            username="email-cashier",
            email="cashier@example.com",
            password="pass",
            role=User.Role.CUSTOMER,
        )
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/v1/ops/businesses/{self.business.id}/memberships/",
            {"email": "CASHIER@example.com", "role": BusinessMember.Role.CASHIER},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        membership = BusinessMember.objects.get(business=self.business, user=email_user)
        self.assertEqual(membership.role, BusinessMember.Role.CASHIER)
        self.assertEqual(membership.granted_by, self.admin)
        self.assertTrue(membership.is_active)

    def test_admin_can_deactivate_business_membership(self):
        manager = User.objects.create_user(username="manager", password="pass", role=User.Role.CUSTOMER)
        BusinessMember.objects.create(
            business=self.business,
            user=manager,
            role=BusinessMember.Role.MANAGER,
            granted_by=self.admin,
            is_active=True,
        )
        BusinessMember.objects.create(
            business=self.business,
            user=self.cashier,
            role=BusinessMember.Role.CASHIER,
            granted_by=self.admin,
            is_active=True,
        )
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/v1/ops/businesses/{self.business.id}/memberships/deactivate/",
            {"user_id": self.cashier.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        membership = BusinessMember.objects.get(business=self.business, user=self.cashier)
        self.assertFalse(membership.is_active)

    def test_admin_can_update_business_status_flags(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            f"/api/v1/ops/businesses/{self.business.id}/status/",
            {"is_approved": True, "is_listed": False, "payout_onboarding_note": "missing iban"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.business.refresh_from_db()
        self.assertTrue(self.business.is_approved)
        self.assertFalse(self.business.is_listed)
        self.assertEqual(self.business.payout_onboarding_note, "missing iban")

    def test_admin_cannot_deactivate_last_owner_or_manager_membership(self):
        owner = User.objects.create_user(username="owner", password="pass", role=User.Role.CUSTOMER)
        BusinessMember.objects.create(
            business=self.business,
            user=owner,
            role=BusinessMember.Role.OWNER,
            granted_by=self.admin,
            is_active=True,
        )

        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/v1/ops/businesses/{self.business.id}/memberships/deactivate/",
            {"user_id": owner.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_admin_cannot_downgrade_last_owner_or_manager_membership(self):
        owner = User.objects.create_user(username="owner2", password="pass", role=User.Role.CUSTOMER)
        BusinessMember.objects.create(
            business=self.business,
            user=owner,
            role=BusinessMember.Role.OWNER,
            granted_by=self.admin,
            is_active=True,
        )

        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/v1/ops/businesses/{self.business.id}/memberships/",
            {"user_id": owner.id, "role": BusinessMember.Role.CASHIER, "is_active": True},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    @patch("businesses.api.views_ops.run_submerchant_onboarding")
    def test_non_admin_cannot_trigger_submerchant_onboarding(self, onboarding_mock):
        self.client.force_authenticate(self.customer)
        response = self.client.post(
            f"/api/v1/ops/businesses/{self.business.id}/iyzico/submerchant/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        onboarding_mock.assert_not_called()
