from __future__ import annotations

from django.conf import settings

from common.celery_compat import shared_task
from common.tasks import NonRetryableTaskError, normalize_positive_int, run_management_command


def _cleanup_limit(value: int) -> int:
    return normalize_positive_int(value, default=500, minimum=1, maximum=5000)


def _cleanup_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "CLEANUP_CHECKOUT_SESSIONS_LOCK_TTL_SECONDS", 300),
        default=300,
        minimum=60,
    )


@shared_task(
    bind=True,
    queue="ops",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
)
def cleanup_checkout_sessions_task(self, *, limit: int = 500):
    normalized_limit = _cleanup_limit(limit)
    worker = run_management_command(
        task=self,
        command_name="cleanup_checkout_sessions",
        queue="ops",
        limit=normalized_limit,
        lock_ttl=_cleanup_lock_ttl(),
    )
    return {"limit": normalized_limit, "worker": worker}
