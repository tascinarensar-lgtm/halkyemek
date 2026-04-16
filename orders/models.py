from __future__ import annotations

from datetime import timedelta
from typing import Optional
import secrets

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.db.models import Sum
from django.utils import timezone

from businesses.models import BusinessProfile
from menus.models import MenuItem


CHECKOUT_SESSION_TTL_MINUTES = 10
ORDER_QR_TTL_HOURS = 24
CASHIER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def _generate_qr_token() -> str:
    return secrets.token_urlsafe(32)


def _generate_cashier_code(length: int = 6) -> str:
    return "".join(secrets.choice(CASHIER_CODE_ALPHABET) for _ in range(length))


class Order(models.Model):
    class Status(models.TextChoices):
        CREATED = "CREATED", "Created"
        PAID = "PAID", "Paid"
        USED = "USED", "Used"
        CANCELLED = "CANCELLED", "Cancelled"

    class RefundStatus(models.TextChoices):
        NONE = "NONE", "None"
        PARTIAL = "PARTIAL", "Partial"
        FULL = "FULL", "Full"
        CHARGEBACK = "CHARGEBACK", "Chargeback"

    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="orders",
    )
    checkout_session = models.OneToOneField(
        "orders.CheckoutSession",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="order",
    )
    business = models.ForeignKey(
        BusinessProfile,
        on_delete=models.CASCADE,
        related_name="orders",
    )
    # Internal representative pointer only. Public/API consumers must rely on
    # order_items + order_snapshot/cart_snapshot under the official cart contract.
    menu = models.ForeignKey(
        MenuItem,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        editable=False,
        help_text="Internal representative item pointer. Do not use in product APIs.",
    )
    amount = models.PositiveIntegerField(help_text="Kuruş cinsinden")
    subtotal_amount = models.PositiveIntegerField(default=0)
    customer_fee_amount = models.PositiveIntegerField(default=0)
    business_fee_amount = models.PositiveIntegerField(default=0)
    total_charged_amount = models.PositiveIntegerField(default=0)
    business_net_amount = models.PositiveIntegerField(default=0)
    item_count = models.PositiveIntegerField(default=1)
    pricing_snapshot = models.JSONField(default=dict, blank=True)
    order_snapshot = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CREATED)
    qr_token = models.CharField(max_length=128, unique=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    qr_last_rotated_at = models.DateTimeField(null=True, blank=True)
    refund_status = models.CharField(max_length=16, choices=RefundStatus.choices, default=RefundStatus.NONE)
    refunded_amount = models.PositiveIntegerField(default=0)
    refunded_at = models.DateTimeField(null=True, blank=True)
    chargeback_amount = models.PositiveIntegerField(default=0)
    chargeback_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "-created_at"], name="idx_order_user_created"),
            models.Index(fields=["business", "-created_at"], name="idx_order_business_created"),
            models.Index(fields=["status", "-created_at"], name="idx_order_status_created"),
            models.Index(fields=["qr_token"], name="idx_order_qr_token"),
        ]

    @property
    def total_reversed_amount(self) -> int:
        return int(self.refunded_amount or 0) + int(self.chargeback_amount or 0)

    @property
    def remaining_reversible_amount(self) -> int:
        return max(int(self.amount or 0) - self.total_reversed_amount, 0)

    def _recompute_refund_status(self):
        total_reversed = self.total_reversed_amount
        order_amount = int(self.amount or 0)

        if total_reversed <= 0:
            self.refund_status = self.RefundStatus.NONE
            return

        if int(self.chargeback_amount or 0) > 0 and total_reversed >= order_amount:
            self.refund_status = self.RefundStatus.CHARGEBACK
            return

        if int(self.refunded_amount or 0) >= order_amount and int(self.chargeback_amount or 0) == 0:
            self.refund_status = self.RefundStatus.FULL
            return

        self.refund_status = self.RefundStatus.PARTIAL

    def clean(self):
        if self.menu_id and self.business_id and self.menu.business_id != self.business_id:
            raise ValidationError({"menu": "Menu item does not belong to this business."})

        errors: dict[str, str] = {}
        if self.total_reversed_amount > int(self.amount or 0):
            errors["refund_status"] = "refunded_amount + chargeback_amount cannot exceed order amount."

        if self.checkout_session_id:
            session = self.checkout_session
            if session.business_id != self.business_id:
                errors["checkout_session"] = "Checkout session business mismatch."
            if session.user_id != self.user_id:
                errors["checkout_session"] = "Checkout session user mismatch."
            if not session.cart_id:
                errors["checkout_session"] = "Order requires a cart-backed checkout session."
            if int(session.amount) != int(self.amount):
                errors["amount"] = "Order amount must match checkout session amount."

        subtotal_amount = int(self.subtotal_amount or 0)
        customer_fee_amount = int(self.customer_fee_amount or 0)
        business_fee_amount = int(self.business_fee_amount or 0)
        total_charged_amount = int(self.total_charged_amount or 0)
        business_net_amount = int(self.business_net_amount or 0)
        amount = int(self.amount or 0)

        if subtotal_amount < 0:
            errors["subtotal_amount"] = "subtotal_amount cannot be negative."
        if customer_fee_amount < 0:
            errors["customer_fee_amount"] = "customer_fee_amount cannot be negative."
        if business_fee_amount < 0:
            errors["business_fee_amount"] = "business_fee_amount cannot be negative."
        if total_charged_amount < 0:
            errors["total_charged_amount"] = "total_charged_amount cannot be negative."
        if business_net_amount < 0:
            errors["business_net_amount"] = "business_net_amount cannot be negative."

        if total_charged_amount and amount and total_charged_amount != amount:
            errors["total_charged_amount"] = "total_charged_amount must match amount."

        if subtotal_amount + customer_fee_amount != total_charged_amount:
            errors["total_charged_amount"] = "total_charged_amount must equal subtotal_amount + customer_fee_amount."

        if subtotal_amount - business_fee_amount != business_net_amount:
            errors["business_net_amount"] = "business_net_amount must equal subtotal_amount - business_fee_amount."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if not self.qr_token:
            self.qr_token = _generate_qr_token()

        if not self.total_charged_amount and self.amount:
            self.total_charged_amount = int(self.amount)
        if not self.subtotal_amount and self.amount:
            self.subtotal_amount = int(self.amount)
        if not self.business_net_amount and self.subtotal_amount:
            self.business_net_amount = int(self.subtotal_amount) - int(self.business_fee_amount or 0)
        if not self.amount and self.total_charged_amount:
            self.amount = int(self.total_charged_amount)
        if not self.item_count:
            self.item_count = 1

        self.full_clean()

        if self._state.adding:
            for _ in range(5):
                try:
                    return super().save(*args, **kwargs)
                except IntegrityError:
                    self.qr_token = _generate_qr_token()
            raise
        return super().save(*args, **kwargs)

    def is_paid(self) -> bool:
        return self.status == self.Status.PAID

    def is_used(self) -> bool:
        return self.status == self.Status.USED

    def is_cancelled(self) -> bool:
        return self.status == self.Status.CANCELLED

    def is_expired(self) -> bool:
        return bool(self.expires_at and timezone.now() >= self.expires_at)

    def can_use(self) -> bool:
        if not self.is_paid():
            return False
        if self.is_expired():
            return False
        return True

    def mark_paid(self, *, ttl_hours: Optional[int] = None):
        if self.status not in {self.Status.CREATED, self.Status.PAID}:
            raise ValueError("Bu order PAID olamaz.")

        if self.status == self.Status.CREATED:
            self.status = self.Status.PAID
            self.paid_at = timezone.now()

        ttl = ORDER_QR_TTL_HOURS if ttl_hours is None else ttl_hours
        self.expires_at = (self.paid_at or timezone.now()) + timedelta(hours=ttl)

    def mark_used(self):
        if not self.can_use():
            raise ValueError("Bu order kullanılamaz (state/expired).")
        self.status = self.Status.USED
        self.used_at = timezone.now()

    def register_refund(self, *, amount: int, is_chargeback: bool = False):
        amount = int(amount)
        if amount <= 0:
            raise ValueError("Refund amount must be positive.")
        if amount > int(self.amount):
            raise ValueError("Refund amount cannot exceed order amount.")
        if amount > self.remaining_reversible_amount:
            raise ValueError("Total reversed amount cannot exceed order amount.")

        if is_chargeback:
            self.chargeback_amount = int(self.chargeback_amount or 0) + amount
            self.chargeback_at = timezone.now()
            self._recompute_refund_status()
            return

        self.refunded_amount = int(self.refunded_amount or 0) + amount
        self.refunded_at = timezone.now()
        self._recompute_refund_status()

    def register_chargeback(self, *, amount: int):
        self.register_refund(amount=amount, is_chargeback=True)


