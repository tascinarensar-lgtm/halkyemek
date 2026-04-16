from django.core.management.base import BaseCommand

from common.locks import build_job_lock_token, job_lock
from health.services import JobHeartbeatService
from notifications.services import NotificationService


class Command(BaseCommand):
    help = "Process pending/failed notification delivery attempts"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--lock-ttl", type=int, default=55)
        parser.add_argument("--worker", type=str, default="scheduler")

    def handle(self, *args, **options):
        lock_token = build_job_lock_token(worker=options["worker"])
        with job_lock(name="process_notifications", token=lock_token, ttl_seconds=options["lock_ttl"]) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: process_notifications lock is already held."))
                return
            try:
                count = NotificationService.enqueue_due_attempts(limit=options["limit"])
                JobHeartbeatService.success("process_notifications", processed=count, limit=options["limit"], worker=options["worker"])
            except Exception as exc:
                JobHeartbeatService.failure("process_notifications", str(exc), limit=options["limit"], worker=options["worker"])
                raise
        self.stdout.write(self.style.SUCCESS(f"Processed notification attempts: {count}"))
