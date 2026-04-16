from django.db import models
from rest_framework import serializers
from notifications.models import Device, Notification


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
            "scheduled_at",
            "sent_at",
            "created_at",
        ]


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
