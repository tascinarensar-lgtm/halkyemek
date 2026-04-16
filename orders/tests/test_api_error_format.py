from django.test import TestCase
from rest_framework.test import APIClient

from orders.services_cart import CartService
from businesses.models import BusinessMember
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device


class CheckoutApiErrorFormatTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username="apifmt-customer")
        self.cashier = create_user(username="apifmt-cashier")
        self.business = create_business(name="Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=1800)
        enable_push_device(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

    def test_insufficient_balance_returns_standard_detail_payload(self):
        self.client.force_authenticate(self.customer)
        token = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="error-format-create",
        ).data["token"]

        self.client.force_authenticate(self.cashier)
        resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data["ok"], False)
        self.assertEqual(resp.data["error"]["code"], "ValidationError")
        self.assertIn("Insufficient", str(resp.data["error"]["message"]))
