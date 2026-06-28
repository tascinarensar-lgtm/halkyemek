from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

COORDINATE_QUANT = Decimal("0.000001")


def decimal_to_float(value):
    if value is None:
        return None
    return float(value)


def normalize_coordinate_value(value, *, field_name: str) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        decimal_value = Decimal(str(value).strip().replace(",", "."))
    except (InvalidOperation, ValueError) as exc:
        raise serializers.ValidationError({field_name: "Geçerli bir koordinat girin."}) from exc
    return decimal_value.quantize(COORDINATE_QUANT, rounding=ROUND_HALF_UP)


@extend_schema_field(OpenApiTypes.FLOAT)
class CoordinateDecimalField(serializers.Field):
    def to_internal_value(self, data):
        return normalize_coordinate_value(data, field_name=self.field_name)

    def to_representation(self, value):
        return decimal_to_float(value)


def validate_business_location_attrs(attrs: dict) -> dict:
    includes_latitude = "latitude" in attrs
    includes_longitude = "longitude" in attrs

    if includes_latitude != includes_longitude:
        raise serializers.ValidationError({
            "latitude": "latitude and longitude must be provided together.",
            "longitude": "latitude and longitude must be provided together.",
        })

    has_latitude = includes_latitude and attrs.get("latitude") is not None
    has_longitude = includes_longitude and attrs.get("longitude") is not None

    if has_latitude != has_longitude:
        raise serializers.ValidationError({
            "latitude": "latitude and longitude must be provided together.",
            "longitude": "latitude and longitude must be provided together.",
        })

    latitude = attrs.get("latitude")
    longitude = attrs.get("longitude")
    if latitude is not None:
        attrs["latitude"] = latitude = normalize_coordinate_value(latitude, field_name="latitude")
    if longitude is not None:
        attrs["longitude"] = longitude = normalize_coordinate_value(longitude, field_name="longitude")

    if latitude is not None and not (Decimal("-90") <= latitude <= Decimal("90")):
        raise serializers.ValidationError({"latitude": "Enlem -90 ile 90 arasında olmalıdır."})

    if longitude is not None and not (Decimal("-180") <= longitude <= Decimal("180")):
        raise serializers.ValidationError({"longitude": "Boylam -180 ile 180 arasında olmalıdır."})

    google_maps_url = attrs.get("google_maps_url")
    if google_maps_url and not str(google_maps_url).startswith(("http://", "https://")):
        raise serializers.ValidationError({"google_maps_url": "google_maps_url must start with http:// or https://."})

    return attrs
