from __future__ import annotations

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from businesses.models import BusinessProfile, MarketplaceCategory


class VerifyBootstrapMarketplaceCommandTests(TestCase):
    def test_command_passes_after_bootstrap(self) -> None:
        call_command("bootstrap_marketplace")
        call_command("verify_bootstrap_marketplace")

    def test_command_fails_when_seed_category_missing(self) -> None:
        with self.assertRaises(CommandError) as exc:
            call_command("verify_bootstrap_marketplace")
        self.assertIn("missing=ev-yemegi", str(exc.exception))

    def test_command_fails_when_seed_category_is_inactive(self) -> None:
        MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug="ev-yemegi",
            name="Ev Yemeği",
            sort_order=10,
            is_active=False,
        )
        with self.assertRaises(CommandError) as exc:
            call_command("verify_bootstrap_marketplace")
        self.assertIn("inactive=ev-yemegi", str(exc.exception))

    def test_command_fails_when_description_drift_exists(self) -> None:
        call_command("bootstrap_marketplace")
        category = MarketplaceCategory.objects.get(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug="ev-yemegi",
        )
        category.description = "drift"
        category.save(update_fields=["description", "updated_at"])

        with self.assertRaises(CommandError) as exc:
            call_command("verify_bootstrap_marketplace")
        self.assertIn("mismatched=ev-yemegi", str(exc.exception))

    def test_command_reports_home_visible_count(self) -> None:
        call_command("bootstrap_marketplace")
        out = __import__("io").StringIO()
        call_command("verify_bootstrap_marketplace", stdout=out)
        self.assertIn("home_visible=8", out.getvalue())
