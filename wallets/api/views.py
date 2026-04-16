from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework import serializers
from drf_spectacular.utils import OpenApiExample, extend_schema

from common.openapi import ApiErrorEnvelopeSerializer
from common.pagination import DefaultPagination
from notifications.permissions import HasActivePushDevice
from wallets.models import PendingWalletTransaction, WalletTransaction
from wallets.services import WalletService

from .serializers import (
    PendingWalletTransactionSerializer,
    WalletSerializer,
    WalletTransactionSerializer,
)


class WalletTransactionQuerySerializer(serializers.Serializer):
    type = serializers.CharField(required=False)
    payment_intent_id = serializers.IntegerField(required=False)
    order_id = serializers.IntegerField(required=False)


class PendingWalletTransactionQuerySerializer(serializers.Serializer):
    type = serializers.CharField(required=False)
    payment_intent_id = serializers.IntegerField(required=False)


class WalletDetailAPIView(RetrieveAPIView):
    serializer_class = WalletSerializer
    permission_classes = [IsAuthenticated, HasActivePushDevice]

    @extend_schema(
        operation_id="wallet_detail",
        tags=["wallet"],
        responses={200: WalletSerializer, 403: ApiErrorEnvelopeSerializer},
        examples=[OpenApiExample("Wallet detail", value={"user_id": 12, "balance": 900, "pending_balance": 0, "is_active": True, "ledger_in_sync": True, "pending_ledger_in_sync": True, "created_at": "2026-04-02T11:00:00+03:00", "updated_at": "2026-04-02T12:00:00+03:00"}, response_only=True)],
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_object(self):
        return WalletService.get_or_create_wallet(user=self.request.user)


class WalletTransactionListAPIView(ListAPIView):
    serializer_class = WalletTransactionSerializer
    permission_classes = [IsAuthenticated, HasActivePushDevice]
    pagination_class = DefaultPagination
    queryset = WalletTransaction.objects.none()

    @extend_schema(operation_id="wallet_transaction_list", tags=["wallet"], parameters=[WalletTransactionQuerySerializer], responses={200: WalletTransactionSerializer(many=True), 403: ApiErrorEnvelopeSerializer})
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WalletTransaction.objects.none()
        wallet = WalletService.get_or_create_wallet(user=self.request.user)
        qs = (
            WalletTransaction.objects.filter(wallet=wallet)
            .select_related("order", "provider_event", "payment_intent")
            .order_by("-created_at", "-id")
        )

        tx_type = self.request.query_params.get("type")
        if tx_type:
            qs = qs.filter(transaction_type=str(tx_type).upper())

        payment_intent_id = self.request.query_params.get("payment_intent_id")
        if payment_intent_id:
            qs = qs.filter(payment_intent_id=payment_intent_id)

        order_id = self.request.query_params.get("order_id")
        if order_id:
            qs = qs.filter(order_id=order_id)

        return qs


class PendingWalletTransactionListAPIView(ListAPIView):
    serializer_class = PendingWalletTransactionSerializer
    permission_classes = [IsAuthenticated, HasActivePushDevice]
    pagination_class = DefaultPagination
    queryset = PendingWalletTransaction.objects.none()

    @extend_schema(operation_id="wallet_pending_transaction_list", tags=["wallet"], parameters=[PendingWalletTransactionQuerySerializer], responses={200: PendingWalletTransactionSerializer(many=True), 403: ApiErrorEnvelopeSerializer})
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return PendingWalletTransaction.objects.none()
        wallet = WalletService.get_or_create_wallet(user=self.request.user)
        qs = (
            PendingWalletTransaction.objects.filter(wallet=wallet)
            .select_related("provider_event", "payment_intent")
            .order_by("-created_at", "-id")
        )

        tx_type = self.request.query_params.get("type")
        if tx_type:
            qs = qs.filter(transaction_type=str(tx_type).upper())

        payment_intent_id = self.request.query_params.get("payment_intent_id")
        if payment_intent_id:
            qs = qs.filter(payment_intent_id=payment_intent_id)

        return qs
