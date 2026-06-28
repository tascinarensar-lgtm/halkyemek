from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from payments.models import PaymentIntent, PaymentReversal, SettlementImport, SettlementRecord


SETTLEMENT_REASON_LABELS = {
    "MATCHING_ENTITY_NOT_FOUND": "Matching entity not found",
    "MISSING_REFERENCE_DATA": "Missing reference data",
    "PAYMENT_INTENT_AMOUNT_MISMATCH": "Payment intent amount mismatch",
    "PAYOUT_AMOUNT_MISMATCH": "Payout amount mismatch",
    "PAYOUT_STATUS_NOT_CONFIRMABLE": "Payout status not confirmable",
    "PAYOUT_MATCH_ERROR": "Payout match error",
    "PAYOUT_CURRENCY_MISMATCH": "Payout currency mismatch",
    "SUBMERCHANT_KEY_MISMATCH": "Submerchant key mismatch",
    "AMBIGUOUS_PAYMENT_INTENT_MATCH": "Ambiguous payment intent match",
    "DUPLICATE_SETTLEMENT_MATCH": "Duplicate settlement match",
    "CROSS_ENTITY_MATCH_CONFLICT": "Cross-entity match conflict",
    "PARTIAL_PROVIDER_RESPONSE": "Partial provider response",
}


def _stale_review_cutoff_seconds() -> int:
    return max(int(getattr(settings, "SETTLEMENT_STALE_REVIEW_SECONDS", 48 * 3600) or 0), 3600)


def _age_seconds(value):
    if value is None:
        return None
    return max(int((timezone.now() - value).total_seconds()), 0)


class TopupPaymentIntentCreateSerializer(serializers.Serializer):
    amount = serializers.IntegerField(min_value=1)


class IyzicoTopupCallbackSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)


