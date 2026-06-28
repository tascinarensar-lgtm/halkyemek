from rest_framework import serializers

from accounts.models import User
from businesses.api.location_validation import CoordinateDecimalField, validate_business_location_attrs
from businesses.bootstrap import normalize_business_category_for_products, normalize_official_business_category
from businesses.models import BusinessMember, BusinessProfile

PRODUCT_CHOICES = (
    ("halkyemek", "HalkYemek"),
    ("halktasarruf", "HalkTasarruf"),
)


class OpsBusinessMembershipUpsertSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(required=False)
    email = serializers.EmailField(required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=BusinessMember.Role.choices)
    is_active = serializers.BooleanField(required=False, default=True)
    access_halkyemek = serializers.BooleanField(required=False, default=True)
    access_halktasarruf = serializers.BooleanField(required=False, default=False)

    def validate_user_id(self, value):
        if not User.objects.filter(id=value).exists():
            raise serializers.ValidationError("User not found.")
        return value

    def validate(self, attrs):
        email = (attrs.get("email") or "").strip()
        user_id = attrs.get("user_id")

        if user_id is None and not email:
            raise serializers.ValidationError({"user": "user_id or email is required."})

        if user_id is not None:
            return attrs

        user = User.objects.filter(email__iexact=email).only("id").first()
        if user is None:
            raise serializers.ValidationError({"email": "User not found."})

        attrs["user_id"] = user.id
        attrs["email"] = email
        return attrs


class OpsBusinessMembershipDeactivateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()

    def validate_user_id(self, value):
        if not User.objects.filter(id=value).exists():
            raise serializers.ValidationError("User not found.")
        return value


class OpsBusinessListQuerySerializer(serializers.Serializer):
    product = serializers.ChoiceField(choices=PRODUCT_CHOICES, required=False)
    district = serializers.ChoiceField(
        choices=BusinessProfile.District.choices,
        required=False,
    )
    is_active = serializers.BooleanField(required=False)
    is_approved = serializers.BooleanField(required=False)
    is_listed = serializers.BooleanField(required=False)
    payout_onboarding_status = serializers.ChoiceField(
        choices=BusinessProfile._meta.get_field("payout_onboarding_status").choices,
        required=False,
    )
    q = serializers.CharField(required=False, allow_blank=True, max_length=255)


class OpsBusinessCreateSerializer(serializers.Serializer):
    business_name = serializers.CharField(max_length=255)
    category = serializers.CharField(max_length=100)
    supports_halkyemek = serializers.BooleanField(required=False, default=True)
    supports_halktasarruf = serializers.BooleanField(required=False, default=False)
    adress = serializers.CharField(required=False, allow_blank=True)
    address_line = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)
    latitude = CoordinateDecimalField(required=False, allow_null=True)
    longitude = CoordinateDecimalField(required=False, allow_null=True)
    google_maps_url = serializers.URLField(required=False, allow_blank=True, allow_null=True)
    district = serializers.ChoiceField(choices=BusinessProfile.District.choices, required=False, default=BusinessProfile.District.BEYLIKDUZU)
    listing_type = serializers.ChoiceField(choices=BusinessProfile.ListingType.choices, required=False, default=BusinessProfile.ListingType.CONTRACTED)
    is_active = serializers.BooleanField(required=False, default=True)
    is_approved = serializers.BooleanField(required=False, default=True)
    is_listed = serializers.BooleanField(required=False, default=True)
    marketplace_is_visible = serializers.BooleanField(required=False, default=True)
    is_featured = serializers.BooleanField(required=False, default=False)
    display_priority = serializers.IntegerField(required=False, min_value=0, default=0)
    short_description = serializers.CharField(required=False, allow_blank=True, max_length=280)
    intro_text = serializers.CharField(required=False, allow_blank=True)
    badge_text = serializers.CharField(required=False, allow_blank=True, max_length=64)
    kyc_contact_name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    kyc_contact_surname = serializers.CharField(required=False, allow_blank=True, max_length=120)
    kyc_identity_number = serializers.CharField(required=False, allow_blank=True, max_length=32)
    kyc_tax_number = serializers.CharField(required=False, allow_blank=True, max_length=32)
    kyc_iban = serializers.CharField(required=False, allow_blank=True, max_length=64)
    contact_user_id = serializers.IntegerField(required=False, allow_null=True)
    owner_user_id = serializers.IntegerField(required=False, allow_null=True)
    owner_role = serializers.ChoiceField(choices=BusinessMember.Role.choices, required=False, default=BusinessMember.Role.OWNER)

    def validate_business_name(self, value):
        text = value.strip()
        if not text:
            raise serializers.ValidationError("Business name is required.")
        return text

    def validate_contact_user_id(self, value):
        if value is not None and not User.objects.filter(id=value).exists():
            raise serializers.ValidationError("User not found.")
        return value

    def validate_owner_user_id(self, value):
        if value is not None and not User.objects.filter(id=value).exists():
            raise serializers.ValidationError("User not found.")
        return value

    def validate(self, attrs):
        if not attrs.get("supports_halkyemek", True) and not attrs.get("supports_halktasarruf", False):
            raise serializers.ValidationError({"product": "Business must support at least one product."})
        try:
            attrs["category"] = normalize_business_category_for_products(
                attrs.get("category", ""),
                supports_halkyemek=attrs.get("supports_halkyemek", True),
                supports_halktasarruf=attrs.get("supports_halktasarruf", False),
            )
        except ValueError as exc:
            raise serializers.ValidationError({"category": str(exc)}) from exc
        return validate_business_location_attrs(attrs)


