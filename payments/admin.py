from django.contrib import admin

from payments.models import PaymentReversal, SettlementImport, SettlementRecord


@admin.register(SettlementImport)
class SettlementImportAdmin(admin.ModelAdmin):
    list_display = (
        "id", "provider", "source_type", "source_label", "original_filename", "imported_by_label",
        "parse_status", "applied_status", "unmatched_records", "retry_count", "imported_at"
    )
    search_fields = ("original_filename", "checksum_sha256", "source_label", "imported_by_label")
    list_filter = ("provider", "source_type", "parse_status", "applied_status")
    readonly_fields = (
        "checksum_sha256", "file_size_bytes", "imported_at", "started_at", "completed_at", "total_rows", "created_records",
        "duplicate_records", "processed_records", "failed_records", "skipped_rows", "unmatched_records", "retry_count",
        "checksum_verified_at", "source_metadata", "lifecycle_events", "storage_path", "imported_by", "imported_by_label",
    )


@admin.register(SettlementRecord)
class SettlementRecordAdmin(admin.ModelAdmin):
    list_display = (
        "id", "provider", "settlement_import", "row_number", "external_settlement_id", "match_type", "is_processed",
        "review_status", "unmatched_reason_code", "next_retry_at"
    )
    search_fields = (
        "external_settlement_id", "external_transaction_id", "settlement_reference_code", "provider_reference", "conversation_id"
    )
    list_filter = ("provider", "match_type", "is_processed", "review_status", "unmatched_reason_code")
    readonly_fields = (
        "created_at", "updated_at", "processed_at", "settled_at", "lifecycle_events", "unmatched_opened_at", "unmatched_resolved_at",
        "last_reviewed_at", "next_retry_at", "last_retry_at", "retry_count"
    )


@admin.register(PaymentReversal)
class PaymentReversalAdmin(admin.ModelAdmin):
    list_display = (
        "id", "reversal_type", "status", "review_status", "amount", "outstanding_exposure_amount", "blocked_wallet", "created_at"
    )
    search_fields = ("idempotency_key", "reason_code", "note", "failure_reason")
    list_filter = ("reversal_type", "status", "review_status", "blocked_wallet", "manual_review_required")
    readonly_fields = (
        "created_at", "applied_at", "resolved_at", "pending_reversed_amount", "available_reversed_amount",
        "outstanding_exposure_amount", "failure_reason"
    )