class CheckoutSession(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        CONFIRMED = "CONFIRMED", "Confirmed"
        CONSUMED = "CONSUMED", "Consumed"
        EXPIRED = "EXPIRED", "Expired"
        CANCELLED = "CANCELLED", "Cancelled"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="checkout_sessions",
    )
    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="checkout_sessions",
    )
    cart = models.ForeignKey(
        "orders.Cart",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="checkout_sessions",
    )
    token = models.CharField(max_length=64, unique=True, db_index=True)
    cashier_code = models.CharField(max_length=6, unique=True, db_index=True, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)

    amount = models.PositiveIntegerField()
    subtotal_amount = models.PositiveIntegerField(default=0)
    customer_fee_amount = models.PositiveIntegerField(default=0)
    business_fee_amount = models.PositiveIntegerField(default=0)
    business_net_amount = models.PositiveIntegerField(default=0)
    platform_total_fee_amount = models.PositiveIntegerField(default=0)
    item_count = models.PositiveIntegerField(default=1)
    currency = models.CharField(max_length=8, default="TRY")
    business_name = models.CharField(max_length=160)
    pricing_snapshot = models.JSONField(default=dict, blank=True)
    cart_snapshot = models.JSONField(default=dict, blank=True)

    expires_at = models.DateTimeField()
    confirmed_at = models.DateTimeField(null=True, blank=True)
    consumed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    consumed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="consumed_checkout_sessions",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "status", "-created_at"], name="idx_checkout_user_status"),
            models.Index(fields=["business", "status", "-created_at"], name="idx_checkout_business_status"),
            models.Index(fields=["expires_at"], name="idx_checkout_expires_at"),
        ]

    @staticmethod
    def generate_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def generate_cashier_code() -> str:
        return _generate_cashier_code()

    @staticmethod
    def default_expiry():
        return timezone.now() + timedelta(minutes=CHECKOUT_SESSION_TTL_MINUTES)

    def clean(self):
        errors: dict[str, str] = {}
        if not self.cart_id:
            errors["cart"] = "Checkout session must reference a cart."

        if self.cart_id:
            if self.cart.user_id != self.user_id:
                errors["cart"] = "Cart user mismatch."
            if self.cart.business_id != self.business_id:
                errors["cart"] = "Cart business mismatch."

        if self.amount <= 0:
            errors["amount"] = "Checkout amount must be positive."

        if int(self.subtotal_amount or 0) <= 0:
            errors["subtotal_amount"] = "subtotal_amount must be positive."

        if int(self.customer_fee_amount or 0) < 0:
            errors["customer_fee_amount"] = "customer_fee_amount cannot be negative."

        if int(self.business_fee_amount or 0) < 0:
            errors["business_fee_amount"] = "business_fee_amount cannot be negative."

        if int(self.platform_total_fee_amount or 0) != int(self.customer_fee_amount or 0) + int(self.business_fee_amount or 0):
            errors["platform_total_fee_amount"] = "platform_total_fee_amount mismatch."

        if int(self.amount or 0) != int(self.subtotal_amount or 0) + int(self.customer_fee_amount or 0):
            errors["amount"] = "amount must equal subtotal_amount + customer_fee_amount."

        if int(self.business_net_amount or 0) != int(self.subtotal_amount or 0) - int(self.business_fee_amount or 0):
            errors["business_net_amount"] = "business_net_amount mismatch."

        if int(self.item_count or 0) <= 0:
            errors["item_count"] = "item_count must be positive."

        if self.status == self.Status.CONSUMED and not self.consumed_at:
            errors["consumed_at"] = "Consumed session must have consumed_at."
        if self.status == self.Status.CANCELLED and not self.cancelled_at:
            errors["cancelled_at"] = "Cancelled session must have cancelled_at."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = self.generate_token()
        if not self.cashier_code:
            self.cashier_code = self.generate_cashier_code()

        self.full_clean()

        if self._state.adding:
            for _ in range(5):
                try:
                    return super().save(*args, **kwargs)
                except IntegrityError:
                    self.token = self.generate_token()
                    self.cashier_code = self.generate_cashier_code()
                    self.full_clean()
            raise

        return super().save(*args, **kwargs)

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def __str__(self):
        return f"{self.pk} {self.status} {self.amount}"


