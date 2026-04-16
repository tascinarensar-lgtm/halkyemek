from django.test import TestCase
from rest_framework.test import APIClient

from orders.services_cart import CartService
from businesses.models import BusinessMember
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device, seed_wallet


class OrderListQueryShapeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_user(username="nplus-customer")
        self.cashier = create_user(username="nplus-cashier")
        self.business = create_business(name="Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=1600)
        seed_wallet(user=self.user, amount=5000)
        enable_push_device(user=self.user)
        CartService.add_item(user=self.user, menu_item=self.menu_item, quantity=1)

    def test_order_list_returns_related_display_fields(self):
        self.client.force_authenticate(self.user)
        token = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="n-plus-one-create",
        ).data["token"]
        self.client.force_authenticate(self.cashier)
        self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")

        self.client.force_authenticate(self.user)
        resp = self.client.get("/api/v1/orders/")
        self.assertEqual(resp.status_code, 200)
        result = resp.data["results"][0]
        self.assertEqual(result["business_name"], self.business.business_name)
        self.assertEqual(result["order_items"][0]["menu_item_name"], self.menu_item.name)
