from __future__ import annotations

from typing import Any

from django.conf import settings
from django.utils import timezone

from health.models import JobHeartbeat


SCHEDULER_HEARTBEAT_NAME = "celery_beat_scheduler"

CRITICAL_JOB_HEARTBEATS: tuple[str, ...] = (
    "process_notifications",
    "cleanup_checkout_sessions",
    "create_payout_batch",
    "dispatch_due_payouts",
    "run_payout_eligibility",
    "sync_sent_payout_statuses",
    "reprocess_unmatched_settlement_records",
    "import_pending_settlement_files",
    "verify_financial_integrity",
    "report_financial_anomalies",
)


def job_heartbeat_ttls() -> dict[str, int]:
    ttl = int(getattr(settings, "JOB_HEARTBEAT_TTL_SECONDS", 900))
    payout_batch_ttl = int(getattr(settings, "PAYOUT_BATCH_CREATE_HEARTBEAT_TTL_SECONDS", max(ttl, 2700)))
    payout_dispatch_ttl = int(getattr(settings, "PAYOUT_DISPATCH_HEARTBEAT_TTL_SECONDS", max(ttl, 1800)))
    payout_sync_ttl = int(getattr(settings, "PAYOUT_SYNC_HEARTBEAT_TTL_SECONDS", max(ttl, 1800)))
    payout_eligibility_ttl = int(getattr(settings, "PAYOUT_ELIGIBILITY_HEARTBEAT_TTL_SECONDS", max(ttl, 7200)))
    settlement_reprocess_ttl = int(getattr(settings, "SETTLEMENT_REPROCESS_HEARTBEAT_TTL_SECONDS", max(ttl, 2700)))
    settlement_import_ttl = int(getattr(settings, "SETTLEMENT_IMPORT_HEARTBEAT_TTL_SECONDS", max(ttl, 7200)))
    return {
        "process_notifications": ttl,
        "cleanup_checkout_sessions": ttl,
        "create_payout_batch": payout_batch_ttl,
        "dispatch_due_payouts": payout_dispatch_ttl,
        "run_payout_eligibility": payout_eligibility_ttl,
        "sync_sent_payout_statuses": payout_sync_ttl,
        "reprocess_unmatched_settlement_records": settlement_reprocess_ttl,
        "import_pending_settlement_files": settlement_import_ttl,
        "verify_financial_integrity": int(getattr(settings, "INTEGRITY_HEARTBEAT_TTL_SECONDS", 7200)),
        "report_financial_anomalies": int(getattr(settings, "ANOMALY_HEARTBEAT_TTL_SECONDS", 7200)),
        SCHEDULER_HEARTBEAT_NAME: int(getattr(settings, "SCHEDULER_HEARTBEAT_TTL_SECONDS", 180)),
    }


def heartbeat_snapshot(job_name: str, ttl_seconds: int) -> dict[str, Any]:
    hb = JobHeartbeat.objects.filter(job_name=job_name).first()
    now = timezone.now()
    last_success_at = getattr(hb, "last_success_at", None)
    age_seconds = None
    ok = False
    if last_success_at is not None:
        age_seconds = max(int((now - last_success_at).total_seconds()), 0)
        ok = age_seconds <= max(int(ttl_seconds), 1)
    return {
        "job_name": job_name,
        "ok": ok,
        "ttl_seconds": max(int(ttl_seconds), 1),
        "status": getattr(hb, "status", JobHeartbeat.Status.FAILED),
        "last_success_at": last_success_at.isoformat() if last_success_at else None,
        "last_failure_at": hb.last_failure_at.isoformat() if hb and hb.last_failure_at else None,
        "age_seconds": age_seconds,
        "error": getattr(hb, "error", "") or "",
        "meta": getattr(hb, "meta", None),
    }


def heartbeat_ok(job_name: str, ttl_seconds: int) -> bool:
    return bool(heartbeat_snapshot(job_name, ttl_seconds)["ok"])


class JobHeartbeatService:
    @staticmethod
    def success(job_name: str, **meta: Any) -> None:
        now = timezone.now()
        JobHeartbeat.objects.update_or_create(
            job_name=job_name,
            defaults={
                "status": JobHeartbeat.Status.SUCCESS,
                "last_success_at": now,
                "error": "",
                "meta": meta or None,
            },
        )

    @staticmethod
    def failure(job_name: str, error: str, **meta: Any) -> None:
        now = timezone.now()
        defaults = {
            "status": JobHeartbeat.Status.FAILED,
            "last_failure_at": now,
            "error": (error or "")[:5000],
            "meta": meta or None,
        }
        JobHeartbeat.objects.update_or_create(job_name=job_name, defaults=defaults)

    @staticmethod
    def scheduler_heartbeat(**meta: Any) -> None:
        JobHeartbeatService.success(SCHEDULER_HEARTBEAT_NAME, **meta)
