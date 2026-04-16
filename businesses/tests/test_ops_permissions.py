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
            category="Food",
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
