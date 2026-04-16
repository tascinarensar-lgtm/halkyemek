from django.test import TestCase
from rest_framework.test import APIClient

from orders.services_cart import CartService
from test_support import create_business, create_category, create_menu_item, create_user, enable_push_device, seed_wallet


class LegacyCreateOrderFlowRetiredTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_user(username="legacy-customer")
        self.business = create_business(name="Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=1700)
        seed_wallet(user=self.user, amount=5000)
        enable_push_device(user=self.user)
        self.client.force_authenticate(self.user)
        CartService.add_item(user=self.user, menu_item=self.menu_item, quantity=1)

    def test_direct_order_create_endpoint_is_not_available(self):
        resp = self.client.post("/api/v1/orders/", {
            "business": self.business.id,
            "menu": self.menu_item.id,
            "amount": self.menu_item.price_amount,
        }, format="json")
        self.assertEqual(resp.status_code, 405)

    def test_checkout_session_create_is_the_supported_entrypoint(self):
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="legacy-create-supported",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["status"], "PENDING")
