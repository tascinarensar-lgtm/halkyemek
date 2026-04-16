from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from drf_spectacular.utils import OpenApiExample, extend_schema

from businesses.models import BusinessMember
from notifications.models import Device, Notification
from notifications.serializers import (
    AdminBroadcastSerializer,
    BroadcastQueuedSerializer,
    DeviceUpsertResponseSerializer,
    DeviceUpsertSerializer,
    NotificationReadinessSerializer,
    NotificationSerializer,
)
from notifications.services import NotificationService
from notifications.gate import evaluate_notification_readiness
from notifications.token_utils import is_demo_fcm_token
from common.drf import enforce_json_content_type
from common.openapi import ApiErrorEnvelopeSerializer
from common.permissions import IsAdminRole
from common.throttles import AdminBroadcastThrottle, DeviceUpsertThrottle


class DeviceUpsertAPIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [DeviceUpsertThrottle]

    @extend_schema(operation_id="notification_device_upsert", request=DeviceUpsertSerializer, responses={200: DeviceUpsertResponseSerializer, 400: ApiErrorEnvelopeSerializer}, tags=["notifications"], examples=[OpenApiExample("Device readiness response", value={"id": 22, "platform": "ANDROID", "permission_granted": True, "is_active": True, "token_rotated_deactivated_count": 0, "notification_readiness": {"notification_ready": True, "active_device_count": 1, "message": "ready"}}, response_only=True)])
    @transaction.atomic
    def post(self, request):
        enforce_json_content_type(request)
        ser = DeviceUpsertSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        data = ser.validated_data
        now = timezone.now()

        device = Device.objects.filter(fcm_token=data["fcm_token"]).first()
        if device is None:
            device = Device(
                fcm_token=data["fcm_token"],
                user=request.user,
            )

        device.user = request.user
        device.platform = data["platform"]
        device.device_id = data.get("device_id", "")
        device.app_version = data.get("app_version", "")
        device.permission_granted = data["permission_granted"]
        device.is_active = True
        device.last_token_refresh_at = now
        device.save()

        deactivated_devices = 0
        if not is_demo_fcm_token(device.fcm_token):
            deactivated_devices += Device.objects.filter(
                user=request.user,
                platform=device.platform,
                is_active=True,
                fcm_token__startswith="demo-",
            ).exclude(pk=device.pk).update(
                is_active=False,
                permission_granted=False,
                last_error="replaced-by-real-device",
            )
        if device.device_id:
            deactivated_devices += Device.objects.filter(
                user=request.user,
                platform=device.platform,
                device_id=device.device_id,
                is_active=True,
            ).exclude(pk=device.pk).update(
                is_active=False,
                permission_granted=False,
            )

        readiness = evaluate_notification_readiness(user=request.user)
        return Response(
            {
                "id": device.pk,
                "platform": device.platform,
                "permission_granted": device.permission_granted,
                "is_active": device.is_active,
                "token_rotated_deactivated_count": int(deactivated_devices),
                "notification_readiness": readiness.as_dict(),
            },
            status=200,
        )


class NotificationListAPIView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer

    @extend_schema(operation_id="notification_list", responses={200: NotificationSerializer(many=True), 403: ApiErrorEnvelopeSerializer}, tags=["notifications"])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notification.objects.none()
        if not self.request.user.is_authenticated:
            return Notification.objects.none()
        return Notification.objects.filter(user=self.request.user).order_by("-id")


class NotificationReadinessAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="notification_readiness", responses={200: NotificationReadinessSerializer, 403: ApiErrorEnvelopeSerializer}, tags=["notifications"], examples=[OpenApiExample("Notification readiness", value={"notification_ready": True, "active_device_count": 1, "message": "ready"}, response_only=True)])
    def get(self, request):
        readiness = evaluate_notification_readiness(user=request.user)
        return Response(readiness.as_dict(), status=200)


class AdminBroadcastAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [AdminBroadcastThrottle]

    @extend_schema(operation_id="notification_admin_broadcast", request=AdminBroadcastSerializer, responses={200: BroadcastQueuedSerializer, 400: ApiErrorEnvelopeSerializer, 403: ApiErrorEnvelopeSerializer}, tags=["notifications"], examples=[OpenApiExample("Broadcast queued", value={"queued": 124}, response_only=True)])
    def post(self, request):
        enforce_json_content_type(request)
        ser = AdminBroadcastSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        user_model = request.user.__class__
        users = user_model.objects.all()
        audience = data.get("audience", AdminBroadcastSerializer.Audience.ALL)
        district = data.get("district", "").strip()

        if audience == AdminBroadcastSerializer.Audience.CUSTOMERS:
            users = users.filter(role=user_model.Role.CUSTOMER)
        elif audience == AdminBroadcastSerializer.Audience.BUSINESS_MEMBERS:
            users = users.filter(
                business_memberships__is_active=True,
            ).distinct()

        if district:
            users = users.filter(
                business_memberships__is_active=True,
                business_memberships__business__district=district,
            ).distinct()

        count = 0
        for user in users.iterator():
            NotificationService.enqueue(
                user=user,
                type=Notification.Type.SYSTEM_BROADCAST,
                title=data["title"],
                body=data["body"],
                payload=data.get("payload") or {},
                dedupe_key=f"broadcast:{data['title']}:{user.id}",
            )
            count += 1

        return Response({"queued": count}, status=200)
