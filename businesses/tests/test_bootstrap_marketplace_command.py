from __future__ import annotations

from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from businesses.models import BusinessProfile, MarketplaceCategory


class BootstrapMarketplaceCommandTests(TestCase):
    def test_command_seeds_default_beylikduzu_categories(self) -> None:
        out = StringIO()
        call_command("bootstrap_marketplace", stdout=out)

        categories = list(
            MarketplaceCategory.objects.filter(district=BusinessProfile.District.BEYLIKDUZU).order_by("sort_order", "id")
        )
        self.assertGreaterEqual(len(categories), 8)
        self.assertEqual(categories[0].slug, "ev-yemegi")
        self.assertTrue(any(item.slug == "diger" and item.is_other for item in categories))
        self.assertIn("Bootstrap completed", out.getvalue())

    def test_command_is_idempotent(self) -> None:
        call_command("bootstrap_marketplace")
        first_count = MarketplaceCategory.objects.count()
        call_command("bootstrap_marketplace")
        second_count = MarketplaceCategory.objects.count()
        self.assertEqual(first_count, second_count)

    def test_command_reactivates_existing_seeded_category(self) -> None:
        category = MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug="ev-yemegi",
            name="Eski",
            sort_order=999,
            is_active=False,
        )

        call_command("bootstrap_marketplace")
        category.refresh_from_db()

        self.assertEqual(category.name, "Ev Yemeği")
        self.assertEqual(category.sort_order, 10)
        self.assertTrue(category.is_active)
