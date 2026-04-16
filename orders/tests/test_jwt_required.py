from django.test import TestCase
from rest_framework.test import APIClient

from test_support import create_business, create_category, create_menu_item


class JwtRequiredTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.business = create_business(name="Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category)

    def test_checkout_endpoints_require_authentication(self):
        create_resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="jwt-required-create",
        )
        self.assertEqual(create_resp.status_code, 401)
        detail_resp = self.client.get("/api/v1/checkout-sessions/nonexistent/")
        self.assertEqual(detail_resp.status_code, 401)
