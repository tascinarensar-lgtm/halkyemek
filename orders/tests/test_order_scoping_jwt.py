from django.test import TestCase
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from orders.services_cart import CartService
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device, seed_wallet


class CheckoutSessionScopingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username="scope-customer")
        self.cashier = create_user(username="scope-cashier")
        self.other = create_user(username="scope-other")
        enable_push_device(user=self.cashier)
        enable_push_device(user=self.other)
        self.business = create_business(name="Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category)
        seed_wallet(user=self.customer, amount=50000)
        enable_push_device(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        self.client.force_authenticate(self.customer)
        self.token = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="scoping-owner-create",
        ).data["token"]

    def test_owner_can_view_own_checkout_session(self):
        self.client.force_authenticate(self.customer)
        resp = self.client.get(f"/api/v1/checkout-sessions/{self.token}/")
        self.assertEqual(resp.status_code, 200)

    def test_business_member_can_view_checkout_session(self):
        self.client.force_authenticate(self.cashier)
        resp = self.client.get(f"/api/v1/checkout-sessions/{self.token}/")
        self.assertEqual(resp.status_code, 200)

    def test_unrelated_user_cannot_view_checkout_session(self):
        self.client.force_authenticate(self.other)
        resp = self.client.get(f"/api/v1/checkout-sessions/{self.token}/")
        self.assertEqual(resp.status_code, 403)


class OrderScopingForHybridUserTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_user(username="hybrid")
        self.business = create_business(name="Biz")
        add_membership(business=self.business, user=self.user, role=BusinessMember.Role.CASHIER)

        customer_business = create_business(name="Customer Biz")
        category = create_category(business=customer_business, name="Main")
        menu_item = create_menu_item(business=customer_business, category=category)
        seed_wallet(user=self.user, amount=50000)
        enable_push_device(user=self.user)
        CartService.add_item(user=self.user, menu_item=menu_item, quantity=1)

        self.client.force_authenticate(self.user)
        token = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="scoping-hybrid-create",
        ).data["token"]

        cashier = create_user(username="customer_biz_cashier")
        add_membership(business=customer_business, user=cashier, role=BusinessMember.Role.CASHIER)
        self.client.force_authenticate(cashier)
        resp = self.client.post(f"/api/v1/businesses/{customer_business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.order_id = resp.data["order_id"]

    def test_business_member_still_can_view_own_customer_order(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get(f"/api/v1/orders/{self.order_id}/")
        self.assertEqual(resp.status_code, 200)

    def test_business_member_list_includes_own_customer_orders(self):
        self.client.force_authenticate(self.user)
        resp = self.client.get("/api/v1/orders/")
        self.assertEqual(resp.status_code, 200)
        data = resp.data.get("results", resp.data)
        ids = [item["id"] for item in data]
        self.assertIn(self.order_id, ids)
