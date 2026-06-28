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
    AdminEmailBroadcastSerializer,
    BroadcastQueuedSerializer,
    DeviceUpsertResponseSerializer,
    DeviceUpsertSerializer,
    EmailBroadcastQueuedSerializer,
    NotificationReadinessSerializer,
    NotificationSerializer,
)
from notifications.services import BroadcastQueueUnavailable, EmailBroadcastService, SystemBroadcastService
from notifications.gate import evaluate_notification_readiness
from notifications.token_utils import is_demo_fcm_token
from common.drf import enforce_json_content_type
from common.openapi import ApiErrorEnvelopeSerializer
from common.permissions import IsAdminRole
from common.throttles import AdminBroadcastThrottle, DeviceUpsertThrottle
from logs.services import create_audit_log


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

        audience = data.get("audience", AdminBroadcastSerializer.Audience.ALL)
        district = data.get("district", "").strip()

        try:
            result = SystemBroadcastService.prepare_broadcast(
                title=data["title"],
                body=data["body"],
                payload=data.get("payload") or {},
                audience=audience,
                district=district,
                idempotency_key=str(request.headers.get("Idempotency-Key", "") or ""),
            )
        except BroadcastQueueUnavailable:
            create_audit_log(
                request=request,
                user=request.user,
                action="notifications.system_broadcast_queue_unavailable",
                description="Admin system broadcast queue unavailable",
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                meta={"audience": audience, "district": district},
            )
            return Response(
                {
                    "ok": False,
                    "error": {
                        "code": "broadcast_queue_unavailable",
                        "message": "Bildirim kuyruğu şu anda erişilebilir değil. Celery/Redis durumunu kontrol edip tekrar deneyin.",
                    },
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        create_audit_log(
            request=request,
            user=request.user,
            action="notifications.system_broadcast",
            description="Admin system broadcast prepared",
            status_code=200,
            meta={
                "broadcast_id": result.get("broadcast_id", ""),
                "queued": result.get("queued", 0),
                "estimated_count": result.get("estimated_count", 0),
                "task_id": result.get("task_id", ""),
                "queued_async": result.get("queued_async", False),
                "audience": audience,
                "district": district,
            },
        )

        return Response(
            {
                "queued": result.get("queued", 0),
                "broadcast_id": result.get("broadcast_id", ""),
                "task_id": result.get("task_id", ""),
                "queued_async": result.get("queued_async", False),
            },
            status=200,
        )


class AdminEmailBroadcastAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [AdminBroadcastThrottle]

    @extend_schema(operation_id="notification_admin_email_broadcast", request=AdminEmailBroadcastSerializer, responses={200: EmailBroadcastQueuedSerializer, 400: ApiErrorEnvelopeSerializer, 403: ApiErrorEnvelopeSerializer}, tags=["notifications"], examples=[OpenApiExample("Email broadcast dry run", value={"broadcast_id": "f3b1", "estimated_count": 124, "dry_run": True, "task_id": ""}, response_only=True)])
    def post(self, request):
        enforce_json_content_type(request)
        ser = AdminEmailBroadcastSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        try:
            result = EmailBroadcastService.prepare_broadcast(
                subject=data["subject"],
                message=data["message"],
                audience=data.get("audience", AdminEmailBroadcastSerializer.Audience.ALL),
                district=data.get("district", ""),
                dry_run=bool(data.get("dry_run", True)),
                idempotency_key=str(request.headers.get("Idempotency-Key", "") or ""),
            )
        except BroadcastQueueUnavailable:
            create_audit_log(
                request=request,
                user=request.user,
                action="notifications.email_broadcast_queue_unavailable",
                description="Admin email broadcast queue unavailable",
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                meta={
                    "audience": data.get("audience", ""),
                    "district": data.get("district", ""),
                    "dry_run": data.get("dry_run", True),
                },
            )
            return Response(
                {
                    "ok": False,
                    "error": {
                        "code": "broadcast_queue_unavailable",
                        "message": "Email kuyruğu şu anda erişilebilir değil. Celery/Redis durumunu kontrol edip tekrar deneyin.",
                    },
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        create_audit_log(
            request=request,
            user=request.user,
            action="notifications.email_broadcast",
            description="Admin email broadcast prepared",
            status_code=200,
            meta={
                "broadcast_id": result.get("broadcast_id", ""),
                "estimated_count": result.get("estimated_count", 0),
                "dry_run": result.get("dry_run", True),
                "audience": data.get("audience", ""),
                "district": data.get("district", ""),
                "subject_hash": result.get("subject_hash", ""),
                "task_id": result.get("task_id", ""),
            },
        )

        return Response(
            {
                "broadcast_id": result.get("broadcast_id", ""),
                "estimated_count": result.get("estimated_count", 0),
                "dry_run": result.get("dry_run", True),
                "task_id": result.get("task_id", ""),
            },
            status=200,
        )
