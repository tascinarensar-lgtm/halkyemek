from django.core.management.base import BaseCommand

from common.locks import build_job_lock_token, job_lock
from common.tasks import normalize_positive_int
from health.services import JobHeartbeatService
from payouts.services import PayoutService


class Command(BaseCommand):
    help = "Sync SENT payouts with provider status and auto-confirm/fail when possible."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=50)
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=240)

    def handle(self, *args, **opts):
        limit = normalize_positive_int(opts.get("limit"), default=50, minimum=1, maximum=1000)
        lock_ttl = normalize_positive_int(opts.get("lock_ttl"), default=240, minimum=60)
        lock_token = build_job_lock_token(worker=opts["worker"])
        with job_lock(name="sync_sent_payout_statuses", token=lock_token, ttl_seconds=lock_ttl) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: sync_sent_payout_statuses lock is already held."))
                return
            try:
                n = PayoutService.sync_sent_payout_statuses(limit=limit)
                JobHeartbeatService.success("sync_sent_payout_statuses", processed=n, limit=limit, worker=opts["worker"])
            except Exception as exc:
                JobHeartbeatService.failure("sync_sent_payout_statuses", str(exc), limit=limit, worker=opts["worker"])
                raise
        self.stdout.write(self.style.SUCCESS(f"processed={n}"))
