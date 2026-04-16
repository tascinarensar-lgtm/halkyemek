from __future__ import annotations

from django.conf import settings

from common.celery_compat import shared_task
from common.tasks import NonRetryableTaskError, normalize_positive_int, run_management_command


def _batch_business_limit(value: int | None) -> int | None:
    if value is None:
        return None
    return normalize_positive_int(value, default=100, minimum=1, maximum=2000)


def _payout_dispatch_limit(value: int) -> int:
    return normalize_positive_int(value, default=50, minimum=1, maximum=1000)


def _payout_sync_limit(value: int) -> int:
    return normalize_positive_int(value, default=50, minimum=1, maximum=1000)


def _eligibility_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "RUN_PAYOUT_ELIGIBILITY_LOCK_TTL_SECONDS", 3600),
        default=3600,
        minimum=120,
    )


def _batch_create_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "CREATE_PAYOUT_BATCH_LOCK_TTL_SECONDS", 900),
        default=900,
        minimum=120,
    )


def _dispatch_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "DISPATCH_DUE_PAYOUTS_LOCK_TTL_SECONDS", 300),
        default=300,
        minimum=60,
    )


def _sync_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "SYNC_SENT_PAYOUT_STATUSES_LOCK_TTL_SECONDS", 300),
        default=300,
        minimum=60,
    )


def _integrity_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "VERIFY_FINANCIAL_INTEGRITY_LOCK_TTL_SECONDS", 7200),
        default=7200,
        minimum=600,
    )


@shared_task(
    bind=True,
    queue="finance",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    max_retries=3,
)
def run_payout_eligibility_task(self):
    worker = run_management_command(
        task=self,
        command_name="run_payout_eligibility",
        queue="finance",
        lock_ttl=_eligibility_lock_ttl(),
    )
    return {"job": "run_payout_eligibility", "worker": worker}


@shared_task(
    bind=True,
    queue="finance",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    max_retries=3,
)
def create_payout_batch_task(self, *, max_businesses: int | None = None):
    normalized_max_businesses = _batch_business_limit(max_businesses)
    worker = run_management_command(
        task=self,
        command_name="create_payout_batch",
        queue="finance",
        max_businesses=normalized_max_businesses,
        lock_ttl=_batch_create_lock_ttl(),
    )
    return {"job": "create_payout_batch", "worker": worker, "max_businesses": normalized_max_businesses}


@shared_task(
    bind=True,
    queue="finance",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    max_retries=3,
)
def dispatch_due_payouts_task(self, *, limit: int = 50):
    normalized_limit = _payout_dispatch_limit(limit)
    worker = run_management_command(
        task=self,
        command_name="dispatch_due_payouts",
        queue="finance",
        limit=normalized_limit,
        lock_ttl=_dispatch_lock_ttl(),
    )
    return {"limit": normalized_limit, "worker": worker}


@shared_task(
    bind=True,
    queue="finance",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    max_retries=3,
)
def sync_sent_payout_statuses_task(self, *, limit: int = 50):
    normalized_limit = _payout_sync_limit(limit)
    worker = run_management_command(
        task=self,
        command_name="sync_sent_payout_statuses",
        queue="finance",
        limit=normalized_limit,
        lock_ttl=_sync_lock_ttl(),
    )
    return {"limit": normalized_limit, "worker": worker}


@shared_task(
    bind=True,
    queue="ops_heavy",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=1800,
    retry_jitter=True,
    max_retries=2,
)
def verify_financial_integrity_task(self):
    worker = run_management_command(
        task=self,
        command_name="verify_financial_integrity",
        queue="ops_heavy",
        lock_ttl=_integrity_lock_ttl(),
    )
    return {"job": "verify_financial_integrity", "worker": worker}
