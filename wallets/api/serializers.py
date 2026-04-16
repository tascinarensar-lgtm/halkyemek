from rest_framework import serializers

from wallets.models import PendingWalletTransaction, Wallet, WalletTransaction
from wallets.services import WalletService


class WalletSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    ledger_in_sync = serializers.SerializerMethodField()
    pending_ledger_in_sync = serializers.SerializerMethodField()

    class Meta:
        model = Wallet
        fields = [
            "user_id",
            "balance",
            "pending_balance",
            "is_active",
            "restriction_reason",
            "restricted_at",
            "ledger_in_sync",
            "pending_ledger_in_sync",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_ledger_in_sync(self, obj) -> bool:
        return WalletService.get_wallet_integrity_snapshot(wallet=obj)["wallet_in_sync"]

    def get_pending_ledger_in_sync(self, obj) -> bool:
        return WalletService.get_wallet_integrity_snapshot(wallet=obj)["pending_in_sync"]


class WalletTransactionSerializer(serializers.ModelSerializer):
    order_id = serializers.IntegerField(source="order.id", read_only=True, allow_null=True)
    provider_event_id = serializers.CharField(source="provider_event.event_id", read_only=True, allow_null=True)
    payment_intent_id = serializers.IntegerField(source="payment_intent.id", read_only=True, allow_null=True)

    class Meta:
        model = WalletTransaction
        fields = [
            "id",
            "transaction_type",
            "amount",
            "before_balance",
            "after_balance",
            "order_id",
            "provider_event_id",
            "payment_intent_id",
            "description",
            "created_at",
        ]
        read_only_fields = fields


class PendingWalletTransactionSerializer(serializers.ModelSerializer):
    provider_event_id = serializers.CharField(source="provider_event.event_id", read_only=True, allow_null=True)
    payment_intent_id = serializers.IntegerField(source="payment_intent.id", read_only=True, allow_null=True)

    class Meta:
        model = PendingWalletTransaction
        fields = [
            "id",
            "transaction_type",
            "amount",
            "before_pending",
            "after_pending",
            "provider_event_id",
            "payment_intent_id",
            "description",
            "created_at",
        ]
        read_only_fields = fields
