from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from businesses.bootstrap import DEFAULT_MARKETPLACE_BOOTSTRAP, seed_marketplace_categories
from businesses.models import BusinessProfile


class Command(BaseCommand):
    help = "Seed official marketplace bootstrap categories for discovery surfaces."

    def add_arguments(self, parser):
        parser.add_argument(
            "--district",
            default=BusinessProfile.District.BEYLIKDUZU,
            choices=[choice for choice, _label in BusinessProfile.District.choices],
            help="District to seed official marketplace categories for.",
        )
        parser.add_argument(
            "--overwrite-descriptions",
            action="store_true",
            help="Also refresh descriptions for existing categories.",
        )

    def handle(self, *args, **options):
        district = options["district"]
        if district not in DEFAULT_MARKETPLACE_BOOTSTRAP:
            raise CommandError(f"No official bootstrap dataset defined for district={district}")

        summary = seed_marketplace_categories(
            district=district,
            overwrite_descriptions=bool(options.get("overwrite_descriptions", False)),
        )
        self.stdout.write(
            self.style.SUCCESS(
                "Bootstrap completed: "
                f"district={summary['district']} expected={summary['expected_count']} "
                f"created={summary['created']} updated={summary['updated']} "
                f"untouched={summary['untouched']} deactivated={summary['deactivated']}"
            )
        )
