from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from businesses.bootstrap import DEFAULT_MARKETPLACE_BOOTSTRAP, district_bootstrap_items
from menus.serializers import DiscoveryMarketplaceCategorySerializer
from businesses.models import BusinessProfile, MarketplaceCategory


class Command(BaseCommand):
    help = "Verify official marketplace bootstrap categories are present and active."

    def add_arguments(self, parser):
        parser.add_argument(
            "--district",
            default=BusinessProfile.District.BEYLIKDUZU,
            choices=[choice for choice, _label in BusinessProfile.District.choices],
            help="District to verify official marketplace categories for.",
        )

    def handle(self, *args, **options):
        district = options["district"]
        if district not in DEFAULT_MARKETPLACE_BOOTSTRAP:
            raise CommandError(f"No official bootstrap dataset defined for district={district}")

        expected_items = district_bootstrap_items(district)
        expected_by_slug = {item.slug: item for item in expected_items}
        queryset = MarketplaceCategory.objects.filter(district=district).order_by("sort_order", "id")
        categories_by_slug = {}
        duplicate_slugs: list[str] = []
        for category in queryset:
            if category.slug in categories_by_slug:
                duplicate_slugs.append(category.slug)
                continue
            categories_by_slug[category.slug] = category

        missing = [item.slug for item in expected_items if item.slug not in categories_by_slug]
        inactive = [item.slug for item in expected_items if item.slug in categories_by_slug and not categories_by_slug[item.slug].is_active]
        mismatched: list[str] = []
        for slug, item in expected_by_slug.items():
            category = categories_by_slug.get(slug)
            if category is None:
                continue
            category_state = (
                category.name,
                (category.description or "").strip(),
                category.sort_order,
                bool(category.is_other),
            )
            expected_state = (
                item.name,
                item.description.strip(),
                item.sort_order,
                bool(item.is_other),
            )
            if category_state != expected_state:
                mismatched.append(slug)

        active_slugs = list(queryset.filter(is_active=True).values_list("slug", flat=True))
        expected_slugs = [item.slug for item in expected_items]
        home_visible = DiscoveryMarketplaceCategorySerializer(
            queryset.filter(is_active=True), many=True
        ).data

        problems: list[str] = []
        if missing:
            problems.append(f"missing={','.join(missing)}")
        if inactive:
            problems.append(f"inactive={','.join(inactive)}")
        if mismatched:
            problems.append(f"mismatched={','.join(mismatched)}")
        if duplicate_slugs:
            problems.append(f"duplicate_slugs={','.join(sorted(set(duplicate_slugs)))}")
        if active_slugs != expected_slugs:
            problems.append(f"active_slugs={','.join(active_slugs)}")
        if len(home_visible) != len(expected_items):
            problems.append(f"home_visible_categories={len(home_visible)}")

        if problems:
            raise CommandError("Marketplace bootstrap verification failed: " + "; ".join(problems))

        self.stdout.write(
            self.style.SUCCESS(
                f"Marketplace bootstrap verified: district={district} categories={len(expected_items)} home_visible={len(home_visible)}"
            )
        )
