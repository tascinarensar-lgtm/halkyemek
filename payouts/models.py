from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


class PayoutBatch(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        DISPATCHED = "DISPATCHED", "Dispatched"
        CONFIRMED = "CONFIRMED", "Confirmed"
        FAILED = "FAILED", "Failed"

    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="payout_batches",
    )
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    total_amount = models.BigIntegerField(default=0)
    earning_count = models.PositiveIntegerField(default=0)

    provider = models.CharField(max_length=16, blank=True, default="")
    external_batch_id = models.CharField(max_length=128, blank=True, default="", db_index=True)

    dispatched_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Payout(models.Model):
    id = models.BigAutoField(primary_key=True)
    batch = models.ForeignKey(PayoutBatch, on_delete=models.CASCADE, related_name="payouts")
    business = models.ForeignKey("businesses.BusinessProfile", on_delete=models.CASCADE, related_name="payouts")

    amount = models.PositiveBigIntegerField(help_text="Kuruş cinsinden")
    currency = models.CharField(max_length=8, default="TRY")

    provider_reference = models.CharField(max_length=128, blank=True, default="", db_index=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    locked_by = models.CharField(max_length=64, blank=True, default="")

    last_error_code = models.CharField(max_length=64, blank=True, default="")
    last_error_at = models.DateTimeField(null=True, blank=True)

    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="confirmed_payouts",
    )
    confirm_note = models.CharField(max_length=255, blank=True, default="")
    confirm_source = models.CharField(max_length=32, blank=True, default="")

    status = models.CharField(
        max_length=16,
        choices=[
            ("CREATED", "CREATED"),
            ("DISPATCHING", "DISPATCHING"),
            ("SENT", "SENT"),
            ("CONFIRMED", "CONFIRMED"),
            ("FAILED", "FAILED"),
            ("CANCELLED", "CANCELLED"),
        ],
        default="CREATED",
    )

    idempotency_key = models.CharField(max_length=64, unique=True)
    provider_payout_id = models.CharField(max_length=128, null=True, blank=True)
    provider_error = models.TextField(blank=True, default="")
    provider_dispatch_payload = models.JSONField(default=dict, blank=True)
    provider_status_payload = models.JSONField(default=dict, blank=True)
    provider_item_reference_code = models.CharField(max_length=128, blank=True, default="")

    attempt_count = models.PositiveSmallIntegerField(default=0)
    status_sync_attempt_count = models.PositiveSmallIntegerField(default=0)
    next_retry_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["provider_reference"],
                condition=~Q(provider_reference=""),
                name="uq_payout_provider_reference_nonempty",
            ),
        ]
        indexes = [
            models.Index(fields=["status", "next_retry_at"], name="idx_payout_status_retry"),
            models.Index(fields=["business", "-id"], name="idx_payout_business_id"),
        ]


class PayoutItem(models.Model):
    id = models.BigAutoField(primary_key=True)
    payout = models.ForeignKey(Payout, on_delete=models.CASCADE, related_name="items")
    earning = models.OneToOneField("payouts.BusinessEarning", on_delete=models.PROTECT, related_name="payout_item")
    amount = models.PositiveBigIntegerField(help_text="Kuruş")
    created_at = models.DateTimeField(auto_now_add=True)


class BusinessEarning(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ELIGIBLE = "ELIGIBLE", "Eligible"
        IN_PAYOUT = "IN_PAYOUT", "In payout"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        REVERSED = "REVERSED", "Reversed"

    id = models.BigAutoField(primary_key=True)
    business = models.ForeignKey(
        "businesses.BusinessProfile",
        on_delete=models.CASCADE,
        related_name="earnings",
    )
    order = models.OneToOneField(
        "orders.Order",
        on_delete=models.PROTECT,
        related_name="business_earning",
    )

    gross_amount = models.PositiveBigIntegerField(help_text="Customer charged amount in kuruş")
    platform_fee_amount = models.PositiveBigIntegerField(default=0, help_text="Platform fee in kuruş")
    net_amount = models.PositiveBigIntegerField(help_text="Business receivable in kuruş")
    currency = models.CharField(max_length=8, default="TRY")

    eligible_at = models.DateTimeField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    reversed_amount = models.PositiveBigIntegerField(default=0)
    reversed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "eligible_at"], name="idx_earning_status_eligible"),
            models.Index(fields=["business", "-id"], name="idx_earning_business_id"),
        ]

    def clean(self):
        errors: dict[str, str] = {}

        gross_amount = int(self.gross_amount or 0)
        platform_fee_amount = int(self.platform_fee_amount or 0)
        net_amount = int(self.net_amount or 0)
        if gross_amount <= 0:
            errors["gross_amount"] = "gross_amount must be positive."
        if platform_fee_amount < 0:
            errors["platform_fee_amount"] = "platform_fee_amount cannot be negative."
        if net_amount < 0:
            errors["net_amount"] = "net_amount cannot be negative."
        if platform_fee_amount > gross_amount:
            errors["platform_fee_amount"] = "platform_fee_amount cannot exceed gross_amount."
        if gross_amount - platform_fee_amount != net_amount:
            errors["net_amount"] = "net_amount must equal gross_amount - platform_fee_amount."
        if int(self.reversed_amount or 0) < 0:
            errors["reversed_amount"] = "reversed_amount cannot be negative."
        if int(self.reversed_amount or 0) > net_amount:
            errors["reversed_amount"] = "reversed_amount cannot exceed net_amount."

        if errors:
            raise ValidationError(errors)

    @property
    def outstanding_amount(self) -> int:
        return max(int(self.net_amount) - int(self.reversed_amount or 0), 0)

    def save(self, *args, **kwargs):
        if not self.gross_amount and self.net_amount:
            self.gross_amount = self.net_amount + int(self.platform_fee_amount or 0)

        self.full_clean()
        return super().save(*args, **kwargs)


class PayoutAdjustment(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        APPLIED = "APPLIED", "Applied"
        CANCELLED = "CANCELLED", "Cancelled"

    business = models.ForeignKey("businesses.BusinessProfile", on_delete=models.CASCADE, related_name="payout_adjustments")
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="payout_adjustments")
    payment_reversal = models.ForeignKey("payments.PaymentReversal", null=True, blank=True, on_delete=models.SET_NULL, related_name="payout_adjustments")
    payout = models.ForeignKey("payouts.Payout", null=True, blank=True, on_delete=models.SET_NULL, related_name="applied_adjustments")
    amount = models.BigIntegerField(help_text="Signed kuruş. Negative => business alacağından düşülür")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    reason_code = models.CharField(max_length=64, blank=True, default="")
    description = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["payment_reversal"],
                condition=Q(payment_reversal__isnull=False),
                name="uq_padj_payment_reversal_nonnull",
            ),
        ]
        indexes = [
            models.Index(fields=["business", "status", "created_at"], name="idx_padj_business_status"),
            models.Index(fields=["order", "created_at"], name="idx_padj_order_created"),
        ]

    def clean(self):
        if int(self.amount or 0) == 0:
            raise ValidationError({"amount": "amount cannot be zero."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
