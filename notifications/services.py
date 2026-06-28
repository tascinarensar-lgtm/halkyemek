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
import hashlib
import logging
import threading
import uuid
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.core.mail import send_mail
from django.contrib.auth import get_user_model
from django.db import close_old_connections, transaction, models
from django.db.models import DateTimeField, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone

from notifications.models import DeliveryAttempt, Device, EmailDeliveryAttempt, Notification
from orders.models import Order

User = get_user_model()
logger = logging.getLogger(__name__)

EMAIL_BROADCAST_AUDIENCE_ALL = "ALL"
EMAIL_BROADCAST_AUDIENCE_CUSTOMERS = "CUSTOMERS"
EMAIL_BROADCAST_AUDIENCE_BUSINESS_MEMBERS = "BUSINESS_MEMBERS"
BROADCAST_AUDIENCE_ALL = "ALL"
BROADCAST_AUDIENCE_CUSTOMERS = "CUSTOMERS"
BROADCAST_AUDIENCE_BUSINESS_MEMBERS = "BUSINESS_MEMBERS"


class BroadcastQueueUnavailable(RuntimeError):
    """Raised when the broadcast task cannot be handed to Celery quickly."""


def _admin_broadcast_local_fallback_enabled() -> bool:
    return bool(getattr(settings, "ADMIN_BROADCAST_LOCAL_FALLBACK_ENABLED", False))


def _admin_broadcast_local_drain_limit() -> int:
    raw = int(getattr(settings, "ADMIN_BROADCAST_LOCAL_FALLBACK_DRAIN_LIMIT", 100) or 100)
    return max(min(raw, 1000), 1)


def _admin_broadcast_broker_ping_timeout_seconds() -> float:
    raw = float(getattr(settings, "ADMIN_BROADCAST_BROKER_PING_TIMEOUT_SECONDS", 0.75) or 0.75)
    return max(min(raw, 5.0), 0.1)


def _celery_broker_is_available_for_broadcast() -> bool:
    if bool(getattr(settings, "TESTING", False)) or bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False)):
        return True

    broker_url = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
    parsed = urlparse(broker_url)
    if parsed.scheme not in {"redis", "rediss"}:
        return True

    try:
        import redis

        timeout = _admin_broadcast_broker_ping_timeout_seconds()
        client = redis.Redis.from_url(
            broker_url,
            socket_connect_timeout=timeout,
            socket_timeout=timeout,
            retry_on_timeout=False,
        )
        return bool(client.ping())
    except Exception as exc:
        logger.warning("broadcast.broker_unhealthy", extra={"broker_scheme": parsed.scheme, "error": str(exc)})
        return False


def _is_permanent_fcm_token_error(error_message: str, response_payload: dict | None = None) -> bool:
    text = f"{error_message} {response_payload or {}}".lower()
    permanent_markers = (
        "registration token is not a valid fcm registration token",
        "requested entity was not found",
        "unregistered",
        "registration-token-not-registered",
        "invalid registration token",
    )
    return any(marker in text for marker in permanent_markers)


def _drain_due_notification_attempts_locally(*, broadcast_id: str = "", limit: int | None = None) -> dict[str, int]:
    limit = max(min(int(limit or _admin_broadcast_local_drain_limit()), 1000), 1)
    push_attempts = 0
    email_attempts = 0
    notification_ids: list[int] | None = None
    if broadcast_id:
        notification_ids = list(
            Notification.objects
            .filter(payload__broadcast_id=str(broadcast_id))
            .order_by("id")
            .values_list("id", flat=True)[:limit]
        )

    push_ids: list[int] = []
    email_ids: list[int] = []
    if notification_ids is None:
        push_ids = NotificationService.due_attempt_ids(limit=limit)
        email_ids = NotificationService.due_email_attempt_ids(limit=limit)
    else:
        for notification_id in notification_ids:
            remaining_push = max(limit - len(push_ids), 0)
            remaining_email = max(limit - len(email_ids), 0)
            if remaining_push > 0:
                push_ids.extend(NotificationService.due_attempt_ids(notification_id=notification_id, limit=remaining_push))
            if remaining_email > 0:
                email_ids.extend(NotificationService.due_email_attempt_ids(notification_id=notification_id, limit=remaining_email))
            if len(push_ids) >= limit and len(email_ids) >= limit:
                break

    for attempt_id in push_ids:
        try:
            NotificationService.send_attempt(attempt_id)
            push_attempts += 1
        except Exception:
            logger.exception("broadcast.local_fallback_push_attempt_failed", extra={"attempt_id": int(attempt_id)})

    for attempt_id in email_ids:
        try:
            NotificationService.send_email_attempt(attempt_id)
            email_attempts += 1
        except Exception:
            logger.exception("broadcast.local_fallback_email_attempt_failed", extra={"email_attempt_id": int(attempt_id)})

    return {"push_attempts": push_attempts, "email_attempts": email_attempts}


