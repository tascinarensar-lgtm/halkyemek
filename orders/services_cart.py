from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from django.db import transaction
from django.db import models
from django.utils import timezone

from menus.models import MenuItem
from orders.models import Cart, CartItem, CheckoutSession
from orders.services_pricing import PricingBreakdown, build_checkout_pricing_breakdown
from orders.services_quota import (
    assert_menu_item_quota_available,
    build_quota_snapshot_for_menu_item,
    release_quota_for_checkout_session,
)


class CartError(Exception):
    pass


class ActiveCartNotFound(CartError):
    pass


class CrossBusinessCartError(CartError):
    pass


class CartItemUnavailable(CartError):
    pass


@dataclass(frozen=True)
class CartComputationResult:
    cart: Cart
    pricing: Optional[PricingBreakdown]
    item_count: int


class CartService:
    @staticmethod
    def _restore_latest_expired_checked_out_cart(*, user, for_update: bool = False) -> Optional[Cart]:
        expired_sessions = CheckoutSession.objects.filter(
            user=user,
            status__in=[CheckoutSession.Status.PENDING, CheckoutSession.Status.CONFIRMED],
            expires_at__lte=timezone.now(),
            cart__status=Cart.Status.CHECKED_OUT,
        ).select_related("cart").order_by("-expires_at", "-id")

        if for_update:
            expired_sessions = expired_sessions.select_for_update()

        session = expired_sessions.first()
        if session is None or session.cart_id is None:
            return None

        session.status = CheckoutSession.Status.EXPIRED
        session.save(update_fields=["status", "updated_at"])
        release_quota_for_checkout_session(session=session)

        cart = session.cart
        has_other_active_cart = Cart.objects.filter(user=user, status=Cart.Status.ACTIVE).exclude(id=cart.id).exists()
        if has_other_active_cart:
            cart.status = Cart.Status.ABANDONED
            cart.abandoned_at = timezone.now()
            cart.save(update_fields=["status", "abandoned_at", "updated_at"])
            return None

        cart.status = Cart.Status.ACTIVE
        cart.checked_out_at = None
        cart.abandoned_at = None
        cart.save(update_fields=["status", "checked_out_at", "abandoned_at", "updated_at"])
        return cart

    @staticmethod
    def _get_active_cart(*, user, for_update: bool = False) -> Optional[Cart]:
        qs = Cart.objects.filter(user=user, status=Cart.Status.ACTIVE)
        if for_update:
            qs = qs.select_for_update()
        cart = qs.select_related("business").first()
        if cart is not None:
            return cart

        restored_cart = CartService._restore_latest_expired_checked_out_cart(user=user, for_update=for_update)
        if restored_cart is None:
            return None

        refreshed_qs = Cart.objects.filter(id=restored_cart.id)
        if for_update:
            refreshed_qs = refreshed_qs.select_for_update()
        return refreshed_qs.select_related("business").first()

    @staticmethod
    def _ensure_menu_item_is_orderable(*, menu_item: MenuItem):
        business = menu_item.business
        category = menu_item.category
        if not business.is_active or not business.is_approved or not business.is_listed or not business.marketplace_is_visible:
            raise CartItemUnavailable("Business is not available for cart")
        if not category.is_active or not category.is_visible:
            raise CartItemUnavailable("Menu category is not available for cart")
        if not menu_item.is_active or not menu_item.is_visible or not menu_item.is_available:
            raise CartItemUnavailable("Menu item is not available for cart")

    @staticmethod
    def _build_item_snapshot(*, item: CartItem) -> dict:
        return {
            "cart_item_id": int(item.id),
            "menu_item_id": int(item.menu_item_id),
            "name": item.menu_item_name,
            "quantity": int(item.quantity),
            "unit_price_amount": int(item.unit_price_amount),
            "line_total_amount": int(item.line_total_amount),
            "sort_order": int(item.sort_order),
            "menu_item_snapshot": item.menu_item_snapshot,
        }

    @staticmethod
    def recompute_active_cart(*, cart: Cart) -> CartComputationResult:
        if cart.status != Cart.Status.ACTIVE:
            raise CartError("Only ACTIVE cart can be recomputed")

        items = list(
            cart.cart_items.select_related("menu_item", "menu_item__category").order_by("sort_order", "id")
        )

        subtotal = 0
        for item in items:
            CartService._ensure_menu_item_is_orderable(menu_item=item.menu_item)
            assert_menu_item_quota_available(menu_item=item.menu_item, quantity=int(item.quantity))
            item.menu_item_name = item.menu_item.name
            item.unit_price_amount = int(item.menu_item.price_amount)
            item.line_total_amount = int(item.unit_price_amount) * int(item.quantity)
            item.menu_item_snapshot = {
                "menu_item_id": int(item.menu_item_id),
                "business_id": int(item.menu_item.business_id),
                "category_id": int(item.menu_item.category_id),
                "name": item.menu_item.name,
                "price_amount": int(item.menu_item.price_amount),
                "image_url": item.menu_item.image_url or "",
                **build_quota_snapshot_for_menu_item(item.menu_item),
            }
            item.save(update_fields=[
                "menu_item_name",
                "unit_price_amount",
                "line_total_amount",
                "menu_item_snapshot",
                "updated_at",
            ])
            subtotal += int(item.line_total_amount)

        pricing: Optional[PricingBreakdown] = None
        if subtotal > 0:
            pricing = build_checkout_pricing_breakdown(subtotal_amount=subtotal, currency=cart.currency)
            assert pricing is not None
            cart.subtotal_amount = pricing.subtotal_amount
            cart.customer_fee_amount = pricing.customer_fee_amount
            cart.total_amount = pricing.total_payable_amount
            cart.snapshot = {
                "pricing": pricing.as_dict(),
                "item_count": len(items),
                "items": [CartService._build_item_snapshot(item=i) for i in items],
            }
        else:
            cart.subtotal_amount = 0
            cart.customer_fee_amount = 0
            cart.total_amount = 0
            cart.snapshot = {"pricing": None, "item_count": 0, "items": []}

        cart.save(update_fields=["subtotal_amount", "customer_fee_amount", "total_amount", "snapshot", "updated_at"])
        return CartComputationResult(cart=cart, pricing=pricing, item_count=len(items))

    @staticmethod
    @transaction.atomic
    def get_or_create_active_cart(*, user, business) -> Cart:
        existing = CartService._get_active_cart(user=user, for_update=True)
        if existing is not None:
            if int(existing.business_id) != int(business.id):
                if not existing.cart_items.exists():
                    existing.business = business
                    existing.subtotal_amount = 0
                    existing.customer_fee_amount = 0
                    existing.total_amount = 0
                    existing.snapshot = {"pricing": None, "item_count": 0, "items": []}
                    existing.save(update_fields=[
                        "business",
                        "subtotal_amount",
                        "customer_fee_amount",
                        "total_amount",
                        "snapshot",
                        "updated_at",
                    ])
                    return existing
                raise CrossBusinessCartError("Sepetteki ürünler farklı işletmeye aittir. Tek bir işletme ile sepetinizi doldurabilirsiniz.")
            return existing

        return Cart.objects.create(
            user=user,
            business=business,
            status=Cart.Status.ACTIVE,
            subtotal_amount=0,
            customer_fee_amount=0,
            total_amount=0,
            snapshot={"pricing": None, "item_count": 0, "items": []},
        )

    @staticmethod
    @transaction.atomic
    def add_item(*, user, menu_item: MenuItem, quantity: int = 1) -> CartComputationResult:
        quantity = int(quantity)
        if quantity <= 0:
            raise CartError("quantity must be positive")

        CartService._ensure_menu_item_is_orderable(menu_item=menu_item)
        cart = CartService.get_or_create_active_cart(user=user, business=menu_item.business)

        cart_item = cart.cart_items.select_for_update().filter(menu_item=menu_item).first()
        next_quantity = quantity if cart_item is None else int(cart_item.quantity) + quantity
        assert_menu_item_quota_available(menu_item=menu_item, quantity=next_quantity)

        if cart_item is None:
            max_sort_order = int(cart.cart_items.aggregate(mx=models.Max("sort_order"))["mx"] or 0)
            CartItem.objects.create(
                cart=cart,
                menu_item=menu_item,
                quantity=quantity,
                unit_price_amount=int(menu_item.price_amount),
                line_total_amount=int(menu_item.price_amount) * quantity,
                menu_item_name=menu_item.name,
                sort_order=max_sort_order + 1,
            )
        else:
            cart_item.quantity = next_quantity
            cart_item.save(update_fields=["quantity", "updated_at"])

        return CartService.recompute_active_cart(cart=cart)

    @staticmethod
    @transaction.atomic
    def update_item_quantity(*, user, cart_item_id: int, quantity: int) -> CartComputationResult:
        quantity = int(quantity)
        if quantity <= 0:
            raise CartError("quantity must be positive")

        cart = CartService._get_active_cart(user=user, for_update=True)
        if cart is None:
            raise ActiveCartNotFound("Active cart not found")

        item = cart.cart_items.select_for_update().filter(id=cart_item_id).first()
        if item is None:
            raise CartError("Cart item not found")

        assert_menu_item_quota_available(menu_item=item.menu_item, quantity=quantity)
        item.quantity = quantity
        item.save(update_fields=["quantity", "updated_at"])
        return CartService.recompute_active_cart(cart=cart)

    @staticmethod
    @transaction.atomic
    def remove_item(*, user, cart_item_id: int) -> CartComputationResult:
        cart = CartService._get_active_cart(user=user, for_update=True)
        if cart is None:
            raise ActiveCartNotFound("Active cart not found")

        item = cart.cart_items.select_for_update().filter(id=cart_item_id).first()
        if item is None:
            raise CartError("Cart item not found")

        item.delete()
        return CartService.recompute_active_cart(cart=cart)

    @staticmethod
    @transaction.atomic
    def clear_active_cart(*, user) -> CartComputationResult:
        cart = CartService._get_active_cart(user=user, for_update=True)
        if cart is None:
            raise ActiveCartNotFound("Active cart not found")

        cart.cart_items.all().delete()
        return CartService.recompute_active_cart(cart=cart)

    @staticmethod
    @transaction.atomic
    def get_active_cart_with_recalculation(*, user) -> CartComputationResult:
        cart = CartService._get_active_cart(user=user, for_update=True)
        if cart is None:
            raise ActiveCartNotFound("Active cart not found")
        return CartService.recompute_active_cart(cart=cart)
