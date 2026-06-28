from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers

from businesses.models import BusinessCategoryAssignment, MarketplaceCategory
from businesses.serializers import PublicBusinessSerializer
from menus.models import (
    BusinessOffer,
    Category,
    MediaAsset,
    MenuItem,
    MenuItemQuota,
    MenuItemMarketplaceCategoryAssignment,
    get_or_create_internal_menu_category,
)
from orders.services_quota import build_menu_item_quota_state
from menus.media_storage import (
    build_media_public_url,
    delete_stored_media_file_if_unused,
    save_business_uploaded_media_file,
)


def _asset_url(asset: MediaAsset) -> str:
    if asset.file_url:
        return str(asset.file_url)
    if asset.file_path:
        return build_media_public_url(file_path=str(asset.file_path))
    return ""


def _image_for_role(assets: list[MediaAsset], role: str) -> str:
    for asset in assets:
        if asset.asset_role == role and asset.media_type == MediaAsset.MediaType.IMAGE:
            return _asset_url(asset)
    return ""


class PublicMenuItemSerializer(serializers.ModelSerializer):
    category_id = serializers.IntegerField(read_only=True)
    image = serializers.SerializerMethodField()
    marketplace_categories = serializers.SerializerMethodField()
    quota_enabled = serializers.SerializerMethodField()
    quota_remaining = serializers.SerializerMethodField()
    quota_label = serializers.SerializerMethodField()
    is_sold_out = serializers.SerializerMethodField()
    can_add_to_cart = serializers.SerializerMethodField()

    class Meta:
        model = MenuItem
        fields = [
            "id",
            "category_id",
            "name",
            "slug",
            "description",
            "minimum_grams",
            "price_amount",
            "image_url",
            "image",
            "is_available",
            "quota_enabled",
            "quota_remaining",
            "quota_label",
            "is_sold_out",
            "can_add_to_cart",
            "marketplace_categories",
        ]

    def get_image(self, obj) -> str:
        assets = getattr(obj, "prefetched_public_media_assets", None)
        if assets is None:
            assets = list(
                MediaAsset.objects.filter(
                    menu_item=obj,
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id")
            )
        return _image_for_role(assets, MediaAsset.AssetRole.THUMBNAIL) or _image_for_role(assets, MediaAsset.AssetRole.GALLERY)

    def get_marketplace_categories(self, obj) -> list[dict]:
        assignments = getattr(obj, "prefetched_marketplace_category_assignments", None)
        if assignments is None:
            assignments = list(
                obj.marketplace_category_assignments.select_related("marketplace_category").order_by(
                    "-is_primary",
                    "sort_order",
                    "id",
                )
            )
        return [
            {
                "id": assignment.marketplace_category_id,
                "slug": assignment.marketplace_category.slug,
                "name": assignment.marketplace_category.name,
                "is_primary": assignment.is_primary,
            }
            for assignment in assignments
        ]

    def _quota_state(self, obj):
        return build_menu_item_quota_state(obj)

    def get_quota_enabled(self, obj) -> bool:
        return self._quota_state(obj).enabled

    def get_quota_remaining(self, obj) -> int | None:
        return self._quota_state(obj).remaining

    def get_quota_label(self, obj) -> str | None:
        return self._quota_state(obj).label

    def get_is_sold_out(self, obj) -> bool:
        return self._quota_state(obj).is_sold_out

    def get_can_add_to_cart(self, obj) -> bool:
        return self._quota_state(obj).can_add_to_cart


class PublicMediaAssetSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = [
            "id",
            "media_type",
            "asset_role",
            "url",
            "alt_text",
            "sort_order",
        ]

    def get_url(self, obj) -> str:
        return _asset_url(obj)


class PublicOfferSerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()
    is_live = serializers.SerializerMethodField()

    class Meta:
        model = BusinessOffer
        fields = [
            "id",
            "title",
            "short_description",
            "description",
            "label",
            "tag",
            "offer_price_amount",
            "is_featured",
            "starts_at",
            "ends_at",
            "is_live",
            "image",
        ]

    def get_is_live(self, obj) -> bool:
        now = timezone.now()
        return bool(obj.is_active and obj.starts_at <= now < obj.ends_at)

    def get_image(self, obj) -> str:
        assets = getattr(obj, "prefetched_public_media_assets", None)
        if assets is None:
            assets = list(
                MediaAsset.objects.filter(
                    offer=obj,
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id")
            )
        return _image_for_role(assets, MediaAsset.AssetRole.COVER) or _image_for_role(assets, MediaAsset.AssetRole.GALLERY)


class PublicCategorySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    slug = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True, allow_null=True)
    menu_items = PublicMenuItemSerializer(many=True)




class DiscoveryMarketplaceCategorySerializer(serializers.ModelSerializer):
    image = serializers.SerializerMethodField()

    class Meta:
        model = MarketplaceCategory
        fields = [
            "id",
            "slug",
            "name",
            "description",
            "sort_order",
            "is_other",
            "image",
        ]

    def get_image(self, obj) -> str:
        assets = getattr(obj, "prefetched_public_media_assets", None)
        if assets is None:
            assets = list(
                MediaAsset.objects.filter(
                    marketplace_category=obj,
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id")
            )
        return _image_for_role(assets, MediaAsset.AssetRole.COVER) or _image_for_role(assets, MediaAsset.AssetRole.GALLERY)


class DiscoveryBusinessCardSerializer(PublicBusinessSerializer):
    class Meta(PublicBusinessSerializer.Meta):
        fields = PublicBusinessSerializer.Meta.fields + ["display_priority"]


class DistrictSummarySerializer(serializers.Serializer):
    code = serializers.CharField()
    label = serializers.CharField()


class DiscoveryWalletSummarySerializer(serializers.Serializer):
    balance = serializers.IntegerField()
    pending_balance = serializers.IntegerField()


class DiscoveryActiveCartSummarySerializer(serializers.Serializer):
    cart_id = serializers.IntegerField()
    business_id = serializers.IntegerField()
    business_name = serializers.CharField()
    item_count = serializers.IntegerField()
    subtotal_amount = serializers.IntegerField()
    customer_fee_amount = serializers.IntegerField()
    total_amount = serializers.IntegerField()


class DiscoveryNotificationReadinessSerializer(serializers.Serializer):
    notification_ready = serializers.BooleanField()
    active_device_count = serializers.IntegerField()


class DiscoveryHomeMenuItemSerializer(PublicMenuItemSerializer):
    business_id = serializers.IntegerField(source="business.id", read_only=True)
    business_name = serializers.CharField(source="business.business_name", read_only=True)
    business_is_featured = serializers.BooleanField(source="business.is_featured", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    marketplace_category_name = serializers.SerializerMethodField()

    class Meta(PublicMenuItemSerializer.Meta):
        fields = [
            "id",
            "business_id",
            "business_name",
            "business_is_featured",
            "category_id",
            "category_name",
            "marketplace_category_name",
            "name",
            "slug",
            "description",
            "minimum_grams",
            "price_amount",
            "image_url",
            "image",
            "is_available",
            "quota_enabled",
            "quota_remaining",
            "quota_label",
            "is_sold_out",
            "can_add_to_cart",
            "marketplace_categories",
        ]

    def get_marketplace_category_name(self, obj: MenuItem) -> str:
        assignments = getattr(obj, "prefetched_marketplace_category_assignments", None)
        if assignments is None:
            assignments = list(
                obj.marketplace_category_assignments.select_related("marketplace_category").order_by(
                    "-is_primary",
                    "sort_order",
                    "id",
                )
            )
        primary_assignment = next((assignment for assignment in assignments if assignment.is_primary), None)
        selected_assignment = primary_assignment or (assignments[0] if assignments else None)
        if selected_assignment is not None:
            return selected_assignment.marketplace_category.name
        return obj.category.name


class DiscoveryHomeResponseSerializer(serializers.Serializer):
    district = DistrictSummarySerializer()
    categories = DiscoveryMarketplaceCategorySerializer(many=True)
    featured_businesses = DiscoveryBusinessCardSerializer(many=True)
    other_businesses = DiscoveryBusinessCardSerializer(many=True)
    menu_items = DiscoveryHomeMenuItemSerializer(many=True)
    active_offers = PublicOfferSerializer(many=True)
    wallet_summary = DiscoveryWalletSummarySerializer(required=False, allow_null=True)
    active_cart_summary = DiscoveryActiveCartSummarySerializer(required=False, allow_null=True)
    notification_readiness = DiscoveryNotificationReadinessSerializer()


class DiscoveryCategoryListResponseSerializer(serializers.Serializer):
    district = serializers.CharField()
    count = serializers.IntegerField()
    results = DiscoveryMarketplaceCategorySerializer(many=True)


class PublicBusinessListResponseSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    results = PublicBusinessSerializer(many=True)


class PublicBusinessCategoryOverviewSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True, allow_null=True)


class PublicBusinessDetailResponseSerializer(serializers.Serializer):
    business = PublicBusinessSerializer()
    media = PublicMediaAssetSerializer(many=True)
    active_offers = PublicOfferSerializer(many=True)
    category_overview = PublicBusinessCategoryOverviewSerializer(many=True)
    server_time = serializers.DateTimeField()


class PublicBusinessMenuResponseSerializer(serializers.Serializer):
    business = PublicBusinessSerializer()
    categories = PublicCategorySerializer(many=True)
    active_offers = PublicOfferSerializer(many=True)


class DiscoverySearchBusinessSerializer(PublicBusinessSerializer):
    class Meta(PublicBusinessSerializer.Meta):
        fields = PublicBusinessSerializer.Meta.fields


class DiscoverySearchMenuItemResultSerializer(serializers.ModelSerializer):
    business_id = serializers.IntegerField(source="business.id", read_only=True)
    business_name = serializers.CharField(source="business.business_name", read_only=True)
    category_name = serializers.CharField(source="category.name", read_only=True)
    image = serializers.SerializerMethodField()
    quota_enabled = serializers.SerializerMethodField()
    quota_remaining = serializers.SerializerMethodField()
    quota_label = serializers.SerializerMethodField()
    is_sold_out = serializers.SerializerMethodField()
    can_add_to_cart = serializers.SerializerMethodField()

    class Meta:
        model = MenuItem
        fields = [
            "id",
            "business_id",
            "business_name",
            "category_name",
            "name",
            "slug",
            "description",
            "minimum_grams",
            "price_amount",
            "image",
            "quota_enabled",
            "quota_remaining",
            "quota_label",
            "is_sold_out",
            "can_add_to_cart",
        ]

    def get_image(self, obj) -> str:
        assets = getattr(obj, "prefetched_public_media_assets", None)
        if assets is None:
            assets = list(
                MediaAsset.objects.filter(
                    menu_item=obj,
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id")
            )
        return _image_for_role(assets, MediaAsset.AssetRole.THUMBNAIL) or _image_for_role(assets, MediaAsset.AssetRole.GALLERY)

    def _quota_state(self, obj):
        return build_menu_item_quota_state(obj)

    def get_quota_enabled(self, obj) -> bool:
        return self._quota_state(obj).enabled

    def get_quota_remaining(self, obj) -> int | None:
        return self._quota_state(obj).remaining

    def get_quota_label(self, obj) -> str | None:
        return self._quota_state(obj).label

    def get_is_sold_out(self, obj) -> bool:
        return self._quota_state(obj).is_sold_out

    def get_can_add_to_cart(self, obj) -> bool:
        return self._quota_state(obj).can_add_to_cart


class DiscoverySearchCategoryResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarketplaceCategory
        fields = ["id", "slug", "name", "description"]


class DiscoverySearchResponseSerializer(serializers.Serializer):
    query = serializers.CharField(allow_blank=True)
    district = serializers.CharField()
    matched = serializers.BooleanField()
    categories = DiscoverySearchCategoryResultSerializer(many=True)
    businesses = DiscoverySearchBusinessSerializer(many=True)
    menu_items = DiscoverySearchMenuItemResultSerializer(many=True)



class BusinessCategorySerializer(serializers.Serializer):
    id = serializers.IntegerField()
    assignment_id = serializers.IntegerField(allow_null=True)
    slug = serializers.CharField()
    name = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    sort_order = serializers.IntegerField()
    is_active = serializers.BooleanField()
    is_primary = serializers.BooleanField()
    is_selected = serializers.BooleanField()
    public_menu_item_count = serializers.IntegerField()


class BusinessCategoryWriteSerializer(serializers.Serializer):
    marketplace_category = serializers.IntegerField(min_value=1, required=False)
    is_active = serializers.BooleanField(required=False)
    is_primary = serializers.BooleanField(required=False)
    sort_order = serializers.IntegerField(required=False, min_value=0)


class BusinessMediaAssetSummarySerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = [
            "id",
            "asset_role",
            "alt_text",
            "sort_order",
            "url",
            "file_url",
            "file_path",
        ]

    def get_url(self, obj) -> str:
        return _asset_url(obj)


class BusinessMenuItemSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    marketplace_category_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        write_only=True,
        required=False,
    )
    marketplace_categories = serializers.SerializerMethodField()
    media_assets = serializers.SerializerMethodField()
    primary_image_url = serializers.SerializerMethodField()
    quota_enabled = serializers.BooleanField(source="quota.is_enabled", required=False, allow_null=True)
    quota_total = serializers.IntegerField(source="quota.quota_total", required=False, allow_null=True, min_value=0)
    quota_remaining = serializers.IntegerField(source="quota.quota_remaining", required=False, allow_null=True, min_value=0)
    low_stock_threshold = serializers.IntegerField(source="quota.low_stock_threshold", required=False, min_value=0)

    class Meta:
        model = MenuItem
        fields = [
            "id",
            "category",
            "category_name",
            "name",
            "slug",
            "description",
            "minimum_grams",
            "price_amount",
            "image_url",
            "sort_order",
            "is_active",
            "is_visible",
            "is_available",
            "quota_enabled",
            "quota_total",
            "quota_remaining",
            "low_stock_threshold",
            "marketplace_category_ids",
            "marketplace_categories",
            "media_assets",
            "primary_image_url",
        ]
        read_only_fields = ["id", "category", "category_name", "image_url"]

    def get_marketplace_categories(self, obj) -> list[dict]:
        assignments = getattr(obj, "prefetched_marketplace_category_assignments", None)
        if assignments is None:
            assignments = list(
                obj.marketplace_category_assignments.select_related("marketplace_category").order_by(
                    "-is_primary",
                    "sort_order",
                    "id",
                )
            )
        return [
            {
                "id": assignment.marketplace_category_id,
                "slug": assignment.marketplace_category.slug,
                "name": assignment.marketplace_category.name,
                "description": assignment.marketplace_category.description,
                "is_primary": assignment.is_primary,
            }
            for assignment in assignments
        ]

    def get_media_assets(self, obj) -> list[dict]:
        assets = getattr(obj, "prefetched_management_media_assets", None)
        if assets is None:
            assets = list(
                obj.media_assets.filter(
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id")
            )
        return BusinessMediaAssetSummarySerializer(assets, many=True).data

    def get_primary_image_url(self, obj) -> str:
        assets = getattr(obj, "prefetched_management_media_assets", None)
        if assets is None:
            assets = list(
                obj.media_assets.filter(
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id")
            )
        return _image_for_role(assets, MediaAsset.AssetRole.THUMBNAIL) or _image_for_role(assets, MediaAsset.AssetRole.COVER) or _image_for_role(
            assets,
            MediaAsset.AssetRole.GALLERY,
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        try:
            quota = instance.quota
        except MenuItemQuota.DoesNotExist:
            quota = None

        data["quota_enabled"] = bool(quota and quota.is_enabled)
        data["quota_total"] = int(quota.quota_total) if quota and quota.quota_total is not None else None
        data["quota_remaining"] = int(quota.quota_remaining) if quota and quota.quota_remaining is not None else None
        data["low_stock_threshold"] = int(quota.low_stock_threshold) if quota else 12
        return data

    def validate_name(self, value):
        normalized_name = value.strip()
        if not normalized_name:
            raise serializers.ValidationError("Menu item name cannot be blank.")
        return normalized_name

    def validate_slug(self, value):
        business = self.context.get("business")
        name = self.initial_data.get("name") or getattr(self.instance, "name", "")
        normalized_slug = slugify((value or "").strip())

        if not normalized_slug and name:
            normalized_slug = slugify(str(name).strip())

        if not normalized_slug:
            raise serializers.ValidationError("A valid slug could not be generated.")

        if business is None:
            return normalized_slug

        qs = MenuItem.objects.filter(
            business=business,
            slug=normalized_slug,
        )
        instance_pk = getattr(self.instance, "pk", None)
        if instance_pk is not None:
            qs = qs.exclude(pk=instance_pk)

        if qs.exists():
            raise serializers.ValidationError(
                "A menu item with this slug already exists for this business."
            )

        return normalized_slug

    def validate_price_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("price_amount must be positive.")
        return value

    def _resolve_marketplace_categories(self, category_ids: list[int] | None) -> list[MarketplaceCategory]:
        business = self.context.get("business")
        if business is None:
            return []

        category_ids = list(dict.fromkeys(category_ids or []))
        if not category_ids:
            raise serializers.ValidationError(
                {"marketplace_category_ids": "At least one system category must be selected."}
            )

        categories = list(
            MarketplaceCategory.objects.filter(
                id__in=category_ids,
                district=business.district,
                is_active=True,
            ).order_by("sort_order", "id")
        )
        if len(categories) != len(category_ids):
            raise serializers.ValidationError(
                {"marketplace_category_ids": "Selected categories must belong to this district and stay active."}
            )
        category_map = {category.id: category for category in categories}
        return [category_map[category_id] for category_id in category_ids]

    def _ensure_business_marketplace_assignments(self, *, business, categories: list[MarketplaceCategory]):
        has_active_primary = BusinessCategoryAssignment.objects.filter(
            business=business,
            is_active=True,
            is_primary=True,
        ).exists()

        for index, category in enumerate(categories):
            defaults = {
                "is_active": True,
                "sort_order": index,
            }
            if not has_active_primary and index == 0:
                defaults["is_primary"] = True
                has_active_primary = True

            BusinessCategoryAssignment.objects.update_or_create(
                business=business,
                marketplace_category=category,
                defaults=defaults,
            )

    def _sync_marketplace_categories(self, *, menu_item: MenuItem, categories: list[MarketplaceCategory]):
        existing = {
            assignment.marketplace_category_id: assignment
            for assignment in menu_item.marketplace_category_assignments.all()
        }
        keep_ids = {category.id for category in categories}

        for category_id, assignment in existing.items():
            if category_id not in keep_ids:
                assignment.delete()

        for index, category in enumerate(categories):
            MenuItemMarketplaceCategoryAssignment.objects.update_or_create(
                menu_item=menu_item,
                marketplace_category=category,
                defaults={
                    "is_primary": index == 0,
                    "sort_order": index,
                },
            )

        self._ensure_business_marketplace_assignments(
            business=menu_item.business,
            categories=categories,
        )

    def validate(self, attrs):
        business = self.context.get("business")
        instance = getattr(self, "instance", None)
        category = attrs.get("category") or getattr(instance, "category", None)

        is_active = attrs.get("is_active", getattr(instance, "is_active", True))
        is_visible = attrs.get("is_visible", getattr(instance, "is_visible", True))
        is_available = attrs.get("is_available", getattr(instance, "is_available", True))

        if category is None and business is not None:
            category = get_or_create_internal_menu_category(business=business)
            attrs["category"] = category

        if category is None:
            raise serializers.ValidationError({"category": "This field is required."})

        if business is not None and category.business_id != business.id:
            raise serializers.ValidationError(
                {"category": "Category does not belong to this business."}
            )

        if not category.is_active and is_active:
            raise serializers.ValidationError(
                {"is_active": "Cannot keep menu item active under an inactive category."}
            )

        if not is_active and is_visible:
            raise serializers.ValidationError(
                {"is_visible": "Inactive menu item cannot stay visible."}
            )

        if not category.is_visible and (is_visible or is_available):
            raise serializers.ValidationError(
                {
                    "is_visible": (
                        "Cannot keep menu item visible or available under a hidden category."
                    )
                }
            )

        if not category.is_active and (is_visible or is_available):
            raise serializers.ValidationError(
                {
                    "is_active": (
                        "Cannot keep menu item visible or available under an inactive category."
                    )
                }
            )

        category_ids = attrs.get("marketplace_category_ids", None)
        if category_ids is None and instance is None:
            raise serializers.ValidationError(
                {"marketplace_category_ids": "At least one system category must be selected."}
            )
        if category_ids is not None:
            attrs["_resolved_marketplace_categories"] = self._resolve_marketplace_categories(category_ids)

        quota_attrs = attrs.get("quota")
        if quota_attrs is not None:
            quota_total = quota_attrs.get("quota_total")
            quota_remaining = quota_attrs.get("quota_remaining")
            quota_enabled = quota_attrs.get("is_enabled")

            if quota_enabled is True and quota_remaining is None:
                quota_remaining = quota_total
                quota_attrs["quota_remaining"] = quota_remaining

            if quota_total is not None and quota_remaining is not None and int(quota_remaining) > int(quota_total):
                raise serializers.ValidationError({"quota_remaining": "Kalan kota toplam kotadan büyük olamaz."})

        return attrs

    def create(self, validated_data):
        quota_attrs = validated_data.pop("quota", None)
        categories = validated_data.pop("_resolved_marketplace_categories", [])
        validated_data.pop("marketplace_category_ids", None)
        menu_item = super().create(validated_data)
        self._sync_quota(menu_item=menu_item, quota_attrs=quota_attrs)
        self._sync_marketplace_categories(menu_item=menu_item, categories=categories)
        return menu_item

    def update(self, instance, validated_data):
        quota_attrs = validated_data.pop("quota", None)
        categories = validated_data.pop("_resolved_marketplace_categories", None)
        validated_data.pop("marketplace_category_ids", None)
        menu_item = super().update(instance, validated_data)
        self._sync_quota(menu_item=menu_item, quota_attrs=quota_attrs)
        if categories is not None:
            self._sync_marketplace_categories(menu_item=menu_item, categories=categories)
        return menu_item

    def _sync_quota(self, *, menu_item: MenuItem, quota_attrs: dict | None):
        if quota_attrs is None:
            return

        existing = MenuItemQuota.objects.filter(menu_item=menu_item).first()
        defaults = {
            "is_enabled": bool(existing.is_enabled) if existing else False,
            "quota_total": existing.quota_total if existing else None,
            "quota_remaining": existing.quota_remaining if existing else None,
            "quota_reserved": existing.quota_reserved if existing else 0,
            "low_stock_threshold": existing.low_stock_threshold if existing else 12,
        }
        defaults.update(quota_attrs)

        if defaults["is_enabled"] and defaults["quota_remaining"] is None:
            defaults["quota_remaining"] = defaults["quota_total"]

        if defaults["quota_total"] is not None and defaults["quota_remaining"] is not None and int(defaults["quota_remaining"]) > int(defaults["quota_total"]):
            raise serializers.ValidationError({"quota_remaining": "Kalan kota toplam kotadan büyük olamaz."})

        MenuItemQuota.objects.update_or_create(
            menu_item=menu_item,
            defaults=defaults,
        )


class MediaAssetSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = MediaAsset
        fields = [
            "id",
            "business",
            "menu_item",
            "marketplace_category",
            "offer",
            "file_url",
            "file_path",
            "url",
            "media_type",
            "asset_role",
            "alt_text",
            "sort_order",
            "is_active",
            "uploaded_by",
            "metadata",
        ]
        read_only_fields = ["id", "uploaded_by"]

    def get_url(self, obj) -> str:
        return _asset_url(obj)


class BusinessMediaAssetWriteSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True, required=False)

    class Meta:
        model = MediaAsset
        fields = [
            "id",
            "menu_item",
            "marketplace_category",
            "offer",
            "file",
            "file_url",
            "file_path",
            "media_type",
            "asset_role",
            "alt_text",
            "sort_order",
            "is_active",
            "metadata",
        ]
        read_only_fields = ["id"]

    def _validate_target_scope(self, *, business, menu_item, marketplace_category, offer):
        targets = [
            menu_item is not None,
            marketplace_category is not None,
            offer is not None,
        ]
        if sum(targets) > 1:
            raise serializers.ValidationError("Only one of menu_item, marketplace_category, offer can be set.")

        if menu_item is not None and menu_item.business_id != business.id:
            raise serializers.ValidationError({"menu_item": "Menu item does not belong to this business."})

        if offer is not None and offer.business_id != business.id:
            raise serializers.ValidationError({"offer": "Offer does not belong to this business."})

        if marketplace_category is not None and marketplace_category.district != business.district:
            raise serializers.ValidationError({"marketplace_category": "Category district mismatch with business."})

    def _validate_file_payload(self, *, uploaded_file, file_url: str, file_path: str, media_type: str, metadata: dict):
        if not uploaded_file and not file_url and not file_path:
            raise serializers.ValidationError("Either file upload, file_url or file_path is required.")

        allowed_ext = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".mp4", ".pdf"}
        if uploaded_file is not None:
            candidate_name = str(getattr(uploaded_file, "name", "") or "").strip().lower()
            extension = Path(candidate_name).suffix.lower()
            if extension not in allowed_ext:
                raise serializers.ValidationError({"file": "Unsupported file extension."})
            if media_type == MediaAsset.MediaType.IMAGE:
                content_type = str(getattr(uploaded_file, "content_type", "") or "").lower()
                if content_type and not content_type.startswith("image/"):
                    raise serializers.ValidationError({"file": "Only image files can be uploaded for image media."})

        candidate = str(file_url or file_path).strip().lower()
        if candidate:
            parsed = urlparse(candidate)
            path = parsed.path if parsed.path else candidate
            valid_extension = any(path.endswith(ext) for ext in allowed_ext)
            if not valid_extension:
                raise serializers.ValidationError({"file_url": "Unsupported file extension."})

        if file_url:
            scheme = urlparse(file_url).scheme
            if scheme and scheme not in {"http", "https"}:
                raise serializers.ValidationError({"file_url": "Only http/https URLs are supported."})

        max_size = int(getattr(settings, "MEDIA_ASSET_MAX_BYTES", 8 * 1024 * 1024))
        if uploaded_file is not None and int(getattr(uploaded_file, "size", 0) or 0) > max_size:
            raise serializers.ValidationError({"file": f"File size cannot exceed {max_size} bytes."})

        size_raw = metadata.get("file_size_bytes", 0)
        try:
            size_bytes = int(size_raw or 0)
        except (TypeError, ValueError):
            raise serializers.ValidationError({"metadata": "metadata.file_size_bytes must be integer."})

        if size_bytes and size_bytes > max_size:
            raise serializers.ValidationError({"metadata": f"file_size_bytes cannot exceed {max_size}."})

    def _persist_uploaded_file(self, *, uploaded_file):
        business = self.context["business"]
        request = self.context["request"]
        return save_business_uploaded_media_file(
            request=request,
            business_id=business.id,
            uploaded_file=uploaded_file,
        )

    def validate(self, attrs):
        business = self.context["business"]
        instance = getattr(self, "instance", None)

        menu_item = attrs.get("menu_item", getattr(instance, "menu_item", None))
        marketplace_category = attrs.get("marketplace_category", getattr(instance, "marketplace_category", None))
        offer = attrs.get("offer", getattr(instance, "offer", None))
        uploaded_file = attrs.get("file")
        media_type = attrs.get("media_type", getattr(instance, "media_type", MediaAsset.MediaType.IMAGE))

        self._validate_target_scope(
            business=business,
            menu_item=menu_item,
            marketplace_category=marketplace_category,
            offer=offer,
        )

        file_url = attrs.get("file_url", getattr(instance, "file_url", ""))
        file_path = attrs.get("file_path", getattr(instance, "file_path", ""))
        metadata = attrs.get("metadata", getattr(instance, "metadata", {}) or {})
        self._validate_file_payload(
            uploaded_file=uploaded_file,
            file_url=str(file_url or ""),
            file_path=str(file_path or ""),
            media_type=media_type,
            metadata=metadata,
        )

        sort_order = attrs.get("sort_order", getattr(instance, "sort_order", 0))
        if int(sort_order) < 0:
            raise serializers.ValidationError({"sort_order": "sort_order must be >= 0."})

        return attrs

    def create(self, validated_data):
        uploaded_file = validated_data.pop("file", None)
        if uploaded_file is not None:
            stored = self._persist_uploaded_file(uploaded_file=uploaded_file)
            validated_data["file_path"] = stored.file_path
            validated_data["file_url"] = stored.absolute_url
            validated_data["metadata"] = {
                **(validated_data.get("metadata") or {}),
                **stored.metadata,
            }
        return super().create(validated_data)

    def update(self, instance, validated_data):
        uploaded_file = validated_data.pop("file", None)
        previous_file_path = str(instance.file_path or "").strip()
        if uploaded_file is not None:
            stored = self._persist_uploaded_file(uploaded_file=uploaded_file)
            validated_data["file_path"] = stored.file_path
            validated_data["file_url"] = stored.absolute_url
            validated_data["metadata"] = {
                **(instance.metadata or {}),
                **(validated_data.get("metadata") or {}),
                **stored.metadata,
            }
        updated = super().update(instance, validated_data)
        if uploaded_file is not None and previous_file_path and previous_file_path != updated.file_path:
            delete_stored_media_file_if_unused(
                file_path=previous_file_path,
                excluding_asset_id=updated.id,
            )
        return updated


class BusinessOfferSerializer(serializers.ModelSerializer):
    menu_item_name = serializers.CharField(source="menu_item.name", read_only=True)
    media_assets = serializers.SerializerMethodField()
    primary_image_url = serializers.SerializerMethodField()

    class Meta:
        model = BusinessOffer
        fields = [
            "id",
            "business",
            "menu_item",
            "menu_item_name",
            "title",
            "short_description",
            "description",
            "label",
            "tag",
            "offer_price_amount",
            "starts_at",
            "ends_at",
            "is_active",
            "is_featured",
            "daily_limit",
            "sort_order",
            "media_assets",
            "primary_image_url",
        ]
        read_only_fields = ["id", "business"]

    def get_media_assets(self, obj) -> list[dict]:
        assets = getattr(obj, "prefetched_management_media_assets", None)
        if assets is None:
            assets = list(
                obj.media_assets.filter(
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id")
            )
        return BusinessMediaAssetSummarySerializer(assets, many=True).data

    def get_primary_image_url(self, obj) -> str:
        assets = getattr(obj, "prefetched_management_media_assets", None)
        if assets is None:
            assets = list(
                obj.media_assets.filter(
                    is_active=True,
                    media_type=MediaAsset.MediaType.IMAGE,
                ).order_by("sort_order", "id")
            )
        return _image_for_role(assets, MediaAsset.AssetRole.COVER) or _image_for_role(assets, MediaAsset.AssetRole.GALLERY)
