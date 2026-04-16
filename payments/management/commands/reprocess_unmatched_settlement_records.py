from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import models, transaction
from django.utils import timezone

from common.locks import build_job_lock_token, job_lock
from common.tasks import normalize_positive_int
from health.services import JobHeartbeatService
from payments.models import SettlementRecord
from payments.services_settlement import is_retryable_settlement_error, process_settlement_record


class Command(BaseCommand):
    help = "Retry unresolved settlement records that were previously left for manual review or arrived before local entities existed."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=600)

    @staticmethod
    def _retry_policy() -> tuple[int, int, int]:
        max_attempts = max(int(getattr(settings, "SETTLEMENT_REPROCESS_MAX_ATTEMPTS", 12)), 1)
        base_seconds = max(int(getattr(settings, "SETTLEMENT_REPROCESS_BASE_SECONDS", 300)), 1)
        max_seconds = max(int(getattr(settings, "SETTLEMENT_REPROCESS_MAX_SECONDS", 86400)), base_seconds)
        return max_attempts, base_seconds, max_seconds

    @staticmethod
    def _next_retry_at(*, now, retry_count: int, base_seconds: int, max_seconds: int):
        delay_seconds = min(base_seconds * (2 ** max(retry_count - 1, 0)), max_seconds)
        return now + timedelta(seconds=delay_seconds)

    def handle(self, *args, **options):
        limit = normalize_positive_int(options.get("limit"), default=100, minimum=1, maximum=2000)
        lock_ttl = normalize_positive_int(options.get("lock_ttl"), default=600, minimum=120)
        lock_token = build_job_lock_token(worker=options["worker"])
        with job_lock(name="reprocess_unmatched_settlement_records", token=lock_token, ttl_seconds=lock_ttl) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: reprocess_unmatched_settlement_records lock is already held."))
                return

            processed = 0
            errors = 0
            skipped_permanent = 0
            skipped_budget = 0
            records = []
            now = timezone.now()
            max_attempts, base_seconds, max_seconds = self._retry_policy()

            try:
                candidates = SettlementRecord.objects.filter(is_processed=False).filter(
                    models.Q(next_retry_at__isnull=True) | models.Q(next_retry_at__lte=now)
                ).order_by("id")
                for candidate in candidates.iterator():
                    if not is_retryable_settlement_error(candidate.processing_error):
                        skipped_permanent += 1
                        continue
                    if int(candidate.retry_count or 0) >= max_attempts:
                        skipped_budget += 1
                        continue
                    records.append(candidate)
                    if len(records) >= int(limit):
                        break

                for record in records:
                    processed_now = False
                    run_now = timezone.now()
                    try:
                        if process_settlement_record(record):
                            processed += 1
                            processed_now = True
                    except Exception:
                        errors += 1
                    finally:
                        with transaction.atomic():
                            locked = SettlementRecord.objects.select_for_update().get(pk=record.pk)
                            if locked.is_processed:
                                if locked.retry_count or locked.next_retry_at or locked.last_retry_at:
                                    locked.retry_count = 0
                                    locked.next_retry_at = None
                                    locked.last_retry_at = run_now
                                    locked.save(update_fields=["retry_count", "next_retry_at", "last_retry_at"])
                                continue

                            if processed_now:
                                locked.retry_count = 0
                                locked.next_retry_at = None
                                locked.last_retry_at = run_now
                                locked.save(update_fields=["retry_count", "next_retry_at", "last_retry_at"])
                                continue

                            retryable = is_retryable_settlement_error(locked.processing_error)
                            locked.last_retry_at = run_now
                            if not retryable:
                                locked.next_retry_at = None
                                locked.save(update_fields=["last_retry_at", "next_retry_at"])
                                continue

                            locked.retry_count = int(locked.retry_count or 0) + 1
                            if locked.retry_count < max_attempts:
                                locked.next_retry_at = self._next_retry_at(
                                    now=run_now,
                                    retry_count=int(locked.retry_count),
                                    base_seconds=base_seconds,
                                    max_seconds=max_seconds,
                                )
                            else:
                                locked.next_retry_at = None
                            locked.save(update_fields=["retry_count", "next_retry_at", "last_retry_at"])

                JobHeartbeatService.success(
                    "reprocess_unmatched_settlement_records",
                    processed=processed,
                    errors=errors,
                    skipped_permanent=skipped_permanent,
                    skipped_budget=skipped_budget,
                    limit=limit,
                    worker=options["worker"],
                )
                self.stdout.write(
                    self.style.SUCCESS(
                        f"processed={processed} errors={errors} skipped_permanent={skipped_permanent} skipped_budget={skipped_budget}"
                    )
                )
            except Exception as exc:
                JobHeartbeatService.failure(
                    "reprocess_unmatched_settlement_records",
                    str(exc),
                    processed=processed,
                    errors=errors,
                    skipped_permanent=skipped_permanent,
                    skipped_budget=skipped_budget,
                    limit=limit,
                    worker=options["worker"],
                )
                raise
