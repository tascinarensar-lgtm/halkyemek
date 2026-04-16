from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

User = settings.AUTH_USER_MODEL


class ProviderEvent(models.Model):
    class Provider(models.TextChoices):
        MOCK = "MOCK", "Mock"
        IYZICO = "IYZICO", "Iyzico"

    provider = models.CharField(max_length=32, choices=Provider.choices, default=Provider.MOCK)
    event_id = models.CharField(max_length=128)
    event_type = models.CharField(max_length=64)
    payload = models.JSONField()
    headers = models.JSONField(default=dict, blank=True)
    signature_ok = models.BooleanField(default=False)
    processed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["provider", "event_id"], name="uniq_provider_event"),
        ]
        indexes = [
            models.Index(fields=["provider", "event_type", "created_at"]),
            models.Index(fields=["provider", "created_at"]),
        ]

    def save(self, *args, **kwargs):
        if self.provider:
            self.provider = str(self.provider).upper()
        if self.event_id:
            self.event_id = str(self.event_id)
        if not self.event_type:
            self.event_type = "unknown"
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"ProviderEvent({self.provider}:{self.event_type}:{self.event_id})"


class PaymentIntent(models.Model):
    class Provider(models.TextChoices):
        MOCK = "MOCK", "Mock"
        IYZICO = "IYZICO", "Iyzico"

    class Status(models.TextChoices):
        INITIATED = "INITIATED", "Initiated"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    class Purpose(models.TextChoices):
        TOPUP = "TOPUP", "Topup"
        CHECKOUT = "CHECKOUT", "Checkout"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="payment_intents")
    purpose = models.CharField(max_length=16, choices=Purpose.choices, null=True, blank=True)
    provider = models.CharField(max_length=16, choices=Provider.choices, default=Provider.IYZICO)
    amount = models.PositiveIntegerField(help_text="Kuruş")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.INITIATED)

    provider_payment_id = models.CharField(max_length=128, null=True, blank=True)
    provider_session_token = models.CharField(max_length=128, blank=True, default="")
    provider_page_url = models.URLField(blank=True, default="")
    provider_raw_init = models.JSONField(default=dict, blank=True)
    provider_raw_result = models.JSONField(default=dict, blank=True)

    is_processed = models.BooleanField(default=False)
    processed_at = models.DateTimeField(null=True, blank=True)
    processing_error = models.TextField(blank=True, default="")
    normalized_status = models.CharField(max_length=32, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    is_settled = models.BooleanField(default=False)
    settled_at = models.DateTimeField(null=True, blank=True)
    settlement_reference_code = models.CharField(max_length=128, null=True, blank=True)

    marketplace_conversation_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    submerchant_key = models.CharField(max_length=64, blank=True, default="")
    submerchant_price = models.BigIntegerField(default=0)
    gross_price = models.BigIntegerField(default=0)
    platform_fee = models.BigIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["marketplace_conversation_id"],
                condition=~Q(marketplace_conversation_id=""),
                name="uq_payment_intent_marketplace_conversation_nonempty",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "created_at"]),
            models.Index(fields=["purpose", "status", "created_at"]),
            models.Index(fields=["provider", "status", "created_at"]),
            models.Index(fields=["provider_payment_id"], name="idx_intent_provider_payment"),
            models.Index(fields=["provider_session_token"], name="idx_intent_provider_session"),
        ]

    def __str__(self) -> str:
        return f"PaymentIntent({self.user}:{self.purpose}:{self.amount}:{self.status})"


class SettlementLine(models.Model):
    provider = models.CharField(max_length=32)
    line_hash = models.CharField(max_length=64)
    settlement_date = models.DateField(null=True, blank=True)
    provider_reference = models.CharField(max_length=64, blank=True, default="")
    submerchant_key = models.CharField(max_length=64, blank=True, default="")
    amount = models.BigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["provider", "line_hash"], name="uq_settlement_line_provider_hash"),
        ]
        indexes = [
            models.Index(fields=["provider", "settlement_date"], name="idx_settlement_provider_date"),
        ]

    def save(self, *args, **kwargs):
        if self.provider:
            self.provider = str(self.provider).upper()
        return super().save(*args, **kwargs)


