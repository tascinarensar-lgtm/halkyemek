from django.core.exceptions import ValidationError
from django.test import TestCase

from orders.models import Cart, CartItem, Order, OrderItem
from test_support import create_business, create_category, create_menu_item, create_user


class CartModelTests(TestCase):
    def setUp(self):
        self.user = create_user(username="cart-user")
        self.business = create_business(name="Cart Biz")
        self.other_business = create_business(name="Other Biz")
        self.category = create_category(business=self.business, name="Main")
        self.other_category = create_category(business=self.other_business, name="Main")
        self.item = create_menu_item(
            business=self.business,
            category=self.category,
            name="Soup",
            slug="soup",
            price_amount=1200,
        )
        self.other_item = create_menu_item(
            business=self.other_business,
            category=self.other_category,
            name="Other Soup",
            slug="other-soup",
            price_amount=900,
        )

    def test_single_active_cart_per_user(self):
        Cart.objects.create(user=self.user, business=self.business)
        with self.assertRaises(ValidationError):
            Cart.objects.create(user=self.user, business=self.business)

    def test_different_business_item_cannot_be_added(self):
        cart = Cart.objects.create(user=self.user, business=self.business)
        with self.assertRaises(ValidationError):
            CartItem.objects.create(
                cart=cart,
                menu_item=self.other_item,
                quantity=1,
                unit_price_amount=900,
                line_total_amount=900,
                menu_item_name="Other Soup",
            )

    def test_quantity_must_be_positive(self):
        cart = Cart.objects.create(user=self.user, business=self.business)
        with self.assertRaises(ValidationError):
            CartItem.objects.create(
                cart=cart,
                menu_item=self.item,
                quantity=0,
                unit_price_amount=1200,
                line_total_amount=0,
                menu_item_name="Soup",
            )

    def test_inactive_item_blocked(self):
        self.item.is_available = False
        self.item.save(update_fields=["is_available", "updated_at"])

        cart = Cart.objects.create(user=self.user, business=self.business)
        with self.assertRaises(ValidationError):
            CartItem.objects.create(
                cart=cart,
                menu_item=self.item,
                quantity=1,
                unit_price_amount=1200,
                line_total_amount=1200,
                menu_item_name="Soup",
            )

    def test_cart_totals_are_recomputed_from_items(self):
        cart = Cart.objects.create(
            user=self.user,
            business=self.business,
            customer_fee_amount=1000,
            total_amount=1000,
        )
        CartItem.objects.create(
            cart=cart,
            menu_item=self.item,
            quantity=2,
            unit_price_amount=1200,
            line_total_amount=2400,
            menu_item_name="Soup",
        )
        cart.refresh_from_db()
        self.assertEqual(cart.subtotal_amount, 2400)
        self.assertEqual(cart.total_amount, 3400)


class OrderItemSnapshotTests(TestCase):
    def test_order_item_snapshot_keeps_original_name_and_price(self):
        user = create_user(username="order-user")
        business = create_business(name="Order Biz")
        category = create_category(business=business, name="Main")
        item = create_menu_item(
            business=business,
            category=category,
            name="Kuru Fasulye",
            slug="kuru-fasulye",
            price_amount=1500,
        )

        order = Order.objects.create(
            user=user,
            business=business,
            menu=item,
            amount=1500,
            subtotal_amount=1500,
            customer_fee_amount=0,
            business_fee_amount=0,
            total_charged_amount=1500,
            business_net_amount=1500,
            item_count=1,
            pricing_snapshot={"total_charged_amount": 1500},
            order_snapshot={"source": "test"},
        )

        order_item = OrderItem.objects.create(
            order=order,
            menu_item=item,
            quantity=1,
            unit_price_amount=1500,
            line_total_amount=1500,
            menu_item_name=item.name,
        )

        item.name = "Zamlı Kuru Fasulye"
        item.price_amount = 2500
        item.save(update_fields=["name", "price_amount", "updated_at"])

        order_item.refresh_from_db()
        self.assertEqual(order_item.menu_item_name, "Kuru Fasulye")
        self.assertEqual(order_item.unit_price_amount, 1500)
        self.assertEqual(order_item.menu_item_snapshot["price_amount"], 1500)