class OpsBusinessStatusUpdateSerializer(serializers.Serializer):
    business_name = serializers.CharField(required=False, max_length=255)
    category = serializers.CharField(required=False, max_length=100)
    supports_halkyemek = serializers.BooleanField(required=False)
    supports_halktasarruf = serializers.BooleanField(required=False)
    adress = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)
    is_approved = serializers.BooleanField(required=False)
    is_listed = serializers.BooleanField(required=False)
    address_line = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)
    latitude = CoordinateDecimalField(required=False, allow_null=True)
    longitude = CoordinateDecimalField(required=False, allow_null=True)
    google_maps_url = serializers.URLField(required=False, allow_blank=True, allow_null=True)
    listing_type = serializers.ChoiceField(
        choices=BusinessProfile.ListingType.choices,
        required=False,
    )
    is_featured = serializers.BooleanField(required=False)
    display_priority = serializers.IntegerField(required=False, min_value=0)
    marketplace_is_visible = serializers.BooleanField(required=False)
    payout_onboarding_note = serializers.CharField(required=False, allow_blank=True, max_length=255)
    kyc_contact_name = serializers.CharField(required=False, allow_blank=True, max_length=120)
    kyc_contact_surname = serializers.CharField(required=False, allow_blank=True, max_length=120)
    kyc_identity_number = serializers.CharField(required=False, allow_blank=True, max_length=32)
    kyc_tax_number = serializers.CharField(required=False, allow_blank=True, max_length=32)
    kyc_iban = serializers.CharField(required=False, allow_blank=True, max_length=64)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("At least one field must be provided.")
        for field in ("business_name", "category"):
            if field in attrs:
                attrs[field] = attrs[field].strip()
                if not attrs[field]:
                    raise serializers.ValidationError({field: "This field cannot be blank."})
        if "category" in attrs:
            try:
                attrs["category"] = normalize_business_category_for_products(
                    attrs["category"],
                    supports_halkyemek=attrs.get("supports_halkyemek", getattr(self.instance, "supports_halkyemek", True)),
                    supports_halktasarruf=attrs.get("supports_halktasarruf", getattr(self.instance, "supports_halktasarruf", False)),
                )
            except ValueError as exc:
                raise serializers.ValidationError({"category": str(exc)}) from exc
        next_supports_halkyemek = attrs.get("supports_halkyemek", None)
        next_supports_halktasarruf = attrs.get("supports_halktasarruf", None)
        if next_supports_halkyemek is False and next_supports_halktasarruf is False:
            raise serializers.ValidationError({"product": "Business must support at least one product."})
        return validate_business_location_attrs(attrs)
