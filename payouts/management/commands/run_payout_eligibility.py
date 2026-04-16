from django.core.management.base import BaseCommand

from common.locks import build_job_lock_token, job_lock
from health.services import JobHeartbeatService
from payouts.services import PayoutService


class Command(BaseCommand):
    help = "Move eligible BusinessEarnings from PENDING to ELIGIBLE."

    def add_arguments(self, parser):
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=900)

    def handle(self, *args, **opts):
        lock_token = build_job_lock_token(worker=opts["worker"])
        with job_lock(name="run_payout_eligibility", token=lock_token, ttl_seconds=opts["lock_ttl"]) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: run_payout_eligibility lock is already held."))
                return
            try:
                moved = PayoutService.run_eligibility_sweep()
                JobHeartbeatService.success("run_payout_eligibility", moved=moved, worker=opts["worker"])
            except Exception as exc:
                JobHeartbeatService.failure("run_payout_eligibility", str(exc), worker=opts["worker"])
                raise
        self.stdout.write(self.style.SUCCESS(f"moved={moved}"))