def _start_admin_broadcast_local_fallback(*, name: str, broadcast_id: str, target, kwargs: dict) -> str:
    task_id = f"local-{broadcast_id}"

    def _runner() -> None:
        close_old_connections()
        try:
            logger.warning(
                "broadcast.local_fallback_started",
                extra={"fallback_name": name, "broadcast_id": broadcast_id, "task_id": task_id},
            )
            result = target(**kwargs)
            drained = _drain_due_notification_attempts_locally(broadcast_id=broadcast_id)
            logger.warning(
                "broadcast.local_fallback_completed",
                extra={
                    "fallback_name": name,
                    "broadcast_id": broadcast_id,
                    "task_id": task_id,
                    "result": result,
                    "drained": drained,
                },
            )
        except Exception:
            logger.exception(
                "broadcast.local_fallback_failed",
                extra={"fallback_name": name, "broadcast_id": broadcast_id, "task_id": task_id},
            )
        finally:
            close_old_connections()

    threading.Thread(target=_runner, name=f"halkyemek-{name}-{broadcast_id[:8]}", daemon=True).start()
    return task_id


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
    def _email_attempt_enqueue_key(attempt_id: int) -> str:
        return f"notifications:email-attempt-enqueued:{int(attempt_id)}"

    @staticmethod
    def _send_attempt_lock_key(attempt_id: int) -> str:
        return f"notifications:attempt-send-lock:{int(attempt_id)}"

    @staticmethod
    def _send_email_attempt_lock_key(attempt_id: int) -> str:
        return f"notifications:email-attempt-send-lock:{int(attempt_id)}"

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
    def enqueue_email_attempt_delivery(attempt_id: int) -> bool:
        key = NotificationService._email_attempt_enqueue_key(attempt_id)
        ttl = NotificationService._enqueue_dedupe_ttl_seconds()
        if not cache.add(key, 1, timeout=ttl):
            return False

        from notifications.tasks import send_notification_email_attempt_task

        try:
            send_notification_email_attempt_task.delay(int(attempt_id))
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
    def _email_notifications_enabled() -> bool:
        return bool(getattr(settings, "EMAIL_NOTIFICATIONS_ENABLED", False))

    @staticmethod
    def _email_recipient_for_user(user) -> str:
        google_email = str(getattr(user, "google_email", "") or "").strip()
        google_verified = bool(getattr(user, "google_email_verified", False))
        require_verified = bool(getattr(settings, "NOTIFICATION_EMAIL_REQUIRE_VERIFIED_GOOGLE", True))
        if google_email and (google_verified or not require_verified):
            return google_email
        return ""

    @staticmethod
    def _create_email_attempt(*, notification: Notification, user) -> None:
        if not NotificationService._email_notifications_enabled():
            return
        email_to = NotificationService._email_recipient_for_user(user)
        if not email_to:
            return
        EmailDeliveryAttempt.objects.create(
            notification=notification,
            email_to=email_to,
            status=EmailDeliveryAttempt.Status.PENDING,
        )

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
        channels: tuple[str, ...] | None = None,
        schedule_delivery: bool = True,
    ) -> Notification: # model dönecek
        dedupe_key = (dedupe_key or "").strip()
        channels = channels or ("push", "email")
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
            if "push" in channels:
                NotificationService._create_delivery_attempts(notification=notif, user=user)
            if "email" in channels:
                NotificationService._create_email_attempt(notification=notif, user=user)
            if schedule_delivery:
                NotificationService._schedule_notification_delivery(notification_id=int(getattr(notif, "pk")))
            return notif

        notif, created = Notification.objects.get_or_create(
            user=user,
            dedupe_key=dedupe_key,
            defaults=notification_defaults,
        )
        if created:
            if "push" in channels:
                NotificationService._create_delivery_attempts(notification=notif, user=user)
            if "email" in channels:
                NotificationService._create_email_attempt(notification=notif, user=user)
            if schedule_delivery:
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
        email_attempts = EmailDeliveryAttempt.objects.filter(notification_id=int(getattr(notification, "pk")))
        if not attempts.exists() and not email_attempts.exists():
            return notification

        if (
            attempts.filter(status=DeliveryAttempt.Status.SENT).exists()
            or email_attempts.filter(status=EmailDeliveryAttempt.Status.SENT).exists()
        ):
            status = Notification.Status.SENT
            sent_at = (
                attempts.filter(status=DeliveryAttempt.Status.SENT).order_by("-sent_at").values_list("sent_at", flat=True).first()
                or email_attempts.filter(status=EmailDeliveryAttempt.Status.SENT).order_by("-sent_at").values_list("sent_at", flat=True).first()
                or timezone.now()
            )
        elif (
            attempts.filter(retry_count__lt=NotificationService.MAX_RETRY_COUNT).filter(
                models.Q(status=DeliveryAttempt.Status.PENDING) |
                (models.Q(status=DeliveryAttempt.Status.FAILED) & (models.Q(retry_at__isnull=True) | models.Q(retry_at__gte=timezone.now())))
            ).exists()
            or email_attempts.filter(retry_count__lt=NotificationService.MAX_RETRY_COUNT).filter(
                models.Q(status=EmailDeliveryAttempt.Status.PENDING) |
                (models.Q(status=EmailDeliveryAttempt.Status.FAILED) & (models.Q(retry_at__isnull=True) | models.Q(retry_at__gte=timezone.now())))
            ).exists()
        ):
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
                    attempt.status = DeliveryAttempt.Status.FAILED
                    attempt.error = str(exc)
                    attempt.response_payload = getattr(exc, "response_payload", {}) or {}
                    permanent_token_error = _is_permanent_fcm_token_error(attempt.error, attempt.response_payload)
                    if permanent_token_error:
                        attempt.retry_count = NotificationService.MAX_RETRY_COUNT
                        attempt.retry_at = None
                    else:
                        if int(attempt.retry_count) < NotificationService.MAX_RETRY_COUNT:
                            attempt.retry_count += 1
                        backoff_minutes = min(60, 2 ** min(int(attempt.retry_count), 5))
                        attempt.retry_at = (
                            timezone.now() + timedelta(minutes=backoff_minutes)
                            if int(attempt.retry_count) < NotificationService.MAX_RETRY_COUNT
                            else None
                        )
                    attempt.save(update_fields=["retry_count", "status", "error", "retry_at", "response_payload"])

                    attempt.device.failure_count += 1
                    attempt.device.last_error = str(exc)
                    if permanent_token_error:
                        attempt.device.is_active = False
                        attempt.device.last_error = f"auto-disabled-invalid-token: {exc}"
                        attempt.device.save(update_fields=["failure_count", "last_error", "is_active"])
                    elif attempt.device.failure_count >= NotificationService.AUTO_DISABLE_DEVICE_FAILURE_COUNT:
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
    def _build_email_body(*, notification: Notification) -> str:
        lines = [
            notification.body,
            "",
            "HalkYemek hesabınızda yeni bir bildirim oluştu.",
        ]
        payload = notification.payload or {}
        url = str(payload.get("url") or payload.get("link") or "").strip()
        if url:
            lines.extend(["", f"İlgili bağlantı: {url}"])
        lines.extend(["", "Bu e-posta, Google ile giriş yaptığınız HalkYemek hesabınıza ait bildirim tercihleriniz kapsamında gönderilmiştir."])
        return "\n".join(lines)

    @staticmethod
    def send_email_attempt(attempt_id: int) -> EmailDeliveryAttempt:
        lock_key = NotificationService._send_email_attempt_lock_key(attempt_id)
        lock_ttl = NotificationService._send_attempt_lock_ttl_seconds()
        if not cache.add(lock_key, 1, timeout=lock_ttl):
            return EmailDeliveryAttempt.objects.select_related("notification", "notification__user").get(id=attempt_id)

        attempt: EmailDeliveryAttempt
        try:
            with transaction.atomic():
                attempt = (
                    EmailDeliveryAttempt.objects
                    .select_for_update()
                    .select_related("notification", "notification__user")
                    .get(id=attempt_id)
                )

                if attempt.status == EmailDeliveryAttempt.Status.SENT:
                    return attempt

                if int(attempt.retry_count) >= NotificationService.MAX_RETRY_COUNT:
                    NotificationService._sync_notification_status(notification=attempt.notification)
                    return attempt

                now = timezone.now()
                if attempt.retry_at is not None and attempt.retry_at > now:
                    return attempt

                subject = attempt.notification.title
                body = NotificationService._build_email_body(notification=attempt.notification)
                email_to = attempt.email_to
                from_email = str(getattr(settings, "NOTIFICATION_EMAIL_FROM", "") or getattr(settings, "DEFAULT_FROM_EMAIL", "") or "").strip()

            try:
                send_mail(
                    subject=subject,
                    message=body,
                    from_email=from_email,
                    recipient_list=[email_to],
                    fail_silently=False,
                )
            except Exception as exc:
                with transaction.atomic():
                    attempt = (
                        EmailDeliveryAttempt.objects
                        .select_for_update()
                        .select_related("notification", "notification__user")
                        .get(id=attempt_id)
                    )
                    if attempt.status == EmailDeliveryAttempt.Status.SENT:
                        return attempt
                    if int(attempt.retry_count) < NotificationService.MAX_RETRY_COUNT:
                        attempt.retry_count += 1
                    backoff_minutes = min(60, 2 ** min(int(attempt.retry_count), 5))
                    attempt.status = EmailDeliveryAttempt.Status.FAILED
                    attempt.error = str(exc)
                    attempt.retry_at = (
                        timezone.now() + timedelta(minutes=backoff_minutes)
                        if int(attempt.retry_count) < NotificationService.MAX_RETRY_COUNT
                        else None
                    )
                    attempt.save(update_fields=["retry_count", "status", "error", "retry_at"])
                    NotificationService._sync_notification_status(notification=attempt.notification)
                    return attempt

            with transaction.atomic():
                attempt = (
                    EmailDeliveryAttempt.objects
                    .select_for_update()
                    .select_related("notification", "notification__user")
                    .get(id=attempt_id)
                )
                if attempt.status == EmailDeliveryAttempt.Status.SENT:
                    return attempt

                attempt.status = EmailDeliveryAttempt.Status.SENT
                attempt.sent_at = timezone.now()
                attempt.error = ""
                attempt.retry_at = None
                attempt.save(update_fields=["status", "sent_at", "error", "retry_at"])
                NotificationService._sync_notification_status(notification=attempt.notification)
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
    def due_email_attempt_ids(*, notification_id: int | None = None, limit: int = 100) -> list[int]:
        now = timezone.now()
        attempts = EmailDeliveryAttempt.objects.filter(
            status__in=[EmailDeliveryAttempt.Status.PENDING, EmailDeliveryAttempt.Status.FAILED],
            retry_count__lt=NotificationService.MAX_RETRY_COUNT,
        ).filter(
            models.Q(retry_at__isnull=True) | models.Q(retry_at__lte=now)
        )
        if notification_id is not None:
            attempts = attempts.filter(notification_id=notification_id)
        return list(attempts.order_by("id").values_list("id", flat=True)[:limit])

    @staticmethod
    def enqueue_due_attempts(*, notification_id: int | None = None, limit: int = 100) -> int:
        enqueued = 0
        for attempt_id in NotificationService.due_attempt_ids(notification_id=notification_id, limit=limit):
            if NotificationService.enqueue_attempt_delivery(attempt_id):
                enqueued += 1
        for attempt_id in NotificationService.due_email_attempt_ids(notification_id=notification_id, limit=limit):
            if NotificationService.enqueue_email_attempt_delivery(attempt_id):
                enqueued += 1
        return enqueued


