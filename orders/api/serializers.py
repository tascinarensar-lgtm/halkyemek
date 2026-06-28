from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from orders.models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    menu_item_id = serializers.SerializerMethodField()
    item_type = serializers.SerializerMethodField()
    source_type = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    surprise_deal_id = serializers.SerializerMethodField()
    original_value_amount = serializers.SerializerMethodField()
    pickup_window_start = serializers.SerializerMethodField()
    pickup_window_end = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = [
            "id",
            "menu_item_id",
            "item_type",
            "source_type",
            "menu_item_name",
            "display_name",
            "surprise_deal_id",
            "original_value_amount",
            "pickup_window_start",
            "pickup_window_end",
            "quantity",
            "unit_price_amount",
            "line_total_amount",
            "sort_order",
        ]

    @staticmethod
    def _snapshot(obj) -> dict:
        return obj.menu_item_snapshot or {}

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_menu_item_id(self, obj) -> int | None:
        return obj.menu_item_id

    def get_source_type(self, obj) -> str:
        snapshot = self._snapshot(obj)
        return str(snapshot.get("source_type") or ("MENU_ITEM" if obj.menu_item_id else "UNKNOWN"))

    def get_item_type(self, obj) -> str:
        source_type = self.get_source_type(obj)
        if source_type == "SURPRISE_DEAL" or self._snapshot(obj).get("surprise_deal_id"):
            return "SURPRISE_DEAL"
        return "MENU_ITEM"

    def get_display_name(self, obj) -> str:
        snapshot = self._snapshot(obj)
        return str(snapshot.get("title") or snapshot.get("name") or obj.menu_item_name or "Siparis kalemi")

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_surprise_deal_id(self, obj) -> int | None:
        value = self._snapshot(obj).get("surprise_deal_id")
        return int(value) if value is not None else None

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_original_value_amount(self, obj) -> int | None:
        value = self._snapshot(obj).get("original_value_amount")
        return int(value) if value is not None else None

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_pickup_window_start(self, obj):
        return self._snapshot(obj).get("pickup_window_start")

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_pickup_window_end(self, obj):
        return self._snapshot(obj).get("pickup_window_end")


class OrderSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source="user.username", read_only=True)
    amount = serializers.IntegerField(
        read_only=True,
        help_text="Deprecated mirror of total_charged_amount. Frontend must use total_charged_amount.",
    )
    business_name = serializers.CharField(source="business.business_name", read_only=True)
    checkout_session_id = serializers.IntegerField(source="checkout_session.id", read_only=True)
    cart_id = serializers.IntegerField(source="checkout_session.cart_id", read_only=True)
    checkout_session_created_at = serializers.SerializerMethodField()
    checkout_session_expires_at = serializers.SerializerMethodField()
    checkout_session_consumed_at = serializers.SerializerMethodField()
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
            "checkout_session_created_at",
            "checkout_session_expires_at",
            "checkout_session_consumed_at",
            "pricing",
            "source",
            "order_items",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_checkout_session_created_at(self, obj):
        return getattr(obj.checkout_session, "created_at", None)

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_checkout_session_expires_at(self, obj):
        return getattr(obj.checkout_session, "expires_at", None)

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_checkout_session_consumed_at(self, obj):
        return getattr(obj.checkout_session, "consumed_at", None)

    @extend_schema_field(serializers.JSONField())
    def get_pricing(self, obj) -> dict:
        return obj.pricing_snapshot or {}

    @extend_schema_field(serializers.JSONField())
    def get_source(self, obj) -> dict:
        snapshot = obj.order_snapshot or {}
        source_type = snapshot.get("source_type") or ("SURPRISE_DEAL" if snapshot.get("surprise_deal") else "CART")
        return {
            "contract": snapshot.get("contract") or "cart_checkout_qr_order",
            "source_type": source_type,
            "cart_id": snapshot.get("cart_id") or getattr(obj.checkout_session, "cart_id", None),
            "checkout_session_id": snapshot.get("checkout_session_id") or getattr(obj, "checkout_session_id", None),
            "checkout_session_created_at": self.get_checkout_session_created_at(obj),
            "checkout_session_expires_at": self.get_checkout_session_expires_at(obj),
            "checkout_session_consumed_at": self.get_checkout_session_consumed_at(obj),
            "surprise_deal": snapshot.get("surprise_deal"),
        }
