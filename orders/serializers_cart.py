from rest_framework import serializers

from orders.models import Cart


class CartItemWriteSerializer(serializers.Serializer):
    menu_item_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, required=False, default=1)


class CartItemQuantityUpdateSerializer(serializers.Serializer):
    quantity = serializers.IntegerField(min_value=1)


class CartItemSnapshotSerializer(serializers.Serializer):
    cart_item_id = serializers.IntegerField()
    menu_item_id = serializers.IntegerField()
    name = serializers.CharField()
    quantity = serializers.IntegerField()
    unit_price_amount = serializers.IntegerField()
    line_total_amount = serializers.IntegerField()
    sort_order = serializers.IntegerField()
    menu_item_snapshot = serializers.JSONField()


class CartPricingSnapshotSerializer(serializers.Serializer):
    subtotal_amount = serializers.IntegerField()
    customer_fee_amount = serializers.IntegerField()
    business_fee_amount = serializers.IntegerField()
    total_payable_amount = serializers.IntegerField()
    business_net_amount = serializers.IntegerField()
    platform_total_fee_amount = serializers.IntegerField()
    currency = serializers.CharField()


class CartDetailSerializer(serializers.ModelSerializer):
    pricing = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = Cart
        fields = [
            "id",
            "status",
            "business",
            "subtotal_amount",
            "customer_fee_amount",
            "total_amount",
            "currency",
            "item_count",
            "pricing",
            "items",
            "updated_at",
        ]

    def get_pricing(self, obj) -> dict:
        snapshot = obj.snapshot or {}
        return snapshot.get("pricing")

    def get_items(self, obj) -> list[dict]:
        snapshot = obj.snapshot or {}
        return snapshot.get("items") or []

    def get_item_count(self, obj) -> int:
        snapshot = obj.snapshot or {}
        return int(snapshot.get("item_count") or 0)
