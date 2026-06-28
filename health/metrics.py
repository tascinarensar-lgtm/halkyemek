from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from health.services import (
    CRITICAL_JOB_HEARTBEATS,
    SCHEDULER_HEARTBEAT_NAME,
    heartbeat_snapshot,
    job_heartbeat_ttls,
)
from health.models import JobHeartbeat
from notifications.models import DeliveryAttempt, Notification
from payments.models import PaymentIntent, SettlementLine
from payouts.models import Payout
from wallets.models import WalletTransaction


def _count(qs) -> int:
    return qs.count()


def _job_recent(job_name: str, ttl_seconds: int) -> int:
    return int(heartbeat_snapshot(job_name, ttl_seconds)["ok"])


def build_metrics_text() -> str:
    now = timezone.now()
    lines: list[str] = []

    lines.append("# HELP halkyemek_release_info Build/release metadata")
    lines.append("# TYPE halkyemek_release_info gauge")
    lines.append(
        'halkyemek_release_info{env="%s",release="%s"} 1'
        % (getattr(settings, "APP_ENV", "unknown"), getattr(settings, "RELEASE_VERSION", "unknown"))
    )

    lines.append("# HELP halkyemek_payment_intents_total Total payment intents")
    lines.append("# TYPE halkyemek_payment_intents_total gauge")
    lines.append(f"halkyemek_payment_intents_total {_count(PaymentIntent.objects.all())}")

    lines.append("# HELP halkyemek_payment_intents_settled_total Settled payment intents")
    lines.append("# TYPE halkyemek_payment_intents_settled_total gauge")
    lines.append(f"halkyemek_payment_intents_settled_total {_count(PaymentIntent.objects.filter(is_settled=True))}")

    lines.append("# HELP halkyemek_payouts_total Total payouts")
    lines.append("# TYPE halkyemek_payouts_total gauge")
    lines.append(f"halkyemek_payouts_total {_count(Payout.objects.all())}")
    for status in ["CREATED", "DISPATCHING", "SENT", "CONFIRMED", "FAILED"]:
        value = _count(Payout.objects.filter(status=status))
        lines.append(f'halkyemek_payouts_by_status{{status="{status}"}} {value}')

    lines.append("# HELP halkyemek_notifications_total Total notifications")
    lines.append("# TYPE halkyemek_notifications_total gauge")
    lines.append(f"halkyemek_notifications_total {_count(Notification.objects.all())}")
    for status in ["PENDING", "SENT", "FAILED", "CANCELLED"]:
        value = _count(Notification.objects.filter(status=status))
        lines.append(f'halkyemek_notifications_by_status{{status="{status}"}} {value}')

    for status in ["PENDING", "SENT", "FAILED"]:
        value = _count(DeliveryAttempt.objects.filter(status=status))
        lines.append(f'halkyemek_delivery_attempts_by_status{{status="{status}"}} {value}')

    retry_due = _count(
        DeliveryAttempt.objects.filter(
            status="FAILED",
            retry_at__isnull=False,
            retry_at__lte=now,
        )
    )
    lines.append(f"halkyemek_delivery_retry_due_total {retry_due}")
    lines.append(f"halkyemek_settlement_lines_total {_count(SettlementLine.objects.all())}")
    lines.append(f"halkyemek_wallet_transactions_total {_count(WalletTransaction.objects.all())}")

    lines.append("# HELP halkyemek_runtime_check_ok Runtime core check status")
    lines.append("# TYPE halkyemek_runtime_check_ok gauge")
    from health.views import _runtime_core_checks

    for check_name, check_ok in _runtime_core_checks(include_active_checks=False).items():
        lines.append(f'halkyemek_runtime_check_ok{{check="{check_name}"}} {int(check_ok)}')

    job_ttls = job_heartbeat_ttls()
    for job_name in [*CRITICAL_JOB_HEARTBEATS, SCHEDULER_HEARTBEAT_NAME]:
        snapshot = heartbeat_snapshot(job_name, job_ttls[job_name])
        recent = int(snapshot["ok"])
        age_seconds = snapshot["age_seconds"] if snapshot["age_seconds"] is not None else -1
        lines.append(f'halkyemek_job_heartbeat_recent{{job="{job_name}"}} {recent}')
        lines.append(f'halkyemek_job_heartbeat_age_seconds{{job="{job_name}"}} {age_seconds}')
        lines.append(f'halkyemek_job_heartbeat_ttl_seconds{{job="{job_name}"}} {int(snapshot["ttl_seconds"])}')

    return "\n".join(lines) + "\n"
