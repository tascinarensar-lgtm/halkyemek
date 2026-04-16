from django.contrib import admin

from .models import IdempotencyRecord


@admin.register(IdempotencyRecord)
class IdempotencyRecordAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'scope', 'key', 'status', 'response_status', 'created_at')
    list_filter = ('status', 'scope', 'created_at')
    search_fields = ('key', 'user__username', 'user__id', 'scope')
    readonly_fields = (
        'id', 'user', 'scope', 'key', 'status',
        'response_status', 'response_body',
        'error_code', 'error_message',
        'created_at', 'updated_at',
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
