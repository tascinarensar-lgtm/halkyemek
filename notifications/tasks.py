from __future__ import annotations

from django.conf import settings

from common.celery_compat import shared_task
from common.tasks import NonRetryableTaskError, normalize_positive_int, run_management_command
from notifications.services import NotificationService


def _process_notifications_limit(value: int) -> int:
    return normalize_positive_int(value, default=100, minimum=1, maximum=1000)


def _process_notifications_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "PROCESS_NOTIFICATIONS_LOCK_TTL_SECONDS", 60),
        default=60,
        minimum=30,
    )


def _notification_fanout_limit(value: int) -> int:
    return normalize_positive_int(value, default=50, minimum=1, maximum=500)


@shared_task(
    bind=True,
    queue="ops",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=5,
)
def process_notifications_task(self, *, limit: int = 100):
    normalized_limit = _process_notifications_limit(limit)
    worker = run_management_command(
        task=self,
        command_name="process_notifications",
        queue="ops",
        limit=normalized_limit,
        lock_ttl=_process_notifications_lock_ttl(),
    )
    return {"limit": normalized_limit, "worker": worker}


@shared_task(
    bind=True,
    queue="notifications",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=900,
    retry_jitter=True,
    max_retries=5,
)
def send_notification_attempt_task(self, attempt_id: int):
    NotificationService.send_attempt(attempt_id)
    return {"attempt_id": attempt_id}


@shared_task(
    bind=True,
    queue="notifications",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
)
def process_notification_attempts_for_notification_task(self, notification_id: int, *, limit: int = 50):
    normalized_limit = _notification_fanout_limit(limit)
    attempt_ids = NotificationService.due_attempt_ids(notification_id=notification_id, limit=normalized_limit)
    enqueued = 0
    for attempt_id in attempt_ids:
        if NotificationService.enqueue_attempt_delivery(attempt_id):
            enqueued += 1
    return {"notification_id": notification_id, "attempt_count": enqueued, "limit": normalized_limit}
