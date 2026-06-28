from __future__ import annotations

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from businesses.bootstrap import district_bootstrap_items
from businesses.models import BusinessProfile, MarketplaceCategory


class VerifyBootstrapMarketplaceCommandTests(TestCase):
    def _first_seed_item(self):
        return district_bootstrap_items(BusinessProfile.District.BEYLIKDUZU)[0]

    def test_command_passes_after_bootstrap(self) -> None:
        call_command("bootstrap_marketplace")
        call_command("verify_bootstrap_marketplace")

    def test_command_fails_when_seed_category_missing(self) -> None:
        first_item = self._first_seed_item()
        with self.assertRaises(CommandError) as exc:
            call_command("verify_bootstrap_marketplace")
        self.assertIn(f"missing={first_item.slug}", str(exc.exception))

    def test_command_fails_when_seed_category_is_inactive(self) -> None:
        first_item = self._first_seed_item()
        MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug=first_item.slug,
            name=first_item.name,
            sort_order=first_item.sort_order,
            is_active=False,
        )
        with self.assertRaises(CommandError) as exc:
            call_command("verify_bootstrap_marketplace")
        self.assertIn(f"inactive={first_item.slug}", str(exc.exception))

    def test_command_fails_when_description_drift_exists(self) -> None:
        first_item = self._first_seed_item()
        call_command("bootstrap_marketplace")
        category = MarketplaceCategory.objects.get(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug=first_item.slug,
        )
        category.description = "drift"
        category.save(update_fields=["description", "updated_at"])

        with self.assertRaises(CommandError) as exc:
            call_command("verify_bootstrap_marketplace")
        self.assertIn(f"mismatched={first_item.slug}", str(exc.exception))

    def test_command_reports_home_visible_count(self) -> None:
        call_command("bootstrap_marketplace")
        out = __import__("io").StringIO()
        call_command("verify_bootstrap_marketplace", stdout=out)
        self.assertIn("home_visible=4", out.getvalue())
