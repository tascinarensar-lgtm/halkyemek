from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers

from businesses.models import BusinessProfile
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation


class SurpriseDealBusinessSummarySerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(source="business_name", read_only=True)

    class Meta:
        model = BusinessProfile
        fields = [
            "id",
            "name",
            "district",
            "short_description",
            "badge_text",
        ]


class SurpriseDealPublicSerializer(serializers.ModelSerializer):
    business = SurpriseDealBusinessSummarySerializer(read_only=True)
    is_sold_out = serializers.BooleanField(read_only=True)

    class Meta:
        model = SurpriseDeal
        fields = [
            "id",
            "business",
            "title",
            "description",
            "original_value_amount",
            "sale_price_amount",
            "currency",
            "quantity_remaining",
            "pickup_window_start",
            "pickup_window_end",
            "min_contents_note",
            "grams",
            "allergens_note",
            "image_url",
            "is_sold_out",
        ]


class SurpriseDealBusinessSerializer(serializers.ModelSerializer):
    business = SurpriseDealBusinessSummarySerializer(read_only=True)
    active_reserved_count = serializers.SerializerMethodField()

    class Meta:
        model = SurpriseDeal
        fields = [
            "id",
            "business",
            "title",
            "description",
            "original_value_amount",
            "sale_price_amount",
            "currency",
            "quantity_total",
            "quantity_remaining",
            "quantity_reserved",
            "pickup_window_start",
            "pickup_window_end",
            "status",
            "min_contents_note",
            "grams",
            "allergens_note",
            "image_url",
            "created_by",
            "published_at",
            "closed_at",
            "created_at",
            "updated_at",
            "active_reserved_count",
        ]
        read_only_fields = [
            "id",
            "business",
            "currency",
            "quantity_remaining",
            "quantity_reserved",
            "created_by",
            "published_at",
            "closed_at",
            "created_at",
            "updated_at",
            "active_reserved_count",
        ]

    def get_active_reserved_count(self, obj: SurpriseDeal) -> int:
        if hasattr(obj, "active_reserved_count"):
            return int(obj.active_reserved_count or 0)
        return obj.reservations.filter(status=SurpriseDealReservation.Status.RESERVED).count()


