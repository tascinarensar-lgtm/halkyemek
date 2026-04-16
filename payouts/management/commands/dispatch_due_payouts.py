from django.core.management.base import BaseCommand

from common.locks import build_job_lock_token, job_lock
from common.tasks import normalize_positive_int
from health.services import JobHeartbeatService
from payouts.services import PayoutService


class Command(BaseCommand):
    help = "Dispatch due payouts with retry/backoff, concurrency-safe."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=50)
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=240)

    def handle(self, *args, **opts):
        limit = normalize_positive_int(opts.get("limit"), default=50, minimum=1, maximum=1000)
        lock_ttl = normalize_positive_int(opts.get("lock_ttl"), default=240, minimum=60)
        lock_token = build_job_lock_token(worker=opts["worker"])
        with job_lock(name="dispatch_due_payouts", token=lock_token, ttl_seconds=lock_ttl) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: dispatch_due_payouts lock is already held."))
                return
            try:
                n = PayoutService.dispatch_due_payouts(limit=limit, worker_id=opts["worker"])
                JobHeartbeatService.success("dispatch_due_payouts", processed=n, worker=opts["worker"], limit=limit)
            except Exception as exc:
                JobHeartbeatService.failure("dispatch_due_payouts", str(exc), worker=opts["worker"], limit=limit)
                raise
        self.stdout.write(self.style.SUCCESS(f"processed={n}"))
