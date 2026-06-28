
from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q


class Device(models.Model):
    class Platform(models.TextChoices):
        ANDROID = "ANDROID", "Android"
        IOS = "IOS", "iOS"
        WEB = "WEB", "Web"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="devices")
    platform = models.CharField(max_length=16, choices=Platform.choices)
    fcm_token = models.CharField(max_length=255, db_index=True)
    device_id = models.CharField(max_length=128, blank=True, default="")
    app_version = models.CharField(max_length=32, blank=True, default="")
    permission_granted = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(auto_now=True)
    last_token_refresh_at = models.DateTimeField(auto_now_add=True)
    failure_count = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["fcm_token"],
                condition=Q(fcm_token__gt=""),
                name="uq_device_fcm_token_nonempty",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "is_active"], name="idx_device_user_active"),
            models.Index(fields=["platform", "is_active"], name="idx_device_platform_active"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.platform}:{self.device_id or self.fcm_token[:12]}" # type: ignore


class Notification(models.Model):
    class Type(models.TextChoices):
        ORDER_PAID = "ORDER_PAID", "Order Paid"
        ORDER_CONSUMED = "ORDER_CONSUMED", "Order Consumed"
        ORDER_USED = "ORDER_USED", "Order Used"
        PAYMENT_SETTLED = "PAYMENT_SETTLED", "Payment Settled"
        PAYOUT_SENT = "PAYOUT_SENT", "Payout Sent"
        PAYOUT_CONFIRMED = "PAYOUT_CONFIRMED", "Payout Confirmed"
        BALANCE_LOW = "BALANCE_LOW", "Balance Low"
        SYSTEM_BROADCAST = "SYSTEM_BROADCAST", "System Broadcast"
        USER_REMINDER = "USER_REMINDER", "User Reminder"
        EMAIL_BROADCAST = "EMAIL_BROADCAST", "Email Broadcast"
        SURPRISE_DEAL_RESERVED = "SURPRISE_DEAL_RESERVED", "Surprise Deal Reserved"
        SURPRISE_DEAL_CONSUMED = "SURPRISE_DEAL_CONSUMED", "Surprise Deal Consumed"
        SURPRISE_DEAL_EXPIRED = "SURPRISE_DEAL_EXPIRED", "Surprise Deal Expired"
        SURPRISE_DEAL_CLOSED = "SURPRISE_DEAL_CLOSED", "Surprise Deal Closed"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SENT = "SENT", "Sent"
        FAILED = "FAILED", "Failed"
        CANCELLED = "CANCELLED", "Cancelled"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    type = models.CharField(max_length=32, choices=Type.choices)
    title = models.CharField(max_length=120)
    body = models.CharField(max_length=240)
    payload = models.JSONField(default=dict, blank=True)
    dedupe_key = models.CharField(max_length=128, blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    scheduled_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "dedupe_key"],
                condition=Q(dedupe_key__gt=""),
                name="uq_notification_user_dedupe_nonempty",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "status", "-id"], name="idx_notif_user_status_id"),
            models.Index(fields=["type", "status"], name="idx_notif_type_status"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.type}:{self.status}" # type: ignore


class DeliveryAttempt(models.Model): # log
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SENT = "SENT", "Sent"
        FAILED = "FAILED", "Failed"

    notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name="attempts")
    device = models.ForeignKey(Device, on_delete=models.CASCADE, related_name="delivery_attempts")
    provider = models.CharField(max_length=32, default="FCM")
    provider_message_id = models.CharField(max_length=128, blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    response_payload = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True, default="")
    retry_count = models.PositiveIntegerField(default=0)
    retry_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "retry_at"], name="idx_delivery_status_retry"),
            models.Index(fields=["notification", "device"], name="idx_delivery_notif_device"),
        ]


class EmailDeliveryAttempt(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SENT = "SENT", "Sent"
        FAILED = "FAILED", "Failed"

    notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name="email_attempts")
    email_to = models.EmailField()
    provider = models.CharField(max_length=32, default="EMAIL")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    error = models.TextField(blank=True, default="")
    retry_count = models.PositiveIntegerField(default=0)
    retry_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "retry_at"], name="idx_email_delivery_retry"),
            models.Index(fields=["notification", "email_to"], name="idx_email_delivery_notif"),
        ]
