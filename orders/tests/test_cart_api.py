from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from test_support import create_business, create_category, create_menu_item, create_user, enable_push_device


class CartApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_user(username="cart-api-user")
        enable_push_device(user=self.user)
        self.business = create_business(name="Cart API Biz")
        self.other_business = create_business(name="Other Cart API Biz")
        self.category = create_category(business=self.business, name="Main")
        self.other_category = create_category(business=self.other_business, name="Main")
        self.item = create_menu_item(
            business=self.business,
            category=self.category,
            name="Kofte",
            slug="kofte",
            price_amount=15000,
        )
        self.other_item = create_menu_item(
            business=self.other_business,
            category=self.other_category,
            name="Lahmacun",
            slug="lahmacun",
            price_amount=14000,
        )

    def _auth(self):
        self.client.force_authenticate(self.user)

    def test_requires_authentication(self):
        resp = self.client.get("/api/v1/cart/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_add_item_and_get_cart_detail(self):
        self._auth()
        add = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.item.id, "quantity": 2},
            format="json",
        )
        self.assertEqual(add.status_code, status.HTTP_200_OK)
        self.assertEqual(add.data["item_count"], 1)
        self.assertEqual(add.data["subtotal_amount"], 30000)
        self.assertEqual(add.data["total_amount"], 31000)

        detail = self.client.get("/api/v1/cart/")
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(len(detail.data["items"]), 1)
        self.assertEqual(detail.data["items"][0]["quantity"], 2)

    def test_update_remove_clear_and_preview(self):
        self._auth()
        add = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.item.id, "quantity": 1},
            format="json",
        )
        item_id = add.data["items"][0]["menu_item_id"]
        cart_id = add.data["id"]

        from orders.models import CartItem

        cart_item = CartItem.objects.get(cart_id=cart_id, menu_item_id=item_id)
        upd = self.client.patch(
            f"/api/v1/cart/items/{cart_item.id}/",
            {"quantity": 3},
            format="json",
        )
        self.assertEqual(upd.status_code, status.HTTP_200_OK)
        self.assertEqual(upd.data["items"][0]["quantity"], 3)

        preview = self.client.get("/api/v1/cart/checkout-preview/")
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertEqual(preview.data["subtotal_amount"], 45000)

        removed = self.client.delete(f"/api/v1/cart/items/{cart_item.id}/")
        self.assertEqual(removed.status_code, status.HTTP_200_OK)
        self.assertEqual(removed.data["item_count"], 0)

        self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.item.id, "quantity": 1},
            format="json",
        )
        cleared = self.client.delete("/api/v1/cart/clear/")
        self.assertEqual(cleared.status_code, status.HTTP_200_OK)
        self.assertEqual(cleared.data["item_count"], 0)

    def test_cross_business_cart_rejected(self):
        self._auth()
        first = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.item.id, "quantity": 1},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_200_OK)

        second = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.other_item.id, "quantity": 1},
            format="json",
        )
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

    def test_empty_active_cart_can_switch_business(self):
        self._auth()
        first = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.item.id, "quantity": 1},
            format="json",
        )
        self.assertEqual(first.status_code, status.HTTP_200_OK)

        cleared = self.client.delete("/api/v1/cart/clear/")
        self.assertEqual(cleared.status_code, status.HTTP_200_OK)
        self.assertEqual(cleared.data["item_count"], 0)

        second = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.other_item.id, "quantity": 1},
            format="json",
        )

        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(second.data["business"], self.other_business.id)
        self.assertEqual(second.data["item_count"], 1)

    def test_cart_is_isolated_between_users(self):
        self._auth()
        first_user_cart = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.item.id, "quantity": 1},
            format="json",
        )
        self.assertEqual(first_user_cart.status_code, status.HTTP_200_OK)

        other_user = create_user(username="cart-api-other-user")
        enable_push_device(user=other_user)
        self.client.force_authenticate(other_user)

        second_user_cart = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.other_item.id, "quantity": 1},
            format="json",
        )

        self.assertEqual(second_user_cart.status_code, status.HTTP_200_OK)
        self.assertEqual(second_user_cart.data["business"], self.other_business.id)
