from rest_framework import serializers

from orders.models import CheckoutSession


class CheckoutSessionCreateSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"detail": "JSON object expected."})

        if "menu_item_id" in data:
            raise serializers.ValidationError({
                "menu_item_id": (
                    "Deprecated contract removed. First add items to /api/v1/cart/items/ and then call "
                    "/api/v1/checkout-sessions/ with an empty JSON body."
                )
            })

        if data:
            raise serializers.ValidationError({
                "detail": "Checkout session create no longer accepts payload fields. Use the active cart contract."
            })
        return {}


class CheckoutSessionBusinessSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class CheckoutSessionDetailSerializer(serializers.ModelSerializer):
    amount = serializers.IntegerField(
        read_only=True,
        help_text="Deprecated mirror of total_payable_amount. Frontend must use total_payable_amount.",
    )
    total_payable_amount = serializers.IntegerField(source="amount", read_only=True)
    business = serializers.SerializerMethodField()
    pricing = serializers.SerializerMethodField()
    cart = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()

    class Meta:
        model = CheckoutSession
        fields = [
            "id",
            "token",
            "cashier_code",
            "status",
            "amount",
            "total_payable_amount",
            "subtotal_amount",
            "customer_fee_amount",
            "business_fee_amount",
            "business_net_amount",
            "platform_total_fee_amount",
            "item_count",
            "currency",
            "expires_at",
            "business",
            "cart",
            "pricing",
            "items",
        ]

    def get_business(self, obj) -> dict:
        return {
            "id": obj.business_id,
            "name": obj.business_name,
        }

    def get_pricing(self, obj) -> dict:
        return obj.pricing_snapshot

    def get_cart(self, obj) -> dict:
        return {
            "id": obj.cart_id,
        }

    def get_items(self, obj) -> list[dict]:
        return (obj.cart_snapshot or {}).get("items") or []


class CheckoutConsumeResponseSerializer(serializers.Serializer):
    status = serializers.CharField()
    order_id = serializers.IntegerField()
    amount = serializers.IntegerField(help_text="Deprecated mirror of total_charged_amount.")
    total_charged_amount = serializers.IntegerField()
    checkout_session_id = serializers.IntegerField()


class CheckoutSessionPreviewResponseSerializer(serializers.Serializer):
    checkout_session_id = serializers.IntegerField()
    token = serializers.CharField()
    cashier_code = serializers.CharField(allow_blank=True, allow_null=True)
    status = serializers.CharField()
    expires_at = serializers.DateTimeField(allow_null=True)
    amount = serializers.IntegerField(help_text="Deprecated mirror of total_payable_amount.")
    total_payable_amount = serializers.IntegerField()
    subtotal_amount = serializers.IntegerField(required=False)
    customer_fee_amount = serializers.IntegerField(required=False)
    business_fee_amount = serializers.IntegerField(required=False)
    business_net_amount = serializers.IntegerField(required=False)
    currency = serializers.CharField(required=False)
    item_count = serializers.IntegerField()
    business = CheckoutSessionBusinessSerializer()
    items = serializers.ListField(child=serializers.DictField(), required=False)
    can_consume = serializers.BooleanField()
    failure_reason = serializers.CharField(allow_blank=True)
    existing_order_id = serializers.IntegerField(allow_null=True)
