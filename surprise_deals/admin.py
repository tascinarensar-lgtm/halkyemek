from django.contrib import admin

from surprise_deals.models import SurpriseDeal, SurpriseDealReservation


@admin.register(SurpriseDeal)
class SurpriseDealAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "business",
        "title",
        "status",
        "sale_price_amount",
        "quantity_total",
        "quantity_remaining",
        "quantity_reserved",
        "pickup_window_start",
        "pickup_window_end",
    )
    list_filter = ("status", "currency", "pickup_window_start", "pickup_window_end")
    search_fields = ("title", "business__business_name")
    readonly_fields = ("created_at", "updated_at")


@admin.register(SurpriseDealReservation)
class SurpriseDealReservationAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "surprise_deal",
        "user",
        "checkout_session",
        "quantity",
        "status",
        "reserved_at",
        "expires_at",
    )
    list_filter = ("status", "reserved_at", "expires_at")
    search_fields = ("surprise_deal__title", "user__username", "user__google_email")
    readonly_fields = ("created_at", "updated_at")
