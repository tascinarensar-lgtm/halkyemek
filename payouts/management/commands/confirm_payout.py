from django.core.management.base import BaseCommand
from payouts.services import PayoutService

class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("payout_id", type=int)
        parser.add_argument("--note", type=str, default="")

    def handle(self, *args, **opts):
        result = PayoutService.confirm_payout(
            payout_id=opts["payout_id"],
            actor=None,
            source="manual",
            note=opts["note"],
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"ok changed={str(bool(result.changed)).lower()} status={result.status}"
            )
        )
