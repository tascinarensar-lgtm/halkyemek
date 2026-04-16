from django.test import TestCase
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from orders.services_cart import CartService
from orders.models import Order
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device, seed_wallet


class CheckoutConsumeGeneratesOrderQrTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username="qr-customer")
        self.cashier = create_user(username="qr-cashier")
        self.business = create_business(name="Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=1900)
        seed_wallet(user=self.customer, amount=5000)
        enable_push_device(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

    def test_consume_creates_paid_order_with_qr_token_and_expiry(self):
        self.client.force_authenticate(self.customer)
        token = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="qr-use-create",
        ).data["token"]

        self.client.force_authenticate(self.cashier)
        resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)

        order = Order.objects.get(id=resp.data["order_id"])
        self.assertEqual(order.status, Order.Status.PAID)
        self.assertTrue(order.qr_token)
        self.assertIsNotNone(order.expires_at)