class Cart(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        CHECKED_OUT = "CHECKED_OUT", "Checked out"
        ABANDONED = "ABANDONED", "Abandoned"
        CONVERTED = "CONVERTED", "Converted"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="carts",
    )
    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="carts",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    subtotal_amount = models.PositiveIntegerField(default=0)
    customer_fee_amount = models.PositiveIntegerField(default=0)
    total_amount = models.PositiveIntegerField(default=0)
    currency = models.CharField(max_length=8, default="TRY")
    snapshot = models.JSONField(default=dict, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    abandoned_at = models.DateTimeField(null=True, blank=True)
    converted_order = models.ForeignKey(
        "orders.Order",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="source_carts",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "status", "-updated_at"], name="idx_cart_user_status_updated"),
            models.Index(fields=["business", "status", "-updated_at"], name="idx_cart_biz_status_upd"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(status="ACTIVE"),
                name="uq_cart_user_single_active",
            ),
        ]

    def clean(self):
        errors: dict[str, str] = {}
        if int(self.total_amount or 0) != int(self.subtotal_amount or 0) + int(self.customer_fee_amount or 0):
            errors["total_amount"] = "total_amount must equal subtotal_amount + customer_fee_amount."

        if self.status == self.Status.CHECKED_OUT and not self.checked_out_at:
            errors["checked_out_at"] = "checked_out_at is required when status is CHECKED_OUT."

        if self.status == self.Status.ABANDONED and not self.abandoned_at:
            errors["abandoned_at"] = "abandoned_at is required when status is ABANDONED."

        if self.status == self.Status.CONVERTED and not self.converted_order_id:
            errors["converted_order"] = "converted_order is required when status is CONVERTED."

        if self.converted_order_id:
            if self.converted_order.user_id != self.user_id:
                errors["converted_order"] = "Converted order user mismatch."
            if self.converted_order.business_id != self.business_id:
                errors["converted_order"] = "Converted order business mismatch."

        if errors:
            raise ValidationError(errors)

    def refresh_totals(self, *, save: bool = True):
        subtotal = int(self.cart_items.aggregate(total=Sum("line_total_amount"))["total"] or 0)
        self.subtotal_amount = subtotal
        self.total_amount = subtotal + int(self.customer_fee_amount or 0)
        if save:
            self.save(update_fields=["subtotal_amount", "total_amount", "updated_at"])

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class CartItem(models.Model):
    cart = models.ForeignKey(
        "orders.Cart",
        on_delete=models.CASCADE,
        related_name="cart_items",
    )
    menu_item = models.ForeignKey(
        "menus.MenuItem",
        on_delete=models.PROTECT,
        related_name="cart_items",
    )
    quantity = models.PositiveIntegerField(default=1)
    unit_price_amount = models.PositiveIntegerField(default=0)
    line_total_amount = models.PositiveIntegerField(default=0)
    menu_item_name = models.CharField(max_length=160)
    menu_item_snapshot = models.JSONField(default=dict, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["cart", "sort_order", "id"], name="idx_cartitem_cart_order"),
        ]
        constraints = [
            models.UniqueConstraint(fields=["cart", "menu_item"], name="uq_cartitem_cart_menu_item"),
        ]

    def clean(self):
        errors: dict[str, str] = {}
        if self.menu_item_id and self.cart_id:
            if self.menu_item.business_id != self.cart.business_id:
                errors["menu_item"] = "Menu item does not belong to cart business."
            if not self.menu_item.is_active or not self.menu_item.is_visible or not self.menu_item.is_available:
                errors["menu_item"] = "Menu item is not available for cart."

        if int(self.quantity or 0) <= 0:
            errors["quantity"] = "quantity must be positive."

        if int(self.unit_price_amount or 0) <= 0:
            errors["unit_price_amount"] = "unit_price_amount must be positive."

        if int(self.line_total_amount or 0) != int(self.unit_price_amount or 0) * int(self.quantity or 0):
            errors["line_total_amount"] = "line_total_amount must equal unit_price_amount * quantity."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.menu_item_id:
            if not self.menu_item_name:
                self.menu_item_name = self.menu_item.name
            if not self.unit_price_amount:
                self.unit_price_amount = int(self.menu_item.price_amount)
            if not self.menu_item_snapshot:
                self.menu_item_snapshot = {
                    "menu_item_id": self.menu_item_id,
                    "business_id": self.menu_item.business_id,
                    "category_id": self.menu_item.category_id,
                    "name": self.menu_item.name,
                    "price_amount": int(self.menu_item.price_amount),
                }

        self.line_total_amount = int(self.unit_price_amount or 0) * int(self.quantity or 0)
        self.full_clean()
        with transaction.atomic():
            super().save(*args, **kwargs)
            self.cart.refresh_totals()

    def delete(self, *args, **kwargs):
        cart = self.cart
        with transaction.atomic():
            result = super().delete(*args, **kwargs)
            cart.refresh_totals()
        return result