class PaymentIntentSerializer(serializers.ModelSerializer):
    payment_reference = serializers.SerializerMethodField()
    manual_payment_account_name = serializers.SerializerMethodField()
    manual_payment_iban = serializers.SerializerMethodField()
    manual_payment_instructions = serializers.SerializerMethodField()

    class Meta:
        model = PaymentIntent
        fields = [
            "id",
            "provider",
            "purpose",
            "amount",
            "status",
            "provider_payment_id",
            "provider_session_token",
            "provider_page_url",
            "normalized_status",
            "is_processed",
            "processed_at",
            "processing_error",
            "is_settled",
            "settled_at",
            "marketplace_conversation_id",
            "payment_reference",
            "manual_payment_account_name",
            "manual_payment_iban",
            "manual_payment_instructions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def _manual_payload(self, obj: PaymentIntent) -> dict:
        payload = obj.provider_raw_init or {}
        if not isinstance(payload, dict):
            return {}
        return payload

    def get_payment_reference(self, obj: PaymentIntent) -> str:
        payload = self._manual_payload(obj)
        return payload.get("payment_reference") or obj.marketplace_conversation_id or f"HY-PI-{obj.pk}"

    def get_manual_payment_account_name(self, obj: PaymentIntent) -> str:
        return self._manual_payload(obj).get("account_name") or ""

    def get_manual_payment_iban(self, obj: PaymentIntent) -> str:
        return self._manual_payload(obj).get("iban") or ""

    def get_manual_payment_instructions(self, obj: PaymentIntent) -> list[str]:
        instructions = self._manual_payload(obj).get("instructions") or []
        if not isinstance(instructions, list):
            return []
        return [str(item) for item in instructions if str(item).strip()]


class OpsPaymentIntentSerializer(PaymentIntentSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)

    class Meta(PaymentIntentSerializer.Meta):
        fields = [
            *PaymentIntentSerializer.Meta.fields,
            "user_id",
            "username",
            "email",
        ]
        read_only_fields = fields


class PaymentReversalSerializer(serializers.ModelSerializer):
    payment_intent_status = serializers.CharField(source="payment_intent.status", read_only=True)
    order_status = serializers.CharField(source="order.status", read_only=True)
    payout_adjustment_ids = serializers.SerializerMethodField()

    class Meta:
        model = PaymentReversal
        fields = [
            "id",
            "reversal_type",
            "status",
            "amount",
            "reason_code",
            "note",
            "idempotency_key",
            "wallet_effect_applied",
            "business_effect_applied",
            "pending_reversed_amount",
            "available_reversed_amount",
            "outstanding_exposure_amount",
            "manual_review_required",
            "review_status",
            "blocked_wallet",
            "failure_reason",
            "payment_intent",
            "payment_intent_status",
            "order",
            "order_status",
            "provider_event",
            "applied_at",
            "created_at",
            "payout_adjustment_ids",
        ]
        read_only_fields = fields

    def get_payout_adjustment_ids(self, obj):
        return list(obj.payout_adjustments.values_list("id", flat=True).order_by("id"))


class OpsReversalIdempotentSerializer(serializers.Serializer):
    idempotency_key = serializers.CharField(max_length=96, required=True, allow_blank=False)


class OpsOrderRefundSerializer(OpsReversalIdempotentSerializer):
    amount = serializers.IntegerField(min_value=1)
    reason_code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class OpsTopupReversalSerializer(OpsReversalIdempotentSerializer):
    amount = serializers.IntegerField(min_value=1)
    reason_code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class OpsManualTopupConfirmSerializer(OpsReversalIdempotentSerializer):
    received_amount = serializers.IntegerField(min_value=1, required=False)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class OpsReversalResolveSerializer(OpsReversalIdempotentSerializer):
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class OpsChargebackSerializer(OpsReversalIdempotentSerializer):
    amount = serializers.IntegerField(min_value=1)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
    source = serializers.ChoiceField(choices=["payment_intent", "order"])
    order_id = serializers.IntegerField(required=False)
    payment_intent_id = serializers.IntegerField(required=False)

    def validate(self, attrs):
        source = attrs["source"]
        if source == "order" and not attrs.get("order_id"):
            raise serializers.ValidationError({"order_id": "order_id is required when source=order"})
        if source == "payment_intent" and not attrs.get("payment_intent_id"):
            raise serializers.ValidationError({"payment_intent_id": "payment_intent_id is required when source=payment_intent"})
        return attrs


class SettlementImportSerializer(serializers.ModelSerializer):
    imported_by_username = serializers.CharField(source="imported_by.username", read_only=True)
    summary = serializers.SerializerMethodField()
    latest_event = serializers.SerializerMethodField()
    duplicate_attempts = serializers.SerializerMethodField()
    operator_context = serializers.SerializerMethodField()

    class Meta:
        model = SettlementImport
        fields = [
            "id", "provider", "source_type", "source_label", "source_metadata", "original_filename", "storage_path",
            "checksum_sha256", "file_size_bytes", "imported_by", "imported_by_username", "imported_by_label",
            "imported_at", "started_at", "completed_at", "parse_status", "applied_status", "total_rows",
            "checksum_verified_at", "lifecycle_events",
            "created_records", "duplicate_records", "processed_records", "failed_records", "skipped_rows",
            "unmatched_records", "retry_count", "error_message", "summary", "latest_event", "duplicate_attempts", "operator_context",
        ]
        read_only_fields = fields

    def get_latest_event(self, obj):
        events = list(obj.lifecycle_events or [])
        return events[-1] if events else None

    def get_duplicate_attempts(self, obj):
        return sum(1 for event in (obj.lifecycle_events or []) if event.get("event") == "duplicate_rejected")

    def get_summary(self, obj):
        return {
            "rows_seen": int(obj.total_rows or 0),
            "created": int(obj.created_records or 0),
            "duplicates": int(obj.duplicate_records or 0),
            "processed": int(obj.processed_records or 0),
            "failed": int(obj.failed_records or 0),
            "skipped": int(obj.skipped_rows or 0),
            "unmatched": int(obj.unmatched_records or 0),
            "has_error": bool(obj.error_message),
        }

    def get_operator_context(self, obj):
        return {
            "imported_by_display": obj.imported_by_label or getattr(obj.imported_by, "username", "") or None,
            "source_display": obj.source_label or obj.original_filename or None,
            "source_metadata": obj.source_metadata or {},
            "checksum_verified": bool(obj.checksum_verified_at),
            "is_retryable": obj.applied_status in {SettlementImport.AppliedStatus.FAILED, SettlementImport.AppliedStatus.NOT_APPLIED},
        }


class SettlementRecordSerializer(serializers.ModelSerializer):
    import_id = serializers.IntegerField(source="settlement_import_id", read_only=True)
    payout_status = serializers.CharField(source="payout.status", read_only=True)
    payment_intent_status = serializers.CharField(source="payment_intent.status", read_only=True)
    unmatched_reason_label = serializers.SerializerMethodField()
    unmatched_age_seconds = serializers.SerializerMethodField()
    stale_manual_review = serializers.SerializerMethodField()
    next_action = serializers.SerializerMethodField()

    class Meta:
        model = SettlementRecord
        fields = [
            "id", "import_id", "row_number", "row_fingerprint", "provider", "external_settlement_id",
            "external_transaction_id", "amount", "currency", "settlement_reference_code", "provider_reference",
            "conversation_id", "submerchant_key", "business", "order", "payment_intent", "payment_intent_status",
            "payout", "payout_status", "provider_event", "match_type", "is_processed", "processed_at",
            "processing_error", "retry_count", "next_retry_at", "last_retry_at", "unmatched_reason_code", "unmatched_reason_label",
            "review_status", "operator_note", "lifecycle_events", "unmatched_opened_at", "unmatched_resolved_at",
            "last_reviewed_at", "stale_manual_review", "unmatched_age_seconds", "next_action", "settled_at", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_unmatched_reason_label(self, obj):
        code = str(obj.unmatched_reason_code or "").strip().upper()
        return SETTLEMENT_REASON_LABELS.get(code) or code or None

    def get_unmatched_age_seconds(self, obj):
        if obj.is_processed:
            return None
        return _age_seconds(obj.unmatched_opened_at or obj.created_at)

    def get_stale_manual_review(self, obj):
        if obj.is_processed:
            return False
        age_seconds = self.get_unmatched_age_seconds(obj)
        return bool(age_seconds is not None and age_seconds >= _stale_review_cutoff_seconds())

    def get_next_action(self, obj):
        if obj.is_processed:
            return "none"
        if obj.next_retry_at:
            if obj.next_retry_at <= timezone.now():
                return "retry_now"
            return "await_retry_window"
        if obj.review_status in {SettlementRecord.ReviewStatus.OPEN, SettlementRecord.ReviewStatus.ACKNOWLEDGED}:
            return "manual_review"
        if obj.review_status == SettlementRecord.ReviewStatus.RETRY_SCHEDULED:
            return "manual_reprocess"
        return "investigate"


class SettlementImportUploadSerializer(serializers.Serializer):
    file = serializers.FileField()

    def validate_file(self, value):
        name = str(getattr(value, "name", "") or "")
        if not name.lower().endswith(".csv"):
            raise serializers.ValidationError("Only CSV files are supported.")
        return value


class SettlementRecordReviewSerializer(serializers.Serializer):
    operator_note = serializers.CharField(required=False, allow_blank=True, max_length=2000)
    review_status = serializers.ChoiceField(choices=SettlementRecord.ReviewStatus.choices, required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("At least one field must be provided.")
        return attrs
