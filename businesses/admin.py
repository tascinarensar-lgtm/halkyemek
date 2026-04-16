from django.contrib import admin

from .models import (
    BusinessCategoryAssignment,
    BusinessMember,
    BusinessProfile,
    MarketplaceCategory,
)


@admin.register(BusinessProfile)
class BusinessAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "business_name",
        "district",
        "listing_type",
        "is_featured",
        "display_priority",
        "contact_user_metadata_id",
        "contact_email",
        "contact_gsm_number",
        "is_active",
        "is_approved",
        "is_listed",
        "marketplace_is_visible",
    )
    list_filter = (
        "is_active",
        "is_approved",
        "is_listed",
        "district",
        "listing_type",
        "is_featured",
        "marketplace_is_visible",
    )
    search_fields = (
        "business_name",
        "kyc_email",
        "kyc_contact_name",
        "kyc_contact_surname",
        "kyc_gsm_number",
        "kyc_legal_company_title",
        "iyzico_submerchant_key",
    )
    autocomplete_fields = ("contact_user",)

    @admin.display(description="Contact user id")
    def contact_user_metadata_id(self, obj):
        return obj.contact_user_id

@admin.register(BusinessMember)
class BusinessMemberAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "business",
        "user",
        "role",
        "is_active",
        "granted_by",
        "created_at",
    )
    list_filter = ("role", "is_active")
    search_fields = (
        "business__business_name",
        "user__username",
        "user__google_email",
    )
    autocomplete_fields = ("business", "user", "granted_by")


@admin.register(MarketplaceCategory)
class MarketplaceCategoryAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "district",
        "slug",
        "name",
        "is_other",
        "is_active",
        "sort_order",
    )
    list_filter = ("district", "is_other", "is_active")
    search_fields = ("slug", "name")
    ordering = ("district", "sort_order", "id")


@admin.register(BusinessCategoryAssignment)
class BusinessCategoryAssignmentAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "business",
        "marketplace_category",
        "is_primary",
        "is_active",
        "sort_order",
    )
    list_filter = ("is_primary", "is_active", "marketplace_category__district")
    search_fields = (
        "business__business_name",
        "marketplace_category__name",
        "marketplace_category__slug",
    )
