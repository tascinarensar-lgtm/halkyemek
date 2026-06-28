from django.test import TestCase
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from menus.models import MenuItemQuota
from orders.models import CheckoutQuotaReservation, Order
from test_support import (
    add_membership,
    create_business,
    create_category,
    create_menu_item,
    create_user,
    enable_push_device,
    seed_wallet,
)
from wallets.models import Wallet


class MenuQuotaSmokeFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = create_user(username=f"quota-smoke-owner-{self._testMethodName}")
        self.cashier = create_user(username=f"quota-smoke-cashier-{self._testMethodName}")
        self.customer = create_user(username=f"quota-smoke-customer-{self._testMethodName}")
        self.second_customer = create_user(username=f"quota-smoke-second-{self._testMethodName}")
        self.business = create_business(name=f"Quota Smoke Biz {self._testMethodName}")
        add_membership(business=self.business, user=self.owner, role=BusinessMember.Role.OWNER)
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Smoke Menü")
        self.menu_item = create_menu_item(
            business=self.business,
            category=self.category,
            name="Smoke Kota Menü",
            slug=f"smoke-kota-menu-{self._testMethodName}",
            price_amount=12000,
        )
        seed_wallet(user=self.customer, amount=200000)
        seed_wallet(user=self.second_customer, amount=200000)
        enable_push_device(user=self.customer)
        enable_push_device(user=self.second_customer)

    def _set_quota_via_management_api(
        self,
        *,
        total: int,
        remaining: int,
        reserved: int = 0,
        low_stock_threshold: int = 1,
    ) -> MenuItemQuota:
        quota, _ = MenuItemQuota.objects.update_or_create(
            menu_item=self.menu_item,
            defaults={
                "is_enabled": True,
                "quota_total": total,
                "quota_remaining": remaining,
                "quota_reserved": reserved,
                "low_stock_threshold": low_stock_threshold,
            },
        )

        self.client.force_authenticate(self.owner)
        response = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/menu-items/{self.menu_item.id}/",
            {
                "quota_enabled": True,
                "quota_total": total,
                "quota_remaining": remaining,
                "low_stock_threshold": low_stock_threshold,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["quota_enabled"], True)
        self.assertEqual(response.data["quota_total"], total)
        self.assertEqual(response.data["quota_remaining"], remaining)

        quota.refresh_from_db()
        self.assertEqual(quota.quota_reserved, reserved)
        return quota

    def _public_menu_item_payload(self) -> dict:
        response = self.client.get(f"/api/v1/catalog/businesses/{self.business.id}/menu/")
        self.assertEqual(response.status_code, 200)
        for category in response.data["categories"]:
            for item in category["menu_items"]:
                if int(item["id"]) == int(self.menu_item.id):
                    return item
        self.fail("Smoke menu item was not returned by public catalog API.")

    def _add_to_cart(self, *, user, quantity: int = 1):
        self.client.force_authenticate(user)
        return self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.menu_item.id, "quantity": quantity},
            format="json",
        )

    def _create_checkout(self, *, user, idempotency_key: str):
        self.client.force_authenticate(user)
        return self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=f"{idempotency_key}-{self._testMethodName}",
        )

    def _consume_checkout(self, *, token: str):
        self.client.force_authenticate(self.cashier)
        return self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )

    def test_smoke_successful_quota_checkout_and_consume_flow(self):
        quota = self._set_quota_via_management_api(total=2, remaining=2, reserved=0)

        public_item = self._public_menu_item_payload()
        self.assertEqual(public_item["quota_remaining"], 2)
        self.assertEqual(public_item["quota_label"], "Bugün 2 adet kaldı")
        self.assertEqual(public_item["is_sold_out"], False)
        self.assertEqual(public_item["can_add_to_cart"], True)

        wallet_before = Wallet.objects.get(user=self.customer).balance
        cart_response = self._add_to_cart(user=self.customer, quantity=1)
        self.assertEqual(cart_response.status_code, 200)

        checkout_response = self._create_checkout(user=self.customer, idempotency_key="smoke-success")
        self.assertEqual(checkout_response.status_code, 201)

        quota.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 1)
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=checkout_response.data["id"])
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.RESERVED)

        consume_response = self._consume_checkout(token=checkout_response.data["token"])
        self.assertEqual(consume_response.status_code, 200)

        quota.refresh_from_db()
        reservation.refresh_from_db()
        order = Order.objects.get(id=consume_response.data["order_id"])
        wallet_after = Wallet.objects.get(user=self.customer).balance

        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.COMMITTED)
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(order.checkout_session_id, checkout_response.data["id"])
        self.assertEqual(order.status, Order.Status.USED)
        self.assertEqual(wallet_after, wallet_before - checkout_response.data["amount"])

    def test_smoke_cancel_releases_reserved_quota(self):
        quota = self._set_quota_via_management_api(total=2, remaining=2, reserved=0)

        cart_response = self._add_to_cart(user=self.customer, quantity=1)
        self.assertEqual(cart_response.status_code, 200)
        checkout_response = self._create_checkout(user=self.customer, idempotency_key="smoke-cancel")
        self.assertEqual(checkout_response.status_code, 201)

        quota.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 1)
        self.assertEqual(quota.quota_reserved, 1)

        self.client.force_authenticate(self.customer)
        cancel_response = self.client.post(
            f"/api/v1/checkout-sessions/{checkout_response.data['token']}/cancel/",
            {},
            format="json",
        )
        self.assertEqual(cancel_response.status_code, 200)

        quota.refresh_from_db()
        reservation = CheckoutQuotaReservation.objects.get(checkout_session_id=checkout_response.data["id"])
        self.assertEqual(quota.quota_remaining, 2)
        self.assertEqual(quota.quota_reserved, 0)
        self.assertEqual(reservation.status, CheckoutQuotaReservation.Status.RELEASED)

    def test_smoke_sold_out_public_state_and_second_customer_block(self):
        quota = self._set_quota_via_management_api(total=1, remaining=1, reserved=0)

        cart_response = self._add_to_cart(user=self.customer, quantity=1)
        self.assertEqual(cart_response.status_code, 200)
        checkout_response = self._create_checkout(user=self.customer, idempotency_key="smoke-sold-out")
        self.assertEqual(checkout_response.status_code, 201)

        quota.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 0)
        self.assertEqual(quota.quota_reserved, 1)

        public_item = self._public_menu_item_payload()
        self.assertEqual(public_item["quota_label"], "Tükendi")
        self.assertEqual(public_item["is_sold_out"], True)
        self.assertEqual(public_item["can_add_to_cart"], False)

        second_cart_response = self._add_to_cart(user=self.second_customer, quantity=1)
        self.assertEqual(second_cart_response.status_code, 409)
        self.assertEqual(second_cart_response.data["error"]["code"], "menu_item_sold_out")

        quota.refresh_from_db()
        self.assertEqual(quota.quota_remaining, 0)
        self.assertEqual(quota.quota_reserved, 1)
