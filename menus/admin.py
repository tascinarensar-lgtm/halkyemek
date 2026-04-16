from django.contrib import admin
from menus.models import BusinessOffer, Category, MediaAsset, MenuItem


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "business",
        "name",
        "sort_order",
        "is_active",
        "is_visible",
    )
    list_filter = ("is_active", "is_visible", "business")
    search_fields = ("name", "business__business_name")
    ordering = ("business", "sort_order", "id")


@admin.register(MenuItem)
class MenuItemAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "business",
        "category",
        "name",
        "price_amount",
        "sort_order",
        "is_active",
        "is_visible",
        "is_available",
    )
    list_filter = ("is_active", "is_visible", "is_available", "business")
    search_fields = ("name", "business__business_name", "category__name")
    ordering = ("business", "sort_order", "id")


@admin.register(MediaAsset)
class MediaAssetAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "business",
        "menu_item",
        "media_type",
        "is_active",
        "sort_order",
        "uploaded_by",
        "created_at",
    )
    list_filter = ("media_type", "is_active")
    search_fields = (
        "business__business_name",
        "menu_item__name",
        "alt_text",
        "file_url",
        "file_path",
    )
    ordering = ("sort_order", "id")


@admin.register(BusinessOffer)
class BusinessOfferAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "business",
        "menu_item",
        "title",
        "offer_price_amount",
        "is_active",
        "is_featured",
        "starts_at",
        "ends_at",
    )
    list_filter = ("is_active", "is_featured", "business")
    search_fields = ("title", "business__business_name", "menu_item__name")
    ordering = ("sort_order", "id")
