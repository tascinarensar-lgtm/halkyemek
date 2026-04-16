from __future__ import annotations

from django.conf import settings

from common.celery_compat import shared_task
from common.tasks import NonRetryableTaskError, normalize_positive_int, run_management_command
from payments.models import SettlementImport
from payments.services_ingestion import execute_settlement_import


def _reprocess_limit(value: int) -> int:
    return normalize_positive_int(value, default=100, minimum=1, maximum=2000)


def _import_pending_limit(value: int) -> int:
    return normalize_positive_int(value, default=20, minimum=1, maximum=500)


def _anomaly_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "REPORT_FINANCIAL_ANOMALIES_LOCK_TTL_SECONDS", 3600),
        default=3600,
        minimum=300,
    )


def _reprocess_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "SETTLEMENT_REPROCESS_LOCK_TTL_SECONDS", 900),
        default=900,
        minimum=120,
    )


def _import_pending_lock_ttl() -> int:
    return normalize_positive_int(
        getattr(settings, "IMPORT_PENDING_SETTLEMENT_FILES_LOCK_TTL_SECONDS", 900),
        default=900,
        minimum=120,
    )


@shared_task(
    bind=True,
    queue="ops_heavy",
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=900,
    retry_jitter=True,
    max_retries=2,
)
def report_financial_anomalies_task(self):
    worker = run_management_command(
        task=self,
        command_name="report_financial_anomalies",
        queue="ops_heavy",
        lock_ttl=_anomaly_lock_ttl(),
    )
    return {"job": "report_financial_anomalies", "worker": worker}


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
def reprocess_unmatched_settlement_records_task(self, *, limit: int = 100):
    normalized_limit = _reprocess_limit(limit)
    worker = run_management_command(
        task=self,
        command_name="reprocess_unmatched_settlement_records",
        queue="finance",
        limit=normalized_limit,
        lock_ttl=_reprocess_lock_ttl(),
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
def import_pending_settlement_files_task(self, *, limit: int = 20):
    normalized_limit = _import_pending_limit(limit)
    worker = run_management_command(
        task=self,
        command_name="import_pending_settlement_files",
        queue="finance",
        limit=normalized_limit,
        lock_ttl=_import_pending_lock_ttl(),
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
    max_retries=2,
)
def process_settlement_import_task(self, *, import_id: int):
    settlement_import = SettlementImport.objects.get(pk=import_id)
    summary = execute_settlement_import(settlement_import)
    return {"import_id": int(import_id), **summary.__dict__}
