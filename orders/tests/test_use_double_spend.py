from django.test import TestCase
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from orders.services_cart import CartService
from orders.models import Order
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device, seed_wallet
from wallets.models import WalletTransaction


class DoubleSpendRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username="customer")
        self.cashier = create_user(username="cashier")
        self.business = create_business(name="Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=1000)
        seed_wallet(user=self.customer, amount=5000)
        enable_push_device(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

    def test_double_consume_does_not_create_second_wallet_debit_or_order(self):
        self.client.force_authenticate(self.customer)
        token = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="double-spend-create",
        ).data["token"]

        self.client.force_authenticate(self.cashier)
        first = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        second = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.data["code"], "checkout_session_already_consumed")
        self.assertEqual(second.data["order_id"], first.data["order_id"])
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(WalletTransaction.objects.filter(order__isnull=False, transaction_type=WalletTransaction.Type.PURCHASE).count(), 1)