class OrderItem(models.Model):
    order = models.ForeignKey(
        "orders.Order",
        on_delete=models.CASCADE,
        related_name="order_items",
    )
    menu_item = models.ForeignKey(
        "menus.MenuItem",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="order_items",
    )
    quantity = models.PositiveIntegerField(default=1)
    unit_price_amount = models.PositiveIntegerField(default=0)
    line_total_amount = models.PositiveIntegerField(default=0)
    menu_item_name = models.CharField(max_length=160)
    menu_item_snapshot = models.JSONField(default=dict, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["order", "sort_order", "id"], name="idx_orderitem_order_order"),
        ]

    def clean(self):
        errors: dict[str, str] = {}

        if self.menu_item_id and self.menu_item.business_id != self.order.business_id:
            errors["menu_item"] = "Menu item does not belong to order business."

        if int(self.quantity or 0) <= 0:
            errors["quantity"] = "quantity must be positive."

        if int(self.unit_price_amount or 0) <= 0:
            errors["unit_price_amount"] = "unit_price_amount must be positive."

        if int(self.line_total_amount or 0) != int(self.unit_price_amount or 0) * int(self.quantity or 0):
            errors["line_total_amount"] = "line_total_amount must equal unit_price_amount * quantity."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.menu_item_id:
            if not self.menu_item_name:
                self.menu_item_name = self.menu_item.name
            if not self.unit_price_amount:
                self.unit_price_amount = int(self.menu_item.price_amount)
            if not self.menu_item_snapshot:
                self.menu_item_snapshot = {
                    "menu_item_id": self.menu_item_id,
                    "business_id": self.menu_item.business_id,
                    "category_id": self.menu_item.category_id,
                    "name": self.menu_item.name,
                    "price_amount": int(self.menu_item.price_amount),
                }

        self.line_total_amount = int(self.unit_price_amount or 0) * int(self.quantity or 0)
        self.full_clean()
        return super().save(*args, **kwargs)
