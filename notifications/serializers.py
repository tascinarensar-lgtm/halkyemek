from django.db import models
from django.db.utils import OperationalError, ProgrammingError
from django.utils.html import strip_tags
from rest_framework import serializers
from notifications.models import Device, Notification


def _sanitize_plain_text(value: str) -> str:
    text = strip_tags(str(value or ""))
    text = text.replace("\x00", "")
    lines = [" ".join(line.split()) for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(line for line in lines if line).strip()


class DeviceUpsertSerializer(serializers.Serializer):
    platform = serializers.ChoiceField(choices=Device.Platform.choices, required=False)
    device_type = serializers.CharField(required=False, allow_blank=True, default="", write_only=True)
    fcm_token = serializers.CharField(max_length=255, trim_whitespace=True, required=False)
    token = serializers.CharField(max_length=255, trim_whitespace=True, required=False, allow_blank=True, default="", write_only=True)
    device_id = serializers.CharField(required=False, allow_blank=True, default="")
    app_version = serializers.CharField(required=False, allow_blank=True, default="")
    permission_granted = serializers.BooleanField(required=False, default=True)

    def validate_fcm_token(self, value: str) -> str:
        token = str(value or "").strip()
        if not token:
            raise serializers.ValidationError("fcm_token_required")
        return token

    def validate(self, attrs):
        token = str(attrs.get("fcm_token") or attrs.get("token") or "").strip()
        if not token:
            raise serializers.ValidationError({"fcm_token": "fcm_token_required"})

        platform = str(attrs.get("platform") or attrs.get("device_type") or "").strip().upper()
        normalized_platform = {
            "WEB": Device.Platform.WEB,
            "WEBPUSH": Device.Platform.WEB,
            "IOS": Device.Platform.IOS,
            "ANDROID": Device.Platform.ANDROID,
        }.get(platform, Device.Platform.WEB)

        attrs["fcm_token"] = token
        attrs["platform"] = normalized_platform
        return attrs


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = [
            "id",
            "type",
            "title",
            "body",
            "payload",
            "status",
            "email_status",
            "scheduled_at",
            "sent_at",
            "created_at",
        ]

    email_status = serializers.SerializerMethodField()

    def get_email_status(self, obj) -> str:
        try:
            attempt = obj.email_attempts.order_by("-id").first()
        except (OperationalError, ProgrammingError):
            # Keep the notification list readable during local/staged rollouts
            # where the email-attempt migration has not been applied yet.
            return ""
        return attempt.status if attempt else ""


class AdminBroadcastSerializer(serializers.Serializer):
    class Audience(models.TextChoices):
        ALL = "ALL", "All"
        CUSTOMERS = "CUSTOMERS", "Customers"
        BUSINESS_MEMBERS = "BUSINESS_MEMBERS", "Business Members"

    title = serializers.CharField(max_length=120)
    body = serializers.CharField(max_length=240)
    payload = serializers.JSONField(required=False)
    audience = serializers.ChoiceField(choices=Audience.choices, required=False, default=Audience.ALL)
    district = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        attrs.setdefault("audience", self.Audience.ALL)
        return attrs


class AdminEmailBroadcastSerializer(serializers.Serializer):
    class Audience(models.TextChoices):
        ALL = "ALL", "All"
        CUSTOMERS = "CUSTOMERS", "Customers"
        BUSINESS_MEMBERS = "BUSINESS_MEMBERS", "Business Members"

    subject = serializers.CharField(max_length=160, trim_whitespace=True)
    message = serializers.CharField(max_length=2000, trim_whitespace=True)
    audience = serializers.ChoiceField(choices=Audience.choices, required=False, default=Audience.ALL)
    district = serializers.CharField(required=False, allow_blank=True, trim_whitespace=True)
    dry_run = serializers.BooleanField(required=False, default=True)

    def validate_subject(self, value: str) -> str:
        subject = _sanitize_plain_text(value)
        if not subject:
            raise serializers.ValidationError("subject_required")
        if len(subject) > 160:
            raise serializers.ValidationError("subject_too_long")
        return subject

    def validate_message(self, value: str) -> str:
        message = _sanitize_plain_text(value)
        if not message:
            raise serializers.ValidationError("message_required")
        if len(message) > 2000:
            raise serializers.ValidationError("message_too_long")
        return message

    def validate(self, attrs):
        attrs.setdefault("audience", self.Audience.ALL)
        attrs.setdefault("district", "")
        attrs.setdefault("dry_run", True)
        return attrs


class NotificationReadinessSerializer(serializers.Serializer):
    notification_ready = serializers.BooleanField()
    active_device_count = serializers.IntegerField()
    message = serializers.CharField(required=False, allow_blank=True)


class DeviceUpsertResponseSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    platform = serializers.ChoiceField(choices=Device.Platform.choices)
    permission_granted = serializers.BooleanField()
    is_active = serializers.BooleanField()
    token_rotated_deactivated_count = serializers.IntegerField()
    notification_readiness = NotificationReadinessSerializer()


class BroadcastQueuedSerializer(serializers.Serializer):
    queued = serializers.IntegerField()
    broadcast_id = serializers.CharField(required=False, allow_blank=True)
    task_id = serializers.CharField(required=False, allow_blank=True)
    queued_async = serializers.BooleanField(required=False)


class EmailBroadcastQueuedSerializer(serializers.Serializer):
    broadcast_id = serializers.CharField()
    estimated_count = serializers.IntegerField()
    dry_run = serializers.BooleanField()
    task_id = serializers.CharField(required=False, allow_blank=True)
