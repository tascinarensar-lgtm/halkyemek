from rest_framework.permissions import BasePermission

from notifications.gate import evaluate_notification_readiness


class HasActivePushDevice(BasePermission):
    message = "Bu işlem için aktif bir bildirim cihazı gerekiyor."

    def has_permission(self, request, view):
        status = evaluate_notification_readiness(user=request.user)
        request.notification_readiness_status = status

        if status.notification_ready:
            return True

        self.message = status.message
        return False
