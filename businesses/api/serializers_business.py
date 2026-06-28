from __future__ import annotations

from rest_framework import serializers

from businesses.api.location_validation import CoordinateDecimalField, validate_business_location_attrs
from businesses.models import BusinessProfile


class BusinessConsumeHistoryQuerySerializer(serializers.Serializer):
    consumed_after = serializers.DateTimeField(required=False)
    consumed_before = serializers.DateTimeField(required=False)
    checkout_status = serializers.ChoiceField(required=False, choices=[
        "PENDING",
        "CONFIRMED",
        "CONSUMED",
        "EXPIRED",
        "CANCELLED",
    ])


class BusinessProfileOperationsUpdateSerializer(serializers.Serializer):
    short_description = serializers.CharField(required=False, allow_blank=True, max_length=280)
    intro_text = serializers.CharField(required=False, allow_blank=True)
    badge_text = serializers.CharField(required=False, allow_blank=True, max_length=64)
    address_line = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)
    latitude = CoordinateDecimalField(required=False, allow_null=True)
    longitude = CoordinateDecimalField(required=False, allow_null=True)
    google_maps_url = serializers.URLField(required=False, allow_blank=True, allow_null=True)
    marketplace_is_visible = serializers.BooleanField(required=False)
    listing_type = serializers.ChoiceField(required=False, choices=BusinessProfile.ListingType.choices)
    is_featured = serializers.BooleanField(required=False)
    display_priority = serializers.IntegerField(required=False, min_value=0)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("At least one field must be provided.")
        return validate_business_location_attrs(attrs)


class BusinessOfferWriteSerializer(serializers.Serializer):
    menu_item_id = serializers.IntegerField(required=False, allow_null=True)
    title = serializers.CharField(max_length=160)
    short_description = serializers.CharField(required=False, allow_blank=True, max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    label = serializers.CharField(required=False, allow_blank=True, max_length=64)
    tag = serializers.CharField(required=False, allow_blank=True, max_length=64)
    offer_price_amount = serializers.IntegerField(min_value=1)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()
    is_active = serializers.BooleanField(required=False, default=True)
    is_featured = serializers.BooleanField(required=False, default=False)
    daily_limit = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    sort_order = serializers.IntegerField(required=False, min_value=0, default=0)

    def validate(self, attrs):
        starts_at = attrs.get("starts_at")
        ends_at = attrs.get("ends_at")
        if starts_at is not None and ends_at is not None and ends_at <= starts_at:
            raise serializers.ValidationError({"ends_at": "ends_at must be later than starts_at."})
        return attrs
