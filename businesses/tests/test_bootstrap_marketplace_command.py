from __future__ import annotations

from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from businesses.bootstrap import district_bootstrap_items
from businesses.models import BusinessProfile, MarketplaceCategory


class BootstrapMarketplaceCommandTests(TestCase):
    def test_command_seeds_default_beylikduzu_categories(self) -> None:
        out = StringIO()
        call_command("bootstrap_marketplace", stdout=out)

        categories = list(
            MarketplaceCategory.objects.filter(district=BusinessProfile.District.BEYLIKDUZU).order_by("sort_order", "id")
        )
        expected_items = district_bootstrap_items(BusinessProfile.District.BEYLIKDUZU)
        expected_slugs = [item.slug for item in expected_items]
        active_categories = [item for item in categories if item.is_active]
        self.assertEqual([item.slug for item in active_categories], expected_slugs)
        self.assertEqual(len(active_categories), 4)
        self.assertFalse(any(item.is_other for item in active_categories))
        self.assertIn("Bootstrap completed", out.getvalue())

    def test_command_is_idempotent(self) -> None:
        call_command("bootstrap_marketplace")
        first_count = MarketplaceCategory.objects.count()
        call_command("bootstrap_marketplace")
        second_count = MarketplaceCategory.objects.count()
        self.assertEqual(first_count, second_count)

    def test_command_reactivates_existing_seeded_category(self) -> None:
        first_item = district_bootstrap_items(BusinessProfile.District.BEYLIKDUZU)[0]
        category = MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug=first_item.slug,
            name="Eski",
            sort_order=999,
            is_active=False,
        )

        call_command("bootstrap_marketplace")
        category.refresh_from_db()

        self.assertEqual(category.name, first_item.name)
        self.assertEqual(category.sort_order, first_item.sort_order)
        self.assertTrue(category.is_active)