class SettlementImport(models.Model):
    class Provider(models.TextChoices):
        MOCK = "MOCK", "Mock"
        IYZICO = "IYZICO", "Iyzico"

    class SourceType(models.TextChoices):
        COMMAND = "COMMAND", "Command"
        API_UPLOAD = "API_UPLOAD", "API Upload"
        INBOX = "INBOX", "Inbox"
        TASK = "TASK", "Task"

    class ParseStatus(models.TextChoices):
        NOT_STARTED = "NOT_STARTED", "Not started"
        PARSING = "PARSING", "Parsing"
        PARSED = "PARSED", "Parsed"
        FAILED = "FAILED", "Failed"

    class AppliedStatus(models.TextChoices):
        NOT_APPLIED = "NOT_APPLIED", "Not applied"
        APPLYING = "APPLYING", "Applying"
        APPLIED = "APPLIED", "Applied"
        FAILED = "FAILED", "Failed"
        DUPLICATE_REJECTED = "DUPLICATE_REJECTED", "Duplicate rejected"

    provider = models.CharField(max_length=16, choices=Provider.choices, default=Provider.IYZICO)
    source_type = models.CharField(max_length=24, choices=SourceType.choices, default=SourceType.COMMAND)
    source_label = models.CharField(max_length=255, blank=True, default="")
    source_metadata = models.JSONField(default=dict, blank=True)
    original_filename = models.CharField(max_length=255, blank=True, default="")
    storage_path = models.CharField(max_length=1024, blank=True, default="")
    checksum_sha256 = models.CharField(max_length=64, db_index=True)
    file_size_bytes = models.BigIntegerField(default=0)
    imported_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="settlement_imports")
    imported_by_label = models.CharField(max_length=255, blank=True, default="")
    imported_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    parse_status = models.CharField(max_length=24, choices=ParseStatus.choices, default=ParseStatus.NOT_STARTED)
    applied_status = models.CharField(max_length=24, choices=AppliedStatus.choices, default=AppliedStatus.NOT_APPLIED)
    total_rows = models.PositiveIntegerField(default=0)
    created_records = models.PositiveIntegerField(default=0)
    duplicate_records = models.PositiveIntegerField(default=0)
    processed_records = models.PositiveIntegerField(default=0)
    failed_records = models.PositiveIntegerField(default=0)
    skipped_rows = models.PositiveIntegerField(default=0)
    unmatched_records = models.PositiveIntegerField(default=0)
    retry_count = models.PositiveIntegerField(default=0)
    checksum_verified_at = models.DateTimeField(null=True, blank=True)
    lifecycle_events = models.JSONField(default=list, blank=True)
    error_message = models.TextField(blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["provider", "checksum_sha256"], name="uq_settlement_import_provider_checksum"),
        ]
        indexes = [
            models.Index(fields=["provider", "imported_at"], name="idx_settlement_import_created"),
            models.Index(fields=["parse_status", "applied_status", "id"], name="idx_settlement_import_state"),
        ]

    def save(self, *args, **kwargs):
        if self.provider:
            self.provider = str(self.provider).upper()
        self.checksum_sha256 = str(self.checksum_sha256 or "").strip().lower()
        self.source_label = str(self.source_label or "").strip()
        self.original_filename = str(self.original_filename or "").strip()
        self.storage_path = str(self.storage_path or "").strip()
        self.imported_by_label = str(self.imported_by_label or "").strip()
        if not isinstance(self.lifecycle_events, list):
            self.lifecycle_events = []
        return super().save(*args, **kwargs)


class SettlementRecord(models.Model):
    class Provider(models.TextChoices):
        MOCK = "MOCK", "Mock"
        IYZICO = "IYZICO", "Iyzico"

    class MatchType(models.TextChoices):
        UNMATCHED = "UNMATCHED", "Unmatched"
        PAYMENT_INTENT = "PAYMENT_INTENT", "Payment Intent"
        PAYOUT = "PAYOUT", "Payout"

    class ReviewStatus(models.TextChoices):
        OPEN = "OPEN", "Open"
        ACKNOWLEDGED = "ACKNOWLEDGED", "Acknowledged"
        RETRY_SCHEDULED = "RETRY_SCHEDULED", "Retry Scheduled"
        RESOLVED = "RESOLVED", "Resolved"
        IGNORED = "IGNORED", "Ignored"

    provider = models.CharField(max_length=16, choices=Provider.choices)
    settlement_import = models.ForeignKey(
        "payments.SettlementImport",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="records",
    )
    row_number = models.PositiveIntegerField(null=True, blank=True)
    row_fingerprint = models.CharField(max_length=64, blank=True, default="")
    external_settlement_id = models.CharField(max_length=128, db_index=True)
    external_transaction_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    amount = models.BigIntegerField()
    currency = models.CharField(max_length=8, blank=True, default="TRY")

    settlement_reference_code = models.CharField(max_length=128, blank=True, default="", db_index=True)
    provider_reference = models.CharField(max_length=128, blank=True, default="", db_index=True)
    conversation_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    submerchant_key = models.CharField(max_length=64, blank=True, default="", db_index=True)

    business = models.ForeignKey(
        "businesses.BusinessProfile",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="settlement_records",
    )
    order = models.ForeignKey(
        "orders.Order",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="settlement_records",
    )
    payment_intent = models.ForeignKey(
        "payments.PaymentIntent",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="settlement_records",
    )
    payout = models.ForeignKey(
        "payouts.Payout",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="settlement_records",
    )
    provider_event = models.ForeignKey(
        "payments.ProviderEvent",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="settlement_records",
    )
    match_type = models.CharField(max_length=32, choices=MatchType.choices, default=MatchType.UNMATCHED)

    raw_payload = models.JSONField(default=dict, blank=True)
    is_processed = models.BooleanField(default=False)
    processed_at = models.DateTimeField(null=True, blank=True)
    processing_error = models.TextField(blank=True, default="")
    retry_count = models.PositiveIntegerField(default=0)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    last_retry_at = models.DateTimeField(null=True, blank=True)
    unmatched_reason_code = models.CharField(max_length=64, blank=True, default="")
    review_status = models.CharField(max_length=24, choices=ReviewStatus.choices, default=ReviewStatus.OPEN)
    operator_note = models.TextField(blank=True, default="")
    lifecycle_events = models.JSONField(default=list, blank=True)
    unmatched_opened_at = models.DateTimeField(null=True, blank=True)
    unmatched_resolved_at = models.DateTimeField(null=True, blank=True)
    last_reviewed_at = models.DateTimeField(null=True, blank=True)
    settled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "external_settlement_id"],
                name="uq_settlement_record_provider_external_settlement_id",
            ),
        ]
        indexes = [
            models.Index(fields=["provider", "match_type", "created_at"], name="idx_settlement_record_match"),
            models.Index(fields=["payment_intent"], name="idx_settlement_record_intent"),
            models.Index(fields=["payout"], name="idx_settlement_record_payout"),
            models.Index(fields=["is_processed", "next_retry_at", "id"], name="idx_settle_retry_window"),
            models.Index(fields=["settlement_import", "row_number"], name="idx_settle_record_import_row"),
            models.Index(fields=["review_status", "unmatched_reason_code", "id"], name="idx_settle_review_state"),
        ]

    def save(self, *args, **kwargs):
        if self.provider:
            self.provider = str(self.provider).upper()
        for field_name in ["external_settlement_id", "external_transaction_id", "settlement_reference_code", "provider_reference", "conversation_id", "submerchant_key", "row_fingerprint", "unmatched_reason_code", "review_status"]:
            value = getattr(self, field_name, "")
            setattr(self, field_name, str(value or "").strip())
        if not isinstance(self.lifecycle_events, list):
            self.lifecycle_events = []
        return super().save(*args, **kwargs)


