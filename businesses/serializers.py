from typing import Optional

from rest_framework import serializers
from businesses.models import (
    BusinessCategoryAssignment,
    BusinessProfile,
    MarketplaceCategory,
)
from menus.models import MediaAsset


def _media_url_for_business(obj: BusinessProfile, role: str) -> str:
    prefetched_assets = getattr(obj, "prefetched_public_media_assets", None)
    if prefetched_assets is None:
        prefetched_assets = MediaAsset.objects.filter(
            business=obj,
            is_active=True,
            media_type=MediaAsset.MediaType.IMAGE,
        ).order_by("sort_order", "id")

    for asset in prefetched_assets:
        if asset.asset_role == role:
            return asset.file_url or asset.file_path
    return ""


class PublicBusinessSerializer(serializers.ModelSerializer):
    district_label = serializers.SerializerMethodField()
    listing_type_label = serializers.SerializerMethodField()
    short_description = serializers.CharField(read_only=True)
    intro_text = serializers.CharField(read_only=True)
    badge_text = serializers.CharField(read_only=True)
    cover_image = serializers.SerializerMethodField()
    logo_image = serializers.SerializerMethodField()
    primary_marketplace_category = serializers.SerializerMethodField()

    class Meta:
        model = BusinessProfile
        fields = [
            "id",
            "business_name",
            "district",
            "district_label",
            "listing_type",
            "listing_type_label",
            "is_featured",
            "short_description",
            "intro_text",
            "badge_text",
            "cover_image",
            "logo_image",
            "primary_marketplace_category",
        ]

    def get_district_label(self, obj) -> str:
        return obj.get_district_display()

    def get_listing_type_label(self, obj) -> str:
        return obj.get_listing_type_display()

    def get_cover_image(self, obj) -> str:
        return _media_url_for_business(obj, MediaAsset.AssetRole.COVER)

    def get_logo_image(self, obj) -> str:
        return _media_url_for_business(obj, MediaAsset.AssetRole.LOGO)

    def get_primary_marketplace_category(self, obj) -> Optional[dict]:
        assignments = getattr(obj, "prefetched_active_category_assignments", None)
        if assignments is None:
            assignments = obj.marketplace_categories.filter(is_active=True).select_related(
                "marketplace_category"
            ).order_by("-is_primary", "sort_order", "id")

        primary = None
        for assignment in assignments:
            if assignment.is_primary:
                primary = assignment
                break
        if primary is None and assignments:
            primary = assignments[0]

        if primary is None:
            return None
        category = primary.marketplace_category
        return {
            "id": category.id,
            "slug": category.slug,
            "name": category.name,
            "is_other": category.is_other,
        }


class BusinessPanelSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessProfile
        fields = [
            "id",
            "business_name",
            "district",
            "listing_type",
            "is_featured",
            "display_priority",
            "is_active",
            "is_approved",
            "is_listed",
            "marketplace_is_visible",
        ]


class MarketplaceCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = MarketplaceCategory
        fields = [
            "id",
            "district",
            "slug",
            "name",
            "description",
            "sort_order",
            "is_active",
            "is_other",
        ]


class BusinessCategoryAssignmentSerializer(serializers.ModelSerializer):
    marketplace_category = MarketplaceCategorySerializer(read_only=True)

    class Meta:
        model = BusinessCategoryAssignment
        fields = [
            "id",
            "business",
            "marketplace_category",
            "is_primary",
            "is_active",
            "sort_order",
        ]