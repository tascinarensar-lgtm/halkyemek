from django.core.management.base import BaseCommand

from surprise_deals.services import expire_due_surprise_deal_reservations


class Command(BaseCommand):
    help = "Expire due surprise deal reservations and release reserved stock."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--dry-run", action="store_true", dest="dry_run")

    def handle(self, *args, **options):
        limit = max(int(options.get("limit") or 100), 1)
        dry_run = bool(options.get("dry_run"))
        expired_count = expire_due_surprise_deal_reservations(limit=limit, dry_run=dry_run)
        self.stdout.write(f"expired_count={expired_count}")
        if dry_run:
            self.stdout.write("dry_run=true")