class SystemBroadcastService:
    DEFAULT_BATCH_SIZE = 100

    @staticmethod
    def _batch_size(value: int | None = None) -> int:
        configured = int(getattr(settings, "ADMIN_SYSTEM_BROADCAST_BATCH_SIZE", SystemBroadcastService.DEFAULT_BATCH_SIZE) or SystemBroadcastService.DEFAULT_BATCH_SIZE)
        size = int(value or configured or SystemBroadcastService.DEFAULT_BATCH_SIZE)
        return max(min(size, 1000), 1)

    @staticmethod
    def _broadcast_id(idempotency_key: str = "") -> str:
        key = str(idempotency_key or "").strip()
        if key:
            return uuid.uuid5(uuid.NAMESPACE_URL, f"halkyemek:system-broadcast:{key}").hex
        return uuid.uuid4().hex

    @staticmethod
    def eligible_recipients(*, audience: str = BROADCAST_AUDIENCE_ALL, district: str = ""):
        audience = str(audience or BROADCAST_AUDIENCE_ALL).strip().upper()
        district = str(district or "").strip()
        users = User.objects.filter(
            is_active=True,
            devices__is_active=True,
            devices__permission_granted=True,
        ).distinct()

        if audience == BROADCAST_AUDIENCE_CUSTOMERS:
            users = users.filter(role=User.Role.CUSTOMER)
        elif audience == BROADCAST_AUDIENCE_BUSINESS_MEMBERS:
            users = users.filter(business_memberships__is_active=True).distinct()

        if district:
            users = users.filter(
                business_memberships__is_active=True,
                business_memberships__business__district=district,
            ).distinct()

        return users.order_by("id")

    @staticmethod
    def estimate_recipients(*, audience: str = BROADCAST_AUDIENCE_ALL, district: str = "") -> int:
        return int(SystemBroadcastService.eligible_recipients(audience=audience, district=district).count())

    @staticmethod
    def prepare_broadcast(
        *,
        title: str,
        body: str,
        payload: dict | None = None,
        audience: str = BROADCAST_AUDIENCE_ALL,
        district: str = "",
        idempotency_key: str = "",
    ) -> dict:
        broadcast_id = SystemBroadcastService._broadcast_id(idempotency_key)
        estimated_count = SystemBroadcastService.estimate_recipients(audience=audience, district=district)
        logger.info(
            "system_broadcast.prepare_started",
            extra={
                "broadcast_id": broadcast_id,
                "estimated_count": estimated_count,
                "audience": audience,
                "district": district,
            },
        )
        result = {
            "broadcast_id": broadcast_id,
            "queued": estimated_count,
            "estimated_count": estimated_count,
            "task_id": "",
            "queued_async": True,
        }

        if not _celery_broker_is_available_for_broadcast():
            if _admin_broadcast_local_fallback_enabled():
                result["task_id"] = _start_admin_broadcast_local_fallback(
                    name="system-broadcast",
                    broadcast_id=broadcast_id,
                    target=SystemBroadcastService.process_broadcast,
                    kwargs={
                        "broadcast_id": broadcast_id,
                        "title": title,
                        "body": body,
                        "payload": payload or {},
                        "audience": audience,
                        "district": district,
                        "batch_size": SystemBroadcastService._batch_size(),
                    },
                )
                logger.warning(
                    "system_broadcast.local_fallback_queued",
                    extra={
                        "broadcast_id": broadcast_id,
                        "estimated_count": estimated_count,
                        "task_id": result["task_id"],
                        "reason": "broker_unhealthy",
                    },
                )
                return result
            raise BroadcastQueueUnavailable("system_broadcast_queue_unavailable")

        from notifications.tasks import send_admin_system_broadcast_task

        try:
            task = send_admin_system_broadcast_task.delay(
                broadcast_id=broadcast_id,
                title=title,
                body=body,
                payload=payload or {},
                audience=audience,
                district=district,
                batch_size=SystemBroadcastService._batch_size(),
            )
            result["task_id"] = str(getattr(task, "id", "") or "")
            logger.info(
                "system_broadcast.task_queued",
                extra={
                    "broadcast_id": broadcast_id,
                    "estimated_count": estimated_count,
                    "task_id": result["task_id"],
                },
            )
            return result
        except Exception as exc:
            if _admin_broadcast_local_fallback_enabled():
                result["task_id"] = _start_admin_broadcast_local_fallback(
                    name="system-broadcast",
                    broadcast_id=broadcast_id,
                    target=SystemBroadcastService.process_broadcast,
                    kwargs={
                        "broadcast_id": broadcast_id,
                        "title": title,
                        "body": body,
                        "payload": payload or {},
                        "audience": audience,
                        "district": district,
                        "batch_size": SystemBroadcastService._batch_size(),
                    },
                )
                result["queued_async"] = True
                logger.warning(
                    "system_broadcast.local_fallback_queued",
                    extra={
                        "broadcast_id": broadcast_id,
                        "estimated_count": estimated_count,
                        "task_id": result["task_id"],
                    },
                )
                return result
            logger.exception(
                "system_broadcast.queue_unavailable",
                exc_info=True,
                extra={"broadcast_id": broadcast_id, "estimated_count": estimated_count},
            )
            raise BroadcastQueueUnavailable("system_broadcast_queue_unavailable") from exc

    @staticmethod
    def process_broadcast(
        *,
        broadcast_id: str,
        title: str,
        body: str,
        payload: dict | None = None,
        audience: str = BROADCAST_AUDIENCE_ALL,
        district: str = "",
        batch_size: int | None = None,
    ) -> dict:
        batch_size = SystemBroadcastService._batch_size(batch_size)
        queryset = SystemBroadcastService.eligible_recipients(audience=audience, district=district)
        attempted = 0
        queued = 0
        skipped_duplicate = 0

        for user in queryset.iterator(chunk_size=batch_size):
            attempted += 1
            dedupe_key = f"system-broadcast:{broadcast_id}:{int(user.pk)}"
            already_exists = Notification.objects.filter(user=user, dedupe_key=dedupe_key).exists()
            try:
                NotificationService.enqueue(
                    user=user,
                    type=Notification.Type.SYSTEM_BROADCAST,
                    title=title,
                    body=body,
                    payload={**(payload or {}), "broadcast_id": broadcast_id, "channel": "push", "audience": audience, "district": district},
                    dedupe_key=dedupe_key,
                    channels=("push",),
                    schedule_delivery=False,
                )
            except Exception:
                logger.exception(
                    "system_broadcast.enqueue_failed",
                    extra={"broadcast_id": broadcast_id, "user_id": int(user.pk)},
                )
                continue

            if already_exists:
                skipped_duplicate += 1
            else:
                queued += 1

        result = {
            "broadcast_id": broadcast_id,
            "attempted": attempted,
            "queued": queued,
            "skipped_duplicate": skipped_duplicate,
        }
        logger.info("system_broadcast.completed", extra=result)
        return result


