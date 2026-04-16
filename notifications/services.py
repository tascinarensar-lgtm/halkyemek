from __future__ import annotations
"""
servis katmanı.
Bildirimi kuyruğa alıyor
O kullanıcıya ait uygun cihazları buluyor
Her cihaz için bir gönderim denemesi kaydı oluşturuyor
FCM ile gerçekten push göndermeye çalışıyor
Başarılıysa kayıtları güncelliyor
Hatalıysa retry/backoff uyguluyor
Çok hata veren cihazı otomatik pasife çekiyor
Bu servis şunu yapıyor:
kullanıcıya gönderilecek bildirimi kaydeder
kullanıcının cihazlarını bulur
her cihaz için gönderim görevi oluşturur
zamanı gelen görevleri FCM ile yollar
başarılıysa kaydeder
hatalıysa tekrar deneme zamanı verir
çok hata veren cihazı kapatır
"""
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import get_user_model
from django.db import transaction, models
from django.utils import timezone

from notifications.models import DeliveryAttempt, Device, Notification

User = get_user_model()


def _stringify_payload(payload: dict) -> dict[str, str]: #payload içindeki tüm key ve value’ları string’e çevirmek.
    out: dict[str, str] = {} #Boş bir sözlük oluşturuyor.
    for k, v in (payload or {}).items(): #Eğer payload varsa onun item’ları üzerinde dönüyor.
        out[str(k)] = str(v) #Her key ve value string’e çevrilip yeni sözlüğe yazılıyor.
    return out


