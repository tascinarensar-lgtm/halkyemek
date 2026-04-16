from __future__ import annotations

from typing import Any

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiExample, extend_schema_field, inline_serializer
from rest_framework import serializers


class ApiErrorBodySerializer(serializers.Serializer):
    code = serializers.CharField()
    message = serializers.JSONField()
    request_id = serializers.CharField()
    details = serializers.JSONField(required=False)
    reason = serializers.CharField(required=False)


class ApiErrorEnvelopeSerializer(serializers.Serializer):
    ok = serializers.BooleanField(default=False)
    error = ApiErrorBodySerializer()


class ApiSuccessEnvelopeSerializer(serializers.Serializer):
    ok = serializers.BooleanField(default=True)
    data = serializers.JSONField()


def envelope_serializer(name: str, data_serializer: type[serializers.Serializer] | serializers.Serializer | Any):
    return inline_serializer(
        name=name,
        fields={
            "ok": serializers.BooleanField(default=True),
            "data": data_serializer if isinstance(data_serializer, serializers.Field) else data_serializer,
        },
    )


STANDARD_ERROR_EXAMPLE = OpenApiExample(
    "Standard error envelope",
    value={
        "ok": False,
        "error": {
            "code": "ValidationError",
            "message": {"amount": ["Ensure this value is greater than or equal to 1."]},
            "request_id": "9b6b2d4cc92f44a28e3a5d2c7d92b001",
        },
    },
    response_only=True,
)


AUTH_LOGIN_SUCCESS_EXAMPLE = OpenApiExample(
    "Google login success",
    value={
        "access": "jwt-access-token",
        "refresh": "jwt-refresh-token",
        "is_new": False,
        "user": {
            "id": 12,
            "username": "g_1133557799",
            "google_email": "user@example.com",
        },
        "has_business_membership": True,
        "business_membership_count": 1,
        "businesses": [
            {
                "id": 4,
                "name": "Halk Lokantası Beylikdüzü",
                "member_role": "MANAGER",
            }
        ],
    },
    response_only=True,
)


CHECKOUT_CREATE_SUCCESS_EXAMPLE = OpenApiExample(
    "Checkout session created",
    value={
        "id": 321,
        "token": "chk_live_token",
        "status": "PENDING",
        "amount": 215,
        "subtotal_amount": 200,
        "customer_fee_amount": 15,
        "business_fee_amount": 10,
        "business_net_amount": 190,
        "platform_total_fee_amount": 25,
        "item_count": 2,
        "currency": "TRY",
        "expires_at": "2026-04-02T13:00:00+03:00",
        "business": {"id": 8, "name": "Örnek İşletme"},
        "cart": {"id": 55},
        "pricing": {"fee_model": "customer_fee"},
        "items": [
            {
                "menu_item_id": 34,
                "menu_item_name": "Mercimek Çorbası",
                "quantity": 2,
                "unit_price_amount": 100,
                "line_total_amount": 200,
                "sort_order": 1,
            }
        ],
    },
    response_only=True,
)


TOPUP_INTENT_SUCCESS_EXAMPLE = OpenApiExample(
    "Topup intent created",
    value={
        "id": 77,
        "amount": 500,
        "status": "PENDING",
        "conversation_id": "HY-PI-77",
        "checkout_url": "https://sandbox-iyzico.example/checkout/abc",
        "provider": "iyzico",
        "created_at": "2026-04-02T12:00:00+03:00",
    },
    response_only=True,
)
