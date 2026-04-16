from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from orders.models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    menu_item_id = serializers.IntegerField(source="menu_item.id", read_only=True)

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "menu_item_id",
            "menu_item_name",
            "quantity",
            "unit_price_amount",
            "line_total_amount",
            "sort_order",
        ]


class OrderSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source="user.username", read_only=True)
    amount = serializers.IntegerField(
        read_only=True,
        help_text="Deprecated mirror of total_charged_amount. Frontend must use total_charged_amount.",
    )
    business_name = serializers.CharField(source="business.business_name", read_only=True)
    checkout_session_id = serializers.IntegerField(source="checkout_session.id", read_only=True)
    cart_id = serializers.IntegerField(source="checkout_session.cart_id", read_only=True)
    pricing = serializers.SerializerMethodField()
    source = serializers.SerializerMethodField()
    order_items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id",
            "user",
            "user_username",
            "business",
            "business_name",
            "checkout_session_id",
            "cart_id",
            "amount",
            "subtotal_amount",
            "customer_fee_amount",
            "business_fee_amount",
            "total_charged_amount",
            "business_net_amount",
            "item_count",
            "status",
            "paid_at",
            "used_at",
            "expires_at",
            "created_at",
            "pricing",
            "source",
            "order_items",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.JSONField())
    def get_pricing(self, obj) -> dict:
        return obj.pricing_snapshot or {}

    @extend_schema_field(serializers.JSONField())
    def get_source(self, obj) -> dict:
        snapshot = obj.order_snapshot or {}
        return {
            "contract": "cart_checkout_qr_order",
            "cart_id": snapshot.get("cart_id") or getattr(obj.checkout_session, "cart_id", None),
            "checkout_session_id": snapshot.get("checkout_session_id") or getattr(obj, "checkout_session_id", None),
        }