class NotificationService: # Bu sınıf, bildirim operasyonlarını tek yerde toplamak için yazılmış. dağınık kod yazmak yerine daha iyi bir seçenek.
    MAX_RETRY_COUNT = 5
    AUTO_DISABLE_DEVICE_FAILURE_COUNT = 10

    @staticmethod
    def _enqueue_dedupe_ttl_seconds() -> int:
        return max(int(getattr(settings, "NOTIFICATION_ENQUEUE_DEDUP_TTL_SECONDS", 300)), 30)

    @staticmethod
    def _attempt_enqueue_key(attempt_id: int) -> str:
        return f"notifications:attempt-enqueued:{int(attempt_id)}"

    @staticmethod
    def _send_attempt_lock_key(attempt_id: int) -> str:
        return f"notifications:attempt-send-lock:{int(attempt_id)}"

    @staticmethod
    def _send_attempt_lock_ttl_seconds() -> int:
        ttl = int(getattr(settings, "NOTIFICATION_SEND_LOCK_TTL_SECONDS", 180) or 180)
        return max(ttl, 30)

    @staticmethod
    def enqueue_attempt_delivery(attempt_id: int) -> bool:
        key = NotificationService._attempt_enqueue_key(attempt_id)
        ttl = NotificationService._enqueue_dedupe_ttl_seconds()
        if not cache.add(key, 1, timeout=ttl):
            return False

        from notifications.tasks import send_notification_attempt_task

        try:
            send_notification_attempt_task.delay(int(attempt_id))
        except Exception:
            cache.delete(key)
            raise
        return True

    @staticmethod
    def _create_delivery_attempts(*, notification: Notification, user) -> None:
        devices = Device.objects.filter(
            user=user,
            is_active=True,
            permission_granted=True,
        )
        attempts = [
            DeliveryAttempt(
                notification=notification,
                device=device,
                status=DeliveryAttempt.Status.PENDING,
            )
            for device in devices
        ]
        DeliveryAttempt.objects.bulk_create(attempts)

    @staticmethod
    @transaction.atomic
    def enqueue( #Bir bildirimi sisteme eklemek ve uygun cihazlar için gönderim denemeleri oluşturmak.
        *,
        user,
        type: str,
        title: str,
        body: str,
        payload: dict | None = None,
        dedupe_key: str = "",
    ) -> Notification: # model dönecek
        dedupe_key = (dedupe_key or "").strip()
        notification_defaults = {
            "type": type,
            "title": title,
            "body": body,
            "payload": payload or {},
            "status": Notification.Status.PENDING,
        }

        if not dedupe_key:
            notif = Notification.objects.create(
                user=user,
                dedupe_key="",
                **notification_defaults,
            )
            NotificationService._create_delivery_attempts(notification=notif, user=user)
            NotificationService._schedule_notification_delivery(notification_id=int(getattr(notif, "pk")))
            return notif

        notif, created = Notification.objects.get_or_create(
            user=user,
            dedupe_key=dedupe_key,
            defaults=notification_defaults,
        )
        if created:
            NotificationService._create_delivery_attempts(notification=notif, user=user)
            NotificationService._schedule_notification_delivery(notification_id=int(getattr(notif, "pk")))
        return notif

    @staticmethod
    def _schedule_notification_delivery(*, notification_id: int) -> None:
        def _enqueue() -> None:
            try:
                from notifications.tasks import process_notification_attempts_for_notification_task

                process_notification_attempts_for_notification_task.delay(notification_id)
            except Exception:
                # Beat/cron based fallback still processes pending attempts.
                return

        transaction.on_commit(_enqueue)

    @staticmethod
    def _sync_notification_status(*, notification: Notification) -> Notification:
        attempts = DeliveryAttempt.objects.filter(notification_id=int(getattr(notification, "pk")))
        if not attempts.exists():
            return notification

        if attempts.filter(status=DeliveryAttempt.Status.SENT).exists():
            status = Notification.Status.SENT
            sent_at = attempts.filter(status=DeliveryAttempt.Status.SENT).order_by('-sent_at').values_list('sent_at', flat=True).first() or timezone.now()
        elif attempts.filter(retry_count__lt=NotificationService.MAX_RETRY_COUNT).filter(
            models.Q(status=DeliveryAttempt.Status.PENDING) |
            (models.Q(status=DeliveryAttempt.Status.FAILED) & (models.Q(retry_at__isnull=True) | models.Q(retry_at__gte=timezone.now())))
        ).exists():
            status = Notification.Status.PENDING
            sent_at = None
        else:
            status = Notification.Status.FAILED
            sent_at = None

        update_fields: list[str] = []
        if notification.status != status:
            notification.status = status
            update_fields.append('status')
        if notification.sent_at != sent_at:
            notification.sent_at = sent_at
            update_fields.append('sent_at')
        if update_fields:
            notification.save(update_fields=update_fields)
        return notification

    @staticmethod
    def send_attempt(attempt_id: int) -> DeliveryAttempt: #Tek bir DeliveryAttempt kaydını gerçekten göndermeye çalışmak. Bu metod asıl işin yapıldığı yer.
        from notifications.fcm import send_fcm_message ## http isteği atacak fonksiyon kendi yazdığımız bir yardımcı fonksiyon
        lock_key = NotificationService._send_attempt_lock_key(attempt_id)
        lock_ttl = NotificationService._send_attempt_lock_ttl_seconds()
        if not cache.add(lock_key, 1, timeout=lock_ttl):
            return DeliveryAttempt.objects.select_related("notification", "device", "notification__user").get(id=attempt_id)

        attempt: DeliveryAttempt
        try:
            with transaction.atomic():
                attempt = (
                    DeliveryAttempt.objects
                    .select_for_update()
                    .select_related("notification", "device", "notification__user")
                    .get(id=attempt_id)
                )

                if attempt.status == DeliveryAttempt.Status.SENT:
                    return attempt

                if int(attempt.retry_count) >= NotificationService.MAX_RETRY_COUNT:
                    NotificationService._sync_notification_status(notification=attempt.notification)
                    return attempt

                now = timezone.now()
                if attempt.retry_at is not None and attempt.retry_at > now:
                    return attempt

                if not attempt.device.is_active or not attempt.device.permission_granted:
                    attempt.status = DeliveryAttempt.Status.FAILED
                    attempt.error = "inactive-or-no-permission"
                    attempt.retry_count = NotificationService.MAX_RETRY_COUNT
                    attempt.retry_at = None
                    attempt.save(update_fields=["status", "error", "retry_count", "retry_at"])
                    NotificationService._sync_notification_status(notification=attempt.notification)
                    return attempt

                message_context = {
                    "token": attempt.device.fcm_token,
                    "title": attempt.notification.title,
                    "body": attempt.notification.body,
                    "data": _stringify_payload(attempt.notification.payload),
                }

            try:
                resp = send_fcm_message(
                    token=message_context["token"],
                    title=message_context["title"],
                    body=message_context["body"],
                    data=message_context["data"],
                )
            except Exception as exc:
                with transaction.atomic():
                    attempt = (
                        DeliveryAttempt.objects
                        .select_for_update()
                        .select_related("notification", "device", "notification__user")
                        .get(id=attempt_id)
                    )
                    if attempt.status == DeliveryAttempt.Status.SENT:
                        return attempt
                    if int(attempt.retry_count) < NotificationService.MAX_RETRY_COUNT:
                        attempt.retry_count += 1
                    backoff_minutes = min(60, 2 ** min(int(attempt.retry_count), 5))
                    attempt.status = DeliveryAttempt.Status.FAILED
                    attempt.error = str(exc)
                    attempt.response_payload = getattr(exc, "response_payload", {}) or {}
                    attempt.retry_at = (
                        timezone.now() + timedelta(minutes=backoff_minutes)
                        if int(attempt.retry_count) < NotificationService.MAX_RETRY_COUNT
                        else None
                    )
                    attempt.save(update_fields=["retry_count", "status", "error", "retry_at", "response_payload"])

                    attempt.device.failure_count += 1
                    attempt.device.last_error = str(exc)
                    if attempt.device.failure_count >= NotificationService.AUTO_DISABLE_DEVICE_FAILURE_COUNT:
                        attempt.device.is_active = False
                        attempt.device.last_error = f"auto-disabled: {exc}"
                        attempt.device.save(update_fields=["failure_count", "last_error", "is_active"])
                    else:
                        attempt.device.save(update_fields=["failure_count", "last_error"])

                    NotificationService._sync_notification_status(notification=attempt.notification)
                    return attempt

            with transaction.atomic():
                attempt = (
                    DeliveryAttempt.objects
                    .select_for_update()
                    .select_related("notification", "device", "notification__user")
                    .get(id=attempt_id)
                )
                if attempt.status == DeliveryAttempt.Status.SENT:
                    return attempt

                attempt.status = DeliveryAttempt.Status.SENT
                attempt.provider_message_id = str(resp.get("name", "") or "")
                attempt.response_payload = resp
                attempt.sent_at = timezone.now()
                attempt.error = ""
                attempt.retry_at = None
                attempt.save(update_fields=[
                    "status",
                    "provider_message_id",
                    "response_payload",
                    "sent_at",
                    "error",
                    "retry_at",
                ])
                NotificationService._sync_notification_status(notification=attempt.notification)

                attempt.device.failure_count = 0
                attempt.device.last_error = ""
                attempt.device.save(update_fields=["failure_count", "last_error"])
                return attempt
        finally:
            cache.delete(lock_key)

    @staticmethod
    def due_attempt_ids(*, notification_id: int | None = None, limit: int = 100) -> list[int]:
        now = timezone.now() # şimdiki zamanı alıyor
        attempts = DeliveryAttempt.objects.filter(
            status__in=[DeliveryAttempt.Status.PENDING, DeliveryAttempt.Status.FAILED],
            retry_count__lt=NotificationService.MAX_RETRY_COUNT,
        ).filter(
            models.Q(retry_at__isnull=True) | models.Q(retry_at__lte=now)
        )
        if notification_id is not None:
            attempts = attempts.filter(notification_id=notification_id)
        return list(attempts.order_by("id").values_list("id", flat=True)[:limit])

    @staticmethod
    def enqueue_due_attempts(*, notification_id: int | None = None, limit: int = 100) -> int:
        attempt_ids = NotificationService.due_attempt_ids(notification_id=notification_id, limit=limit)
        if not attempt_ids:
            return 0
        enqueued = 0
        for attempt_id in attempt_ids:
            if NotificationService.enqueue_attempt_delivery(attempt_id):
                enqueued += 1
        return enqueued
