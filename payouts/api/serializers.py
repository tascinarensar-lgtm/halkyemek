from rest_framework import serializers

from payouts.models import Payout, PayoutBatch


class PayoutSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payout
        fields = [
            "id",
            "batch",
            "business",
            "amount",
            "currency",
            "provider_reference",
            "status",
            "idempotency_key",
            "provider_payout_id",
            "provider_dispatch_payload",
            "provider_status_payload",
            "provider_item_reference_code",
            "attempt_count",
            "status_sync_attempt_count",
            "next_retry_at",
            "provider_error",
            "last_error_code",
            "last_error_at",
            "created_at",
            "sent_at",
            "confirmed_at",
        ]


class PayoutBatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayoutBatch
        fields = [
            "id",
            "business",
            "provider",
            "status",
            "total_amount",
            "earning_count",
            "external_batch_id",
            "dispatched_at",
            "confirmed_at",
            "failed_at",
            "failure_reason",
            "created_at",
            "updated_at",
        ]
