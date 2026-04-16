from django.test import TestCase
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from orders.services_cart import CartService
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device, seed_wallet


class ContractSemanticsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username="contract-customer")
        self.cashier = create_user(username="contract-cashier")
        self.business = create_business(name="Contract Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Burger")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=2500)
        seed_wallet(user=self.customer, amount=10000)
        enable_push_device(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

    def test_checkout_detail_and_consume_responses_expose_official_total_fields(self):
        self.client.force_authenticate(self.customer)
        create_resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="contract-semantics-create",
        )
        self.assertEqual(create_resp.status_code, 201)
        self.assertEqual(create_resp.data["total_payable_amount"], create_resp.data["amount"])

        token = create_resp.data["token"]
        self.client.force_authenticate(self.cashier)
        consume_resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )
        self.assertEqual(consume_resp.status_code, 200)
        self.assertEqual(consume_resp.data["total_charged_amount"], consume_resp.data["amount"])

    def test_business_order_detail_exposes_total_charged_amount(self):
        self.client.force_authenticate(self.customer)
        create_resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="contract-semantics-order-detail",
        )
        token = create_resp.data["token"]
        self.client.force_authenticate(self.cashier)
        consume_resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )
        order_id = consume_resp.data["order_id"]

        detail_resp = self.client.get(f"/api/v1/businesses/{self.business.id}/operations/orders/{order_id}/")
        self.assertEqual(detail_resp.status_code, 200)
        self.assertEqual(detail_resp.data["data"]["total_charged_amount"], detail_resp.data["data"]["amount"])
