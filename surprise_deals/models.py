from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone


class SurpriseDeal(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "Active"
        PAUSED = "PAUSED", "Paused"
        CLOSED = "CLOSED", "Closed"
        EXPIRED = "EXPIRED", "Expired"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.BigAutoField(primary_key=True)
    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="surprise_deals",
    )
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True, default="")
    original_value_amount = models.PositiveBigIntegerField(help_text="Kurus cinsinden tahmini orijinal deger")
    sale_price_amount = models.PositiveBigIntegerField(help_text="Kurus cinsinden satis fiyati")
    currency = models.CharField(max_length=8, default="TRY")
    quantity_total = models.PositiveIntegerField(default=0)
    quantity_remaining = models.PositiveIntegerField(default=0)
    quantity_reserved = models.PositiveIntegerField(default=0)
    pickup_window_start = models.DateTimeField()
    pickup_window_end = models.DateTimeField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    min_contents_note = models.CharField(max_length=255, blank=True, default="")
    grams = models.PositiveIntegerField(null=True, blank=True)
    allergens_note = models.TextField(blank=True, default="")
    image_url = models.URLField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_surprise_deals",
    )
    published_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["business", "status", "pickup_window_start"], name="idx_sdeal_biz_status_start"),
            models.Index(fields=["status", "pickup_window_end"], name="idx_sdeal_status_end"),
        ]
        constraints = [
            models.CheckConstraint(check=Q(sale_price_amount__gt=0), name="ck_sdeal_sale_price_positive"),
            models.CheckConstraint(
                check=Q(original_value_amount__gte=models.F("sale_price_amount")),
                name="ck_sdeal_original_gte_sale",
            ),
            models.CheckConstraint(check=Q(quantity_total__gte=0), name="ck_sdeal_qty_total_nonnegative"),
            models.CheckConstraint(check=Q(quantity_remaining__gte=0), name="ck_sdeal_qty_remaining_nonnegative"),
            models.CheckConstraint(check=Q(quantity_reserved__gte=0), name="ck_sdeal_qty_reserved_nonnegative"),
            models.CheckConstraint(
                check=Q(quantity_remaining__lte=models.F("quantity_total")),
                name="ck_sdeal_remaining_lte_total",
            ),
            models.CheckConstraint(
                check=Q(pickup_window_end__gt=models.F("pickup_window_start")),
                name="ck_sdeal_pickup_end_after_start",
            ),
            models.CheckConstraint(
                check=~Q(status="ACTIVE") | Q(quantity_remaining__gt=0),
                name="ck_sdeal_active_has_remaining",
            ),
        ]

    def clean(self):
        errors: dict[str, str] = {}
        self.title = (self.title or "").strip()
        self.description = (self.description or "").strip()
        self.currency = (self.currency or "TRY").strip().upper()
        self.min_contents_note = (self.min_contents_note or "").strip()
        self.allergens_note = (self.allergens_note or "").strip()
        self.image_url = (self.image_url or "").strip()

        if not self.title:
            errors["title"] = "Title cannot be blank."
        if not self.currency:
            errors["currency"] = "Currency cannot be blank."
        if int(self.sale_price_amount or 0) <= 0:
            errors["sale_price_amount"] = "sale_price_amount must be positive."
        if int(self.original_value_amount or 0) < int(self.sale_price_amount or 0):
            errors["original_value_amount"] = "original_value_amount must be greater than or equal to sale_price_amount."
        if int(self.quantity_remaining or 0) > int(self.quantity_total or 0):
            errors["quantity_remaining"] = "quantity_remaining cannot exceed quantity_total."
        if self.grams is not None and int(self.grams or 0) <= 0:
            errors["grams"] = "grams must be positive."
        if self.pickup_window_start and self.pickup_window_end and self.pickup_window_end <= self.pickup_window_start:
            errors["pickup_window_end"] = "pickup_window_end must be after pickup_window_start."
        if self.status == self.Status.ACTIVE:
            if int(self.quantity_remaining or 0) <= 0:
                errors["quantity_remaining"] = "ACTIVE surprise deals must have remaining quantity."
            if self.pickup_window_end and self.pickup_window_end <= timezone.now():
                errors["pickup_window_end"] = "ACTIVE surprise deals must end in the future."

        if errors:
            raise ValidationError(errors)

    @property
    def is_sold_out(self) -> bool:
        return int(self.quantity_remaining or 0) <= 0

    @property
    def is_pickup_window_expired(self) -> bool:
        return bool(self.pickup_window_end and self.pickup_window_end <= timezone.now())

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.business_id}:{self.title}"


class SurpriseDealReservation(models.Model):
    class Status(models.TextChoices):
        RESERVED = "RESERVED", "Reserved"
        COMMITTED = "COMMITTED", "Committed"
        RELEASED = "RELEASED", "Released"
        EXPIRED = "EXPIRED", "Expired"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.BigAutoField(primary_key=True)
    surprise_deal = models.ForeignKey(
        "surprise_deals.SurpriseDeal",
        on_delete=models.CASCADE,
        related_name="reservations",
    )
    checkout_session = models.ForeignKey(
        "orders.CheckoutSession",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="surprise_deal_reservations",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="surprise_deal_reservations",
    )
    quantity = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RESERVED)
    reserved_at = models.DateTimeField(default=timezone.now)
    committed_at = models.DateTimeField(null=True, blank=True)
    released_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["surprise_deal", "status"], name="idx_sdeal_res_deal_status"),
            models.Index(fields=["user", "status"], name="idx_sdeal_res_user_status"),
        ]
        constraints = [
            models.CheckConstraint(check=Q(quantity__gt=0), name="ck_sdeal_res_quantity_positive"),
            models.UniqueConstraint(
                fields=["checkout_session"],
                condition=Q(checkout_session__isnull=False),
                name="uq_sdeal_res_checkout_session",
            ),
        ]

    def clean(self):
        errors: dict[str, str] = {}
        if int(self.quantity or 0) <= 0:
            errors["quantity"] = "quantity must be positive."
        if self.expires_at and self.reserved_at and self.expires_at <= self.reserved_at:
            errors["expires_at"] = "expires_at must be after reserved_at."
        if self.checkout_session_id and self.checkout_session.user_id != self.user_id:
            errors["checkout_session"] = "Checkout session user mismatch."
        if self.checkout_session_id and self.checkout_session.business_id != self.surprise_deal.business_id:
            errors["checkout_session"] = "Checkout session business mismatch."
        if errors:
            raise ValidationError(errors)

    def mark_committed(self):
        self.status = self.Status.COMMITTED
        self.committed_at = timezone.now()

    def mark_released(self, *, status: str | None = None):
        self.status = status or self.Status.RELEASED
        self.released_at = timezone.now()

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.surprise_deal_id}:{self.user_id}:{self.status}"