class PaymentReversal(models.Model):
    class Type(models.TextChoices):
        ORDER_REFUND = "ORDER_REFUND", "Order Refund"
        TOPUP_REVERSAL = "TOPUP_REVERSAL", "Topup Reversal"
        CHARGEBACK = "CHARGEBACK", "Chargeback"

    class Status(models.TextChoices):
        REQUESTED = "REQUESTED", "Requested"
        APPLIED = "APPLIED", "Applied"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    class ReviewStatus(models.TextChoices):
        NONE = "NONE", "None"
        OPEN = "OPEN", "Open"
        RESOLVED = "RESOLVED", "Resolved"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="payment_reversals")
    payment_intent = models.ForeignKey("payments.PaymentIntent", null=True, blank=True, on_delete=models.SET_NULL, related_name="reversals")
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.SET_NULL, related_name="payment_reversals")
    provider_event = models.ForeignKey("payments.ProviderEvent", null=True, blank=True, on_delete=models.SET_NULL, related_name="payment_reversals")
    reversal_type = models.CharField(max_length=32, choices=Type.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.REQUESTED)
    amount = models.PositiveBigIntegerField(help_text="Kuruş")
    reason_code = models.CharField(max_length=64, blank=True, default="")
    note = models.CharField(max_length=255, blank=True, default="")
    idempotency_key = models.CharField(max_length=96, unique=True)
    wallet_effect_applied = models.BooleanField(default=False)
    business_effect_applied = models.BooleanField(default=False)
    pending_reversed_amount = models.PositiveBigIntegerField(default=0)
    available_reversed_amount = models.PositiveBigIntegerField(default=0)
    outstanding_exposure_amount = models.PositiveBigIntegerField(default=0)
    manual_review_required = models.BooleanField(default=False)
    review_status = models.CharField(max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.NONE)
    blocked_wallet = models.BooleanField(default=False)
    failure_reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["payment_intent", "provider_event", "reversal_type"],
                condition=Q(payment_intent__isnull=False, provider_event__isnull=False),
                name="uq_payrev_intent_provider_event_type",
            ),
            models.UniqueConstraint(
                fields=["order", "provider_event", "reversal_type"],
                condition=Q(order__isnull=False, provider_event__isnull=False),
                name="uq_payrev_order_provider_event_type",
            ),
        ]
        indexes = [
            models.Index(fields=["reversal_type", "status", "created_at"], name="idx_payrev_type_status"),
            models.Index(fields=["payment_intent", "created_at"], name="idx_payrev_intent_created"),
            models.Index(fields=["order", "created_at"], name="idx_payrev_order_created"),
        ]

    def clean(self):
        if int(self.amount or 0) <= 0:
            raise ValidationError({"amount": "amount must be positive."})
        applied_total = int(self.pending_reversed_amount or 0) + int(self.available_reversed_amount or 0)
        outstanding = int(self.outstanding_exposure_amount or 0)
        if applied_total + outstanding > int(self.amount or 0):
            raise ValidationError({"outstanding_exposure_amount": "partial effect exceeds reversal amount."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
