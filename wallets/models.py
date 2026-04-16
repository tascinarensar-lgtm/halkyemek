from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q

User = settings.AUTH_USER_MODEL


class Wallet(models.Model):
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="wallet",
    )
    balance = models.PositiveBigIntegerField(default=0, help_text="Kuruş cinsinden kullanılabilir bakiye")
    pending_balance = models.PositiveBigIntegerField(default=0, help_text="Kuruş cinsinden settlement bekleyen bakiye")

    is_active = models.BooleanField(default=True)
    restriction_reason = models.CharField(max_length=255, blank=True, default="")
    restricted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Wallet({self.user.pk}) - {self.balance}"


class WalletTransaction(models.Model):
    class Type(models.TextChoices):
        TOP_UP = "TOP_UP", "Top Up"
        PURCHASE = "PURCHASE", "Purchase"
        REFUND = "REFUND", "Refund"
        ADJUSTMENT = "ADJUSTMENT", "Adjustment"
        REVERSAL = "REVERSAL", "Reversal"
        CHARGEBACK = "CHARGEBACK", "Chargeback"

    wallet = models.ForeignKey(
        Wallet,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    transaction_type = models.CharField(max_length=20, choices=Type.choices)
    amount = models.BigIntegerField(help_text="Kuruş cinsinden signed işlem tutarı")

    before_balance = models.PositiveBigIntegerField(help_text="İşlem öncesi bakiye")
    after_balance = models.PositiveBigIntegerField(help_text="İşlem sonrası bakiye")

    order = models.ForeignKey(
        "orders.Order",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    provider_event = models.ForeignKey(
        "payments.ProviderEvent",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    payment_intent = models.ForeignKey(
        "payments.PaymentIntent",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    description = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.transaction_type} - {self.amount}"

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError("WalletTransaction immutable: update is not allowed.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("WalletTransaction immutable: delete is not allowed.")

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=Q(after_balance=F("before_balance") + F("amount")),
                name="ck_wallettx_after_equals_before_plus_amount",
            ),
            models.CheckConstraint(
                check=~Q(amount=0),
                name="ck_wallettx_amount_nonzero",
            ),
            models.CheckConstraint(
                check=(Q(transaction_type="TOP_UP", amount__gt=0) | ~Q(transaction_type="TOP_UP")),
                name="ck_wt_topup_amount_positive",
            ),
            models.CheckConstraint(
                check=(Q(transaction_type="REFUND", amount__gt=0) | ~Q(transaction_type="REFUND")),
                name="ck_wt_refund_amount_positive",
            ),
            models.CheckConstraint(
                check=(Q(transaction_type="PURCHASE", amount__lt=0) | ~Q(transaction_type="PURCHASE")),
                name="ck_wt_purchase_amount_negative",
            ),
            models.CheckConstraint(
                check=(Q(transaction_type="REVERSAL", amount__lt=0) | ~Q(transaction_type="REVERSAL")),
                name="ck_wt_reversal_amount_negative",
            ),
            models.CheckConstraint(
                check=(Q(transaction_type="CHARGEBACK", amount__lt=0) | ~Q(transaction_type="CHARGEBACK")),
                name="ck_wt_chargeback_amount_negative",
            ),
            models.UniqueConstraint(
                fields=["order"],
                condition=Q(transaction_type="PURCHASE") & Q(order__isnull=False),
                name="uq_wt_purchase_per_order",
            ),
        ]
        indexes = [
            models.Index(fields=["wallet", "created_at"]),
            models.Index(fields=["order"]),
            models.Index(fields=["transaction_type", "created_at"]),
            models.Index(fields=["wallet", "-created_at"], name="idx_wt_wallet_created"),
            models.Index(fields=["wallet", "-id"], name="idx_wt_wallet_id"),
            models.Index(fields=["provider_event"], name="idx_wallettx_provider_event"),
            models.Index(fields=["payment_intent"], name="idx_wallettx_payment_intent"),
        ]


class PendingWalletTransaction(models.Model):
    class Type(models.TextChoices):
        TOPUP_PENDING = "TOPUP_PENDING", "Topup Pending"
        SETTLEMENT_OUT = "SETTLEMENT_OUT", "Settlement Out"
        REVERSAL_OUT = "REVERSAL_OUT", "Reversal Out"

    id = models.BigAutoField(primary_key=True)
    wallet = models.ForeignKey(
        "wallets.Wallet",
        on_delete=models.CASCADE,
        related_name="pending_transactions",
    )
    transaction_type = models.CharField(max_length=32, choices=Type.choices)
    amount = models.BigIntegerField(help_text="Signed kuruş. TOPUP_PENDING:+, SETTLEMENT_OUT:-")
    before_pending = models.PositiveBigIntegerField()
    after_pending = models.PositiveBigIntegerField()

    provider_event = models.ForeignKey(
        "payments.ProviderEvent",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    payment_intent = models.ForeignKey(
        "payments.PaymentIntent",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )

    description = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=Q(after_pending=F("before_pending") + F("amount")),
                name="ck_pendingtx_after_equals_before_plus_amount",
            ),
            models.CheckConstraint(
                check=~Q(amount=0),
                name="ck_pendingtx_amount_nonzero",
            ),
            models.CheckConstraint(
                check=(Q(transaction_type="TOPUP_PENDING", amount__gt=0) | ~Q(transaction_type="TOPUP_PENDING")),
                name="ck_pendingtx_topup_amount_positive",
            ),
            models.CheckConstraint(
                check=(Q(transaction_type="SETTLEMENT_OUT", amount__lt=0) | ~Q(transaction_type="SETTLEMENT_OUT")),
                name="ck_pendingtx_settlement_amount_negative",
            ),
            models.CheckConstraint(
                check=(Q(transaction_type="REVERSAL_OUT", amount__lt=0) | ~Q(transaction_type="REVERSAL_OUT")),
                name="ck_pendingtx_reversal_amount_negative",
            ),
            models.UniqueConstraint(
                fields=["payment_intent"],
                condition=Q(payment_intent__isnull=False) & Q(transaction_type="TOPUP_PENDING"),
                name="uq_pendingtx_topup_per_payment_intent",
            ),
            models.UniqueConstraint(
                fields=["payment_intent"],
                condition=Q(payment_intent__isnull=False) & Q(transaction_type="SETTLEMENT_OUT"),
                name="uq_pendingtx_settlement_per_payment_intent",
            ),
        ]
        indexes = [
            models.Index(fields=["wallet", "-id"], name="idx_pendingtx_wallet_id"),
            models.Index(fields=["provider_event"], name="idx_pendingtx_provider_event"),
            models.Index(fields=["payment_intent"], name="idx_pendingtx_payment_intent"),
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("PendingWalletTransaction immutable: update is not allowed.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("PendingWalletTransaction immutable: delete is not allowed.")
