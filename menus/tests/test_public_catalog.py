from django.test import TestCase
from django.test.utils import override_settings
from rest_framework.test import APIClient

from test_support import create_business, create_category, create_menu_item


class PublicCatalogTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.business = create_business(name="Visible Biz", district="BEYLIKDUZU", is_active=True, is_approved=True, is_listed=True)
        hidden_business = create_business(name="Hidden Biz", district="BEYLIKDUZU", is_active=True, is_approved=False, is_listed=True)
        visible_category = create_category(business=self.business, name="Main", is_active=True, is_visible=True)
        hidden_category = create_category(business=self.business, name="Hidden", is_active=False, is_visible=False)
        create_menu_item(business=self.business, category=visible_category, name="Visible Item", slug="visible-item", is_active=True, is_visible=True, is_available=True)
        create_menu_item(business=self.business, category=visible_category, name="Sold Out", slug="sold-out", is_active=True, is_visible=True, is_available=False)
        create_category(business=hidden_business, name="Ignore")

    def test_public_business_list_by_district(self):
        resp = self.client.get("/api/v1/catalog/businesses/?district=BEYLIKDUZU")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["business_name"], "Visible Biz")

    def test_public_menu_filtering_works(self):
        resp = self.client.get(f"/api/v1/catalog/businesses/{self.business.id}/menu/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["categories"]), 1)
        items = resp.data["categories"][0]["menu_items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "Visible Item")


    def test_invalid_district_returns_400(self):
        resp = self.client.get("/api/v1/catalog/businesses/?district=INVALID")
        self.assertEqual(resp.status_code, 400)

    def test_hidden_category_with_no_public_items_is_not_listed(self):
        create_category(business=self.business, name="Empty Visible", is_active=True, is_visible=True)
        resp = self.client.get(f"/api/v1/catalog/businesses/{self.business.id}/menu/")
        self.assertEqual(resp.status_code, 200)
        category_names = [category["name"] for category in resp.data["categories"]]
        self.assertEqual(category_names, ["Main"])

    def test_marketplace_hidden_business_is_excluded_from_public_catalog(self):
        self.business.marketplace_is_visible = False
        self.business.save(update_fields=["marketplace_is_visible"])

        list_resp = self.client.get("/api/v1/catalog/businesses/?district=BEYLIKDUZU")
        self.assertEqual(list_resp.status_code, 200)
        self.assertEqual(list_resp.data["count"], 0)

        menu_resp = self.client.get(f"/api/v1/catalog/businesses/{self.business.id}/menu/")
        self.assertEqual(menu_resp.status_code, 404)

    @override_settings(CORS_ALLOWED_ORIGINS=["http://localhost:3000"])
    def test_public_catalog_preflight_allows_request_id_header(self):
        response = self.client.options(
            "/api/v1/catalog/businesses/?district=BEYLIKDUZU",
            HTTP_ORIGIN="http://localhost:3000",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="x-request-id",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["access-control-allow-origin"], "http://localhost:3000")
        self.assertIn("x-request-id", response["access-control-allow-headers"].lower())

    @override_settings(CORS_ALLOWED_ORIGINS=["http://localhost:3000"])
    def test_public_catalog_get_exposes_request_id_header_for_browser_clients(self):
        response = self.client.get(
            "/api/v1/catalog/businesses/?district=BEYLIKDUZU",
            HTTP_ORIGIN="http://localhost:3000",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["access-control-allow-origin"], "http://localhost:3000")
        self.assertIn("X-Request-ID", response["access-control-expose-headers"])
