from rest_framework import serializers

from accounts.models import User
from businesses.models import BusinessMember, BusinessProfile


class OpsBusinessMembershipUpsertSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    role = serializers.ChoiceField(choices=BusinessMember.Role.choices)
    is_active = serializers.BooleanField(required=False, default=True)

    def validate_user_id(self, value):
        if not User.objects.filter(id=value).exists():
            raise serializers.ValidationError("User not found.")
        return value


class OpsBusinessMembershipDeactivateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()

    def validate_user_id(self, value):
        if not User.objects.filter(id=value).exists():
            raise serializers.ValidationError("User not found.")
        return value


class OpsBusinessListQuerySerializer(serializers.Serializer):
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


class OpsBusinessStatusUpdateSerializer(serializers.Serializer):
    is_active = serializers.BooleanField(required=False)
    is_approved = serializers.BooleanField(required=False)
    is_listed = serializers.BooleanField(required=False)
    listing_type = serializers.ChoiceField(
        choices=BusinessProfile.ListingType.choices,
        required=False,
    )
    is_featured = serializers.BooleanField(required=False)
    display_priority = serializers.IntegerField(required=False, min_value=0)
    marketplace_is_visible = serializers.BooleanField(required=False)
    payout_onboarding_note = serializers.CharField(required=False, allow_blank=True, max_length=255)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("At least one field must be provided.")
        return attrs
