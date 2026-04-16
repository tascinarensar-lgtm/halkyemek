from django.core.management.base import BaseCommand

from common.locks import build_job_lock_token, job_lock
from common.tasks import normalize_positive_int
from health.services import JobHeartbeatService
from payouts.services import PayoutService


class Command(BaseCommand):
    help = "Create payout batch(es) from ELIGIBLE earnings. One batch is created per business."

    def add_arguments(self, parser):
        parser.add_argument("--max-businesses", type=int, default=None)
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=600)

    def handle(self, *args, **opts):
        lock_ttl = normalize_positive_int(opts.get("lock_ttl"), default=600, minimum=120)
        raw_max_businesses = opts.get("max_businesses")
        max_businesses = (
            None
            if raw_max_businesses is None
            else normalize_positive_int(raw_max_businesses, default=1, minimum=1, maximum=2000)
        )
        worker = str(opts.get("worker", "") or "").strip()
        lock_token = build_job_lock_token(worker=worker)
        with job_lock(name="create_payout_batch", token=lock_token, ttl_seconds=lock_ttl) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: create_payout_batch lock is already held."))
                return

            try:
                batches = PayoutService.create_batches_for_eligible(max_businesses=max_businesses)
                if not batches:
                    JobHeartbeatService.success(
                        "create_payout_batch",
                        created=0,
                        max_businesses=max_businesses,
                        worker=worker,
                    )
                    self.stdout.write(self.style.WARNING("no eligible earnings"))
                    return

                batch_ids = [int(getattr(batch, "pk")) for batch in batches]
                ids = ",".join(str(batch_id) for batch_id in batch_ids)
                JobHeartbeatService.success(
                    "create_payout_batch",
                    created=len(batches),
                    batch_ids=batch_ids,
                    max_businesses=max_businesses,
                    worker=worker,
                )
                self.stdout.write(self.style.SUCCESS(f"created={len(batches)} batch_ids={ids}"))
            except Exception as exc:
                JobHeartbeatService.failure(
                    "create_payout_batch",
                    str(exc),
                    max_businesses=max_businesses,
                    worker=worker,
                )
                raise
