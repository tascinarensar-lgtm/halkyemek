from django.core.management.base import BaseCommand
from django.utils import timezone

from common.locks import build_job_lock_token, job_lock
from health.services import JobHeartbeatService
from orders.models import CheckoutSession


class Command(BaseCommand):
    help = "Mark stale pending checkout sessions as EXPIRED."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=500)
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=240)

    def handle(self, *args, **options):
        lock_token = build_job_lock_token(worker=options["worker"])
        with job_lock(name="cleanup_checkout_sessions", token=lock_token, ttl_seconds=options["lock_ttl"]) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: cleanup_checkout_sessions lock is already held."))
                return

            now = timezone.now()
            try:
                session_ids = list(
                    CheckoutSession.objects.filter(
                        status__in=[
                            CheckoutSession.Status.PENDING,
                            CheckoutSession.Status.CONFIRMED,
                        ],
                        expires_at__lte=now,
                    ).values_list("id", flat=True)[: options["limit"]]
                )
                updated = 0
                if session_ids:
                    updated = CheckoutSession.objects.filter(
                        id__in=session_ids,
                        status__in=[
                            CheckoutSession.Status.PENDING,
                            CheckoutSession.Status.CONFIRMED,
                        ],
                        expires_at__lte=now,
                    ).update(
                        status=CheckoutSession.Status.EXPIRED,
                        updated_at=now,
                    )
                JobHeartbeatService.success(
                    "cleanup_checkout_sessions",
                    processed=updated,
                    limit=options["limit"],
                    worker=options["worker"],
                )
                self.stdout.write(self.style.SUCCESS(f"expired_sessions={updated}"))
            except Exception as exc:
                JobHeartbeatService.failure(
                    "cleanup_checkout_sessions",
                    str(exc),
                    limit=options["limit"],
                    worker=options["worker"],
                )
                raise
