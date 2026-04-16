from django.contrib import admin
from .models import SystemLog

@admin.register(SystemLog)
class SystemLogAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "action",
        "created_at",
    )
    list_filter = ("action", "created_at")
    search_fields = ("description", "user__username")
    readonly_fields = (
        "user",
        "action",
        "description",
        "ip_address",
        "created_at",
    )

    def has_delete_permission(self, request, obj=None):
        return False