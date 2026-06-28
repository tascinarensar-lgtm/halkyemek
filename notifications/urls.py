from django.urls import path

from notifications.views import (
    AdminBroadcastAPIView,
    AdminEmailBroadcastAPIView,
    DeviceUpsertAPIView,
    NotificationListAPIView,
    NotificationReadinessAPIView,
)

urlpatterns = [
    path("devices/", DeviceUpsertAPIView.as_view(), name="notification_device_upsert"),
    path("readiness/", NotificationReadinessAPIView.as_view(), name="notification_readiness"),
    path("", NotificationListAPIView.as_view(), name="notification_list"),
    path("admin/broadcast/", AdminBroadcastAPIView.as_view(), name="notification_admin_broadcast"),
    path("admin/email-broadcast/", AdminEmailBroadcastAPIView.as_view(), name="notification_admin_email_broadcast"),
]
