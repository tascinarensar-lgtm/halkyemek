from django.core.management.base import BaseCommand
from payouts.services import PayoutService

class Command(BaseCommand):
    def add_arguments(self, parser):
        parser.add_argument("payout_id", type=int)
        parser.add_argument("--provider-id", type=str, default=None)

    def handle(self, *args, **opts):
        PayoutService.mark_payout_sent(payout_id=opts["payout_id"], provider_payout_id=opts["provider_id"])
        self.stdout.write(self.style.SUCCESS("ok"))