class EmailBroadcastService:
    DEFAULT_BATCH_SIZE = 100

    @staticmethod
    def _enabled() -> bool:
        return bool(getattr(settings, "ADMIN_EMAIL_BROADCAST_ENABLED", True))

    @staticmethod
    def _batch_size(value: int | None = None) -> int:
        configured = int(getattr(settings, "ADMIN_EMAIL_BROADCAST_BATCH_SIZE", EmailBroadcastService.DEFAULT_BATCH_SIZE) or EmailBroadcastService.DEFAULT_BATCH_SIZE)
        size = int(value or configured or EmailBroadcastService.DEFAULT_BATCH_SIZE)
        return max(min(size, 1000), 1)

    @staticmethod
    def _broadcast_id(idempotency_key: str = "") -> str:
        key = str(idempotency_key or "").strip()
        if key:
            return uuid.uuid5(uuid.NAMESPACE_URL, f"halkyemek:email-broadcast:{key}").hex
        return uuid.uuid4().hex

    @staticmethod
    def _subject_hash(subject: str) -> str:
        return hashlib.sha256(str(subject or "").encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def eligible_recipients(*, audience: str = EMAIL_BROADCAST_AUDIENCE_ALL, district: str = ""):
        audience = str(audience or EMAIL_BROADCAST_AUDIENCE_ALL).strip().upper()
        district = str(district or "").strip()
        users = User.objects.filter(
            is_active=True,
            google_email__gt="",
            google_email_verified=True,
        )

        if audience == EMAIL_BROADCAST_AUDIENCE_CUSTOMERS:
            users = users.filter(role=User.Role.CUSTOMER)
        elif audience == EMAIL_BROADCAST_AUDIENCE_BUSINESS_MEMBERS:
            users = users.filter(business_memberships__is_active=True).distinct()

        if district:
            users = users.filter(
                business_memberships__is_active=True,
                business_memberships__business__district=district,
            ).distinct()

        return users.order_by("id")

    @staticmethod
    def estimate_recipients(*, audience: str = EMAIL_BROADCAST_AUDIENCE_ALL, district: str = "") -> int:
        return int(EmailBroadcastService.eligible_recipients(audience=audience, district=district).count())

    @staticmethod
    def prepare_broadcast(
        *,
        subject: str,
        message: str,
        audience: str = EMAIL_BROADCAST_AUDIENCE_ALL,
        district: str = "",
        dry_run: bool = True,
        idempotency_key: str = "",
    ) -> dict:
        broadcast_id = EmailBroadcastService._broadcast_id(idempotency_key)
        estimated_count = EmailBroadcastService.estimate_recipients(audience=audience, district=district)
        result = {
            "broadcast_id": broadcast_id,
            "estimated_count": estimated_count,
            "dry_run": bool(dry_run),
            "task_id": "",
            "subject_hash": EmailBroadcastService._subject_hash(subject),
        }

        logger.info(
            "email_broadcast.prepared",
            extra={
                "broadcast_id": broadcast_id,
                "estimated_count": estimated_count,
                "audience": audience,
                "district": district,
                "dry_run": bool(dry_run),
                "subject_hash": result["subject_hash"],
            },
        )

        if dry_run:
            return result

        if not EmailBroadcastService._enabled():
            raise ValueError("admin_email_broadcast_disabled")

        if not _celery_broker_is_available_for_broadcast():
            if _admin_broadcast_local_fallback_enabled():
                result["task_id"] = _start_admin_broadcast_local_fallback(
                    name="email-broadcast",
                    broadcast_id=broadcast_id,
                    target=EmailBroadcastService.process_broadcast,
                    kwargs={
                        "broadcast_id": broadcast_id,
                        "subject": subject,
                        "message": message,
                        "audience": audience,
                        "district": district,
                        "batch_size": EmailBroadcastService._batch_size(),
                    },
                )
                logger.warning(
                    "email_broadcast.local_fallback_queued",
                    extra={
                        "broadcast_id": broadcast_id,
                        "estimated_count": estimated_count,
                        "task_id": result["task_id"],
                        "subject_hash": result["subject_hash"],
                        "reason": "broker_unhealthy",
                    },
                )
                return result
            raise BroadcastQueueUnavailable("email_broadcast_queue_unavailable")

        from notifications.tasks import send_admin_email_broadcast_task

        try:
            task = send_admin_email_broadcast_task.delay(
                broadcast_id=broadcast_id,
                subject=subject,
                message=message,
                audience=audience,
                district=district,
                batch_size=EmailBroadcastService._batch_size(),
            )
            result["task_id"] = str(getattr(task, "id", "") or "")
            logger.info(
                "email_broadcast.task_queued",
                extra={
                    "broadcast_id": broadcast_id,
                    "estimated_count": estimated_count,
                    "task_id": result["task_id"],
                    "subject_hash": result["subject_hash"],
                },
            )
        except Exception as exc:
            if _admin_broadcast_local_fallback_enabled():
                result["task_id"] = _start_admin_broadcast_local_fallback(
                    name="email-broadcast",
                    broadcast_id=broadcast_id,
                    target=EmailBroadcastService.process_broadcast,
                    kwargs={
                        "broadcast_id": broadcast_id,
                        "subject": subject,
                        "message": message,
                        "audience": audience,
                        "district": district,
                        "batch_size": EmailBroadcastService._batch_size(),
                    },
                )
                logger.warning(
                    "email_broadcast.local_fallback_queued",
                    extra={
                        "broadcast_id": broadcast_id,
                        "estimated_count": estimated_count,
                        "task_id": result["task_id"],
                        "subject_hash": result["subject_hash"],
                    },
                )
                return result
            logger.exception(
                "email_broadcast.queue_unavailable",
                exc_info=True,
                extra={"broadcast_id": broadcast_id, "estimated_count": estimated_count},
            )
            raise BroadcastQueueUnavailable("email_broadcast_queue_unavailable") from exc
        return result

    @staticmethod
    def process_broadcast(
        *,
        broadcast_id: str,
        subject: str,
        message: str,
        audience: str = EMAIL_BROADCAST_AUDIENCE_ALL,
        district: str = "",
        batch_size: int | None = None,
    ) -> dict:
        batch_size = EmailBroadcastService._batch_size(batch_size)
        queryset = EmailBroadcastService.eligible_recipients(audience=audience, district=district)
        attempted = 0
        queued = 0
        skipped_duplicate = 0

        for user in queryset.iterator(chunk_size=batch_size):
            attempted += 1
            dedupe_key = f"email-broadcast:{broadcast_id}:{int(user.pk)}"
            already_exists = Notification.objects.filter(user=user, dedupe_key=dedupe_key).exists()
            try:
                NotificationService.enqueue(
                    user=user,
                    type=Notification.Type.EMAIL_BROADCAST,
                    title=subject,
                    body=message,
                    payload={
                        "broadcast_id": broadcast_id,
                        "channel": "email",
                        "audience": audience,
                        "district": district,
                    },
                    dedupe_key=dedupe_key,
                    channels=("email",),
                    schedule_delivery=False,
                )
            except Exception:
                logger.exception(
                    "email_broadcast.enqueue_failed",
                    extra={"broadcast_id": broadcast_id, "user_id": int(user.pk)},
                )
                continue

            if already_exists:
                skipped_duplicate += 1
            else:
                queued += 1

        result = {
            "broadcast_id": broadcast_id,
            "attempted": attempted,
            "queued": queued,
            "skipped_duplicate": skipped_duplicate,
            "batch_size": batch_size,
        }
        logger.info("email_broadcast.completed", extra=result)
        return result


class UserReminderService:
    DEFAULT_BATCH_SIZE = 100

    @staticmethod
    def _interval_days() -> int:
        return max(int(getattr(settings, "USER_REMINDER_INTERVAL_DAYS", 5) or 5), 1)

    @staticmethod
    def _enabled() -> bool:
        return bool(getattr(settings, "USER_REMINDER_EMAILS_ENABLED", True))

    @staticmethod
    def _batch_size(limit: int | None = None) -> int:
        configured = int(getattr(settings, "USER_REMINDER_BATCH_SIZE", UserReminderService.DEFAULT_BATCH_SIZE) or UserReminderService.DEFAULT_BATCH_SIZE)
        value = int(limit or configured or UserReminderService.DEFAULT_BATCH_SIZE)
        return max(min(value, 1000), 1)

    @staticmethod
    def _dedupe_key(*, user_id: int, now) -> str:
        interval_seconds = UserReminderService._interval_days() * 24 * 60 * 60
        cycle = int(now.timestamp()) // interval_seconds
        return f"user-reminder:{int(user_id)}:{cycle}"

    @staticmethod
    def _reminder_payload() -> dict:
        frontend_url = str(getattr(settings, "FRONTEND_APP_URL", "") or "").rstrip("/")
        url = f"{frontend_url}/" if frontend_url else "/"
        return {
            "url": url,
            "reason": "inactive_user_reminder",
        }

    @staticmethod
    def _candidate_users(*, cutoff, limit: int):
        last_order_activity = (
            Order.objects.filter(
                user=OuterRef("pk"),
                status__in=[Order.Status.PAID, Order.Status.USED],
            )
            .annotate(
                activity_at=Coalesce(
                    "used_at",
                    "paid_at",
                    "created_at",
                    output_field=DateTimeField(),
                )
            )
            .order_by("-activity_at")
            .values("activity_at")[:1]
        )
        last_reminder = (
            Notification.objects.filter(
                user=OuterRef("pk"),
                type=Notification.Type.USER_REMINDER,
            )
            .order_by("-created_at")
            .values("created_at")[:1]
        )

        return (
            User.objects.filter(
                is_active=True,
                google_email__gt="",
                google_email_verified=True,
            )
            .annotate(
                last_order_activity_at=Subquery(last_order_activity, output_field=DateTimeField()),
                last_reminder_at=Subquery(last_reminder, output_field=DateTimeField()),
            )
            .filter(
                Q(last_order_activity_at__isnull=True) | Q(last_order_activity_at__lte=cutoff),
            )
            .filter(
                Q(last_reminder_at__isnull=True) | Q(last_reminder_at__lte=cutoff),
            )
            .order_by("id")[:limit]
        )

    @staticmethod
    def enqueue_due_reminders(*, limit: int | None = None) -> int:
        if not UserReminderService._enabled():
            logger.info("user_reminder.disabled")
            return 0

        now = timezone.now()
        interval_days = UserReminderService._interval_days()
        cutoff = now - timedelta(days=interval_days)
        batch_size = UserReminderService._batch_size(limit)
        payload = UserReminderService._reminder_payload()

        if not NotificationService._email_notifications_enabled():
            logger.warning("user_reminder.email_notifications_disabled")

        enqueued = 0
        for user in UserReminderService._candidate_users(cutoff=cutoff, limit=batch_size):
            dedupe_key = UserReminderService._dedupe_key(user_id=int(user.pk), now=now)
            try:
                notification = NotificationService.enqueue(
                    user=user,
                    type=Notification.Type.USER_REMINDER,
                    title="HalkYemek seni bekliyor",
                    body="Yeni men\u00fclere g\u00f6z atmak istersen HalkYemek hesab\u0131na d\u00f6nmeye haz\u0131r\u0131z.",
                    payload=payload,
                    dedupe_key=dedupe_key,
                )
            except Exception:
                logger.exception("user_reminder.enqueue_failed", extra={"user_id": int(user.pk)})
                continue

            if notification.dedupe_key == dedupe_key:
                enqueued += 1

        logger.info(
            "user_reminder.completed",
            extra={
                "enqueued": enqueued,
                "limit": batch_size,
                "interval_days": interval_days,
            },
        )
        return enqueued