class SurpriseDealCreateUpdateSerializer(serializers.ModelSerializer):
    business = serializers.IntegerField(required=False, write_only=True)

    class Meta:
        model = SurpriseDeal
        fields = [
            "business",
            "title",
            "description",
            "original_value_amount",
            "sale_price_amount",
            "quantity_total",
            "pickup_window_start",
            "pickup_window_end",
            "status",
            "min_contents_note",
            "grams",
            "allergens_note",
            "image_url",
        ]
        extra_kwargs = {
            "description": {"required": False, "allow_blank": True},
            "status": {"required": False},
            "min_contents_note": {"required": False, "allow_blank": True},
            "grams": {"required": False, "allow_null": True, "min_value": 1},
            "allergens_note": {"required": False, "allow_blank": True},
            "image_url": {"required": False, "allow_blank": True},
        }

    def validate(self, attrs):
        attrs.pop("business", None)
        instance = getattr(self, "instance", None)
        status = attrs.get("status", getattr(instance, "status", SurpriseDeal.Status.DRAFT))
        quantity_total = attrs.get("quantity_total", getattr(instance, "quantity_total", None))
        pickup_window_end = attrs.get("pickup_window_end", getattr(instance, "pickup_window_end", None))

        if status == SurpriseDeal.Status.ACTIVE:
            if int(quantity_total or 0) <= 0:
                raise serializers.ValidationError({"quantity_total": "Aktif firsat icin kota 0 olamaz."})
            if pickup_window_end and pickup_window_end <= timezone.now():
                raise serializers.ValidationError({"pickup_window_end": "Aktif firsat ileri bir teslim bitisi gerektirir."})

        if instance and self._has_active_reservation(instance):
            critical_fields = {
                "quantity_total",
                "sale_price_amount",
                "pickup_window_start",
                "pickup_window_end",
            }
            blocked_fields = sorted(critical_fields.intersection(attrs))
            if blocked_fields:
                raise serializers.ValidationError(
                    {
                        "detail": (
                            "Aktif rezervasyon varken fiyat, kota veya teslim penceresi degistirilemez."
                        ),
                        "fields": blocked_fields,
                    }
                )

        return attrs

    def create(self, validated_data):
        business = self.context["business"]
        user = self.context["request"].user
        now = timezone.now()
        status = validated_data.pop("status", SurpriseDeal.Status.DRAFT) or SurpriseDeal.Status.DRAFT
        quantity_total = int(validated_data["quantity_total"])
        deal = SurpriseDeal(
            **validated_data,
            business=business,
            created_by=user,
            status=status,
            quantity_remaining=quantity_total,
            quantity_reserved=0,
            published_at=now if status == SurpriseDeal.Status.ACTIVE else None,
            closed_at=now if status in {SurpriseDeal.Status.CLOSED, SurpriseDeal.Status.CANCELLED} else None,
        )
        return self._save_deal(deal)

    def update(self, instance: SurpriseDeal, validated_data):
        status_was = instance.status
        now = timezone.now()
        quantity_total_changed = "quantity_total" in validated_data
        old_quantity_total = int(instance.quantity_total or 0)
        old_quantity_remaining = int(instance.quantity_remaining or 0)

        for field, value in validated_data.items():
            setattr(instance, field, value)

        if quantity_total_changed:
            quantity_delta = int(instance.quantity_total or 0) - old_quantity_total
            next_remaining = old_quantity_remaining + quantity_delta
            if next_remaining < 0:
                raise serializers.ValidationError(
                    {"quantity_total": "Toplam kota, daha once kullanilmis miktarin altina indirilemez."}
                )
            instance.quantity_remaining = next_remaining

        if instance.status == SurpriseDeal.Status.ACTIVE and not instance.published_at:
            instance.published_at = now
        if instance.status in {SurpriseDeal.Status.CLOSED, SurpriseDeal.Status.CANCELLED} and status_was != instance.status:
            instance.closed_at = now

        return self._save_deal(instance)

    @staticmethod
    def _has_active_reservation(instance: SurpriseDeal) -> bool:
        return instance.reservations.filter(status=SurpriseDealReservation.Status.RESERVED).exists()

    @staticmethod
    def _save_deal(deal: SurpriseDeal) -> SurpriseDeal:
        try:
            deal.save()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)
        return deal


class SurpriseDealCheckoutCreateSerializer(serializers.Serializer):
    quantity = serializers.IntegerField(required=False, default=1, min_value=1)


class SurpriseDealCheckoutReservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SurpriseDealReservation
        fields = [
            "id",
            "status",
            "quantity",
            "expires_at",
        ]


class SurpriseDealCheckoutSessionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    token = serializers.CharField()
    cashier_code = serializers.CharField(allow_blank=True, allow_null=True)
    status = serializers.CharField()
    expires_at = serializers.DateTimeField()
    source_type = serializers.CharField()


class SurpriseDealCheckoutResponseSerializer(serializers.Serializer):
    checkout_session = SurpriseDealCheckoutSessionSerializer()
    surprise_deal = SurpriseDealPublicSerializer()
    reservation = SurpriseDealCheckoutReservationSerializer()
    total_amount = serializers.IntegerField()
    wallet_balance = serializers.IntegerField()
    insufficient_balance = serializers.BooleanField()


class OpsSurpriseDealQuerySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=SurpriseDeal.Status.choices, required=False)
    business = serializers.IntegerField(required=False, min_value=1)
    district = serializers.CharField(required=False, allow_blank=True)
    date_from = serializers.DateTimeField(required=False)
    date_to = serializers.DateTimeField(required=False)
    has_reserved = serializers.BooleanField(required=False)
    has_remaining = serializers.BooleanField(required=False)
    q = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        date_from = attrs.get("date_from")
        date_to = attrs.get("date_to")
        if date_from and date_to and date_to < date_from:
            raise serializers.ValidationError({"date_to": "date_to date_from degerinden once olamaz."})
        return attrs
