from django.test import TestCase
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from menus.models import BusinessOffer, MenuItemMarketplaceCategoryAssignment
from test_support import add_membership, create_business, create_category, create_menu_item, create_user


class BusinessCatalogCrudTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.manager = create_user(username="manager")
        self.other = create_user(username="other")
        self.business = create_business(name="Biz")
        add_membership(business=self.business, user=self.manager, role=BusinessMember.Role.MANAGER)

        self.category = create_category(business=self.business, name="Burger")
        self.menu_item = create_menu_item(
            business=self.business,
            category=self.category,
            name="Classic Burger",
            slug="classic-burger",
        )
        self.marketplace_category = self.menu_item.marketplace_category_assignments.first().marketplace_category

    def test_manager_can_retrieve_category_detail(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.get(f"/api/v1/businesses/{self.business.id}/categories/{self.marketplace_category.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], self.marketplace_category.id)

    def test_manager_can_update_category_primary_state(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/categories/{self.marketplace_category.id}/",
            {"is_primary": True},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["is_primary"])

    def test_category_with_linked_menu_items_cannot_be_deleted(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.delete(f"/api/v1/businesses/{self.business.id}/categories/{self.marketplace_category.id}/")
        self.assertEqual(resp.status_code, 400)

    def test_manager_can_retrieve_menu_item_detail(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.get(f"/api/v1/businesses/{self.business.id}/menu-items/{self.menu_item.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["id"], self.menu_item.id)

    def test_manager_can_update_menu_item_categories(self):
        self.client.force_authenticate(self.manager)
        second_category = create_category(business=self.business, name="Pilav")
        second_item = create_menu_item(business=self.business, category=second_category, name="Pilav Seed")
        second_marketplace_category = second_item.marketplace_category_assignments.first().marketplace_category

        resp = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/menu-items/{self.menu_item.id}/",
            {
                "name": "Updated Burger",
                "price_amount": 30000,
                "marketplace_category_ids": [self.marketplace_category.id, second_marketplace_category.id],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.menu_item.refresh_from_db()
        self.assertEqual(self.menu_item.name, "Updated Burger")
        self.assertEqual(self.menu_item.price_amount, 30000)
        self.assertEqual(
            MenuItemMarketplaceCategoryAssignment.objects.filter(menu_item=self.menu_item).count(),
            2,
        )

    def test_menu_item_delete_soft_deletes(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.delete(f"/api/v1/businesses/{self.business.id}/menu-items/{self.menu_item.id}/")
        self.assertEqual(resp.status_code, 204)
        self.menu_item.refresh_from_db()
        self.assertFalse(self.menu_item.is_active)
        self.assertFalse(self.menu_item.is_visible)
        self.assertFalse(self.menu_item.is_available)

    def test_non_member_cannot_access_detail_endpoints(self):
        self.client.force_authenticate(self.other)
        resp = self.client.get(f"/api/v1/businesses/{self.business.id}/menu-items/{self.menu_item.id}/")
        self.assertEqual(resp.status_code, 403)

    def test_offer_management_still_accepts_menu_item_link(self):
        self.client.force_authenticate(self.manager)
        payload = {
            "menu_item": self.menu_item.id,
            "title": "Aksam Menusu",
            "offer_price_amount": 2100,
            "starts_at": "2026-04-16T10:00:00Z",
            "ends_at": "2026-04-16T13:00:00Z",
        }
        resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/offers/",
            payload,
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(BusinessOffer.objects.filter(business=self.business).count(), 1)
