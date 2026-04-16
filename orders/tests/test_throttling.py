from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from common.throttles import CartActionThrottle, CheckoutPreviewThrottle, CheckoutSessionConsumeThrottle, CheckoutSessionCreateThrottle
from orders.services_cart import CartService
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device, seed_wallet


class ThrottlingRegressionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = create_user(username="customer")
        self.cashier = create_user(username="cashier")
        self.business = create_business(name="Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=5000)
        seed_wallet(user=self.user, amount=20000)
        enable_push_device(user=self.user)
        CartService.add_item(user=self.user, menu_item=self.menu_item, quantity=1)

    def _auth_customer(self):
        self.client.force_authenticate(self.user)

    def _auth_cashier(self):
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.client.force_authenticate(self.cashier)

    def test_checkout_session_create_throttle_is_enforced_for_fresh_keys(self):
        self._auth_customer()
        with patch.object(CheckoutSessionCreateThrottle, "rate", "2/min", create=True):
            for i in range(2):
                response = self.client.post(
                    "/api/v1/checkout-sessions/",
                    {},
                    format="json",
                    HTTP_IDEMPOTENCY_KEY=f"create-throttle-{i}",
                )
                self.assertEqual(response.status_code, status.HTTP_201_CREATED)

            blocked = self.client.post(
                "/api/v1/checkout-sessions/",
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY="create-throttle-over",
            )

        self.assertEqual(blocked.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_checkout_session_create_replay_is_not_blocked_after_limit(self):
        self._auth_customer()
        with patch.object(CheckoutSessionCreateThrottle, "rate", "2/min", create=True):
            first = self.client.post(
                "/api/v1/checkout-sessions/",
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY="create-replay-1",
            )
            second = self.client.post(
                "/api/v1/checkout-sessions/",
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY="create-replay-2",
            )
            replay = self.client.post(
                "/api/v1/checkout-sessions/",
                {},
                format="json",
                HTTP_IDEMPOTENCY_KEY="create-replay-1",
            )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay["Idempotency-Replayed"], "true")

    def test_checkout_session_consume_throttle_is_enforced(self):
        self._auth_customer()
        create_resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="consume-throttle-create",
        )
        token = create_resp.data["token"]

        self._auth_cashier()
        with patch.object(CheckoutSessionConsumeThrottle, "rate", "1/min", create=True):
            first = self.client.post(
                f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
                {},
                format="json",
            )
            blocked = self.client.post(
                f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
                {},
                format="json",
            )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(blocked.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_cart_action_throttle_is_enforced(self):
        self._auth_customer()
        with patch.object(CartActionThrottle, "rate", "2/min", create=True):
            first = self.client.post(
                "/api/v1/cart/items/",
                {"menu_item_id": self.menu_item.id, "quantity": 1},
                format="json",
            )
            second = self.client.post(
                "/api/v1/cart/items/",
                {"menu_item_id": self.menu_item.id, "quantity": 1},
                format="json",
            )
            blocked = self.client.post(
                "/api/v1/cart/items/",
                {"menu_item_id": self.menu_item.id, "quantity": 1},
                format="json",
            )

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(blocked.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_checkout_preview_throttle_is_enforced(self):
        self._auth_customer()
        self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.menu_item.id, "quantity": 1},
            format="json",
        )
        with patch.object(CheckoutPreviewThrottle, "rate", "1/min", create=True):
            first = self.client.get("/api/v1/cart/checkout-preview/")
            blocked = self.client.get("/api/v1/cart/checkout-preview/")

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(blocked.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def tearDown(self):
        cache.clear()
        if hasattr(CartActionThrottle, "rate"):
            CartActionThrottle.rate = None
        if hasattr(CheckoutPreviewThrottle, "rate"):
            CheckoutPreviewThrottle.rate = None
        if hasattr(CheckoutSessionCreateThrottle, "rate"):
            CheckoutSessionCreateThrottle.rate = None
        if hasattr(CheckoutSessionConsumeThrottle, "rate"):
            CheckoutSessionConsumeThrottle.rate = None
