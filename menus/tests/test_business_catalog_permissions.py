from django.test import TestCase
from rest_framework.test import APIClient

from businesses.models import BusinessMember, BusinessProfile
from menus.models import MenuItem
from test_support import add_membership, create_business, create_category, create_menu_item, create_user


class BusinessCatalogPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = create_user(username="owner")
        self.manager = create_user(username="manager")
        self.cashier = create_user(username="cashier")
        self.other = create_user(username="other")

        self.business = create_business(contact_user=self.owner, name="Biz")
        self.other_business = create_business(name="Other Biz", district=BusinessProfile.District.BEYLIKDUZU)
        add_membership(business=self.business, user=self.owner, role=BusinessMember.Role.OWNER)
        add_membership(business=self.business, user=self.manager, role=BusinessMember.Role.MANAGER)
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)

        self.category = create_category(business=self.business, name="Burger")
        self.seed_item = create_menu_item(business=self.business, category=self.category, name="Seed Burger")
        self.marketplace_category = self.seed_item.marketplace_category_assignments.first().marketplace_category

    def test_membership_gives_business_access(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.get(f"/api/v1/businesses/{self.business.id}/categories/")
        self.assertEqual(resp.status_code, 200)

    def test_manager_can_activate_system_category(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/categories/",
            {"marketplace_category": self.marketplace_category.id, "sort_order": 2, "is_active": True},
            format="json",
        )
        self.assertIn(resp.status_code, {200, 201})
        self.assertTrue(resp.data["is_selected"])

    def test_cashier_cannot_activate_system_category(self):
        self.client.force_authenticate(self.cashier)
        resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/categories/",
            {"marketplace_category": self.marketplace_category.id, "sort_order": 2, "is_active": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_non_member_gets_403_for_categories(self):
        self.client.force_authenticate(self.other)
        resp = self.client.get(f"/api/v1/businesses/{self.business.id}/categories/")
        self.assertEqual(resp.status_code, 403)

    def test_manager_can_create_menu_item_for_system_category(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/menu-items/",
            {
                "name": "Classic Burger",
                "slug": "classic-burger",
                "price_amount": 25000,
                "is_active": True,
                "is_visible": True,
                "is_available": True,
                "marketplace_category_ids": [self.marketplace_category.id],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(MenuItem.objects.filter(business=self.business, slug="classic-burger").exists())

    def test_cashier_cannot_create_menu_item(self):
        self.client.force_authenticate(self.cashier)
        resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/menu-items/",
            {
                "name": "Classic Burger",
                "slug": "classic-burger",
                "price_amount": 25000,
                "is_active": True,
                "is_visible": True,
                "is_available": True,
                "marketplace_category_ids": [self.marketplace_category.id],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_cannot_create_menu_item_with_invalid_system_category(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/menu-items/",
            {
                "name": "Invalid",
                "slug": "invalid",
                "price_amount": 25000,
                "is_active": True,
                "is_visible": True,
                "is_available": True,
                "marketplace_category_ids": [999999],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
