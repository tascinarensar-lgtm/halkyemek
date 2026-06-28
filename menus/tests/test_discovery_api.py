from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from businesses.models import BusinessCategoryAssignment, BusinessProfile, MarketplaceCategory
from menus.models import BusinessOffer, MediaAsset, MenuItemQuota
from notifications.models import Device
from orders.models import Cart, CartItem
from test_support import add_membership, create_business, create_category, create_menu_item, create_user
from wallets.models import Wallet


class DiscoveryApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.now = timezone.now()

        self.market_category = MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug="burger",
            name="Burger",
            sort_order=1,
            is_active=True,
        )
        self.other_category = MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug="pizza",
            name="Pizza",
            is_other=False,
            sort_order=999,
            is_active=True,
        )

        self.featured_high = create_business(
            name="Featured High",
            district=BusinessProfile.District.BEYLIKDUZU,
        )
        self.featured_high.is_featured = True
        self.featured_high.display_priority = 99
        self.featured_high.short_description = "Yüksek öncelikli anlaşmalı işletme"
        self.featured_high.save(update_fields=["is_featured", "display_priority", "short_description"])

        self.featured_low = create_business(
            name="Featured Low",
            district=BusinessProfile.District.BEYLIKDUZU,
        )
        self.featured_low.is_featured = True
        self.featured_low.display_priority = 5
        self.featured_low.save(update_fields=["is_featured", "display_priority"])

        self.volunteer = create_business(
            name="Volunteer Biz",
            district=BusinessProfile.District.BEYLIKDUZU,
        )
        self.volunteer.listing_type = BusinessProfile.ListingType.VOLUNTEER
        self.volunteer.save(update_fields=["listing_type"])

        BusinessCategoryAssignment.objects.create(
            business=self.featured_high,
            marketplace_category=self.market_category,
            is_primary=True,
            is_active=True,
            sort_order=1,
        )
        BusinessCategoryAssignment.objects.create(
            business=self.featured_low,
            marketplace_category=self.market_category,
            is_primary=True,
            is_active=True,
            sort_order=2,
        )
        BusinessCategoryAssignment.objects.create(
            business=self.volunteer,
            marketplace_category=self.other_category,
            is_primary=True,
            is_active=True,
            sort_order=1,
        )

        MediaAsset.objects.create(
            business=self.featured_high,
            file_url="https://cdn.example.com/business-cover.jpg",
            media_type=MediaAsset.MediaType.IMAGE,
            asset_role=MediaAsset.AssetRole.COVER,
            sort_order=0,
            is_active=True,
        )
        MediaAsset.objects.create(
            business=self.featured_high,
            file_url="https://cdn.example.com/business-cover-inactive.jpg",
            media_type=MediaAsset.MediaType.IMAGE,
            asset_role=MediaAsset.AssetRole.COVER,
            sort_order=1,
            is_active=False,
        )
        MediaAsset.objects.create(
            marketplace_category=self.market_category,
            file_url="https://cdn.example.com/category.jpg",
            media_type=MediaAsset.MediaType.IMAGE,
            asset_role=MediaAsset.AssetRole.COVER,
            sort_order=0,
            is_active=True,
        )

        menu_category = create_category(business=self.featured_high, name="Ana Menü")
        menu_item = create_menu_item(
            business=self.featured_high,
            category=menu_category,
            name="Nohut",
            slug="nohut",
            is_active=True,
            is_visible=True,
            is_available=True,
        )
        self.menu_item = menu_item
        second_menu_item = create_menu_item(
            business=self.featured_high,
            category=menu_category,
            name="Pilav",
            slug="pilav",
            is_active=True,
            is_visible=True,
            is_available=True,
        )
        MediaAsset.objects.create(
            menu_item=menu_item,
            file_url="https://cdn.example.com/nohut.jpg",
            media_type=MediaAsset.MediaType.IMAGE,
            asset_role=MediaAsset.AssetRole.THUMBNAIL,
            sort_order=0,
            is_active=True,
        )

        self.active_offer = BusinessOffer.objects.create(
            business=self.featured_high,
            menu_item=menu_item,
            title="Halk Menü",
            short_description="Bugüne özel",
            description="Açıklama",
            label="Öne Çıkan",
            tag="halk",
            offer_price_amount=1900,
            starts_at=self.now - timedelta(hours=1),
            ends_at=self.now + timedelta(hours=3),
            is_active=True,
            is_featured=True,
            sort_order=0,
        )
        BusinessOffer.objects.create(
            business=self.featured_high,
            menu_item=menu_item,
            title="Geçmiş Kampanya",
            offer_price_amount=1700,
            starts_at=self.now - timedelta(days=2),
            ends_at=self.now - timedelta(days=1),
            is_active=True,
            is_featured=True,
            sort_order=0,
        )
        MediaAsset.objects.create(
            offer=self.active_offer,
            file_url="https://cdn.example.com/offer.jpg",
            media_type=MediaAsset.MediaType.IMAGE,
            asset_role=MediaAsset.AssetRole.COVER,
            sort_order=0,
            is_active=True,
        )

        self.customer = create_user(username="discovery-customer")
        wallet, _ = Wallet.objects.get_or_create(user=self.customer, defaults={"balance": 0, "pending_balance": 0})
        wallet.balance = 55000
        wallet.pending_balance = 1200
        wallet.save(update_fields=["balance", "pending_balance", "updated_at"])

        cart = Cart.objects.create(
            user=self.customer,
            business=self.featured_high,
            status=Cart.Status.ACTIVE,
            subtotal_amount=10000,
            customer_fee_amount=1000,
            total_amount=11000,
            snapshot={"item_count": 2, "items": []},
        )
        CartItem.objects.create(
            cart=cart,
            menu_item=menu_item,
            quantity=1,
            unit_price_amount=menu_item.price_amount,
            line_total_amount=menu_item.price_amount,
            menu_item_name=menu_item.name,
            sort_order=1,
        )
        CartItem.objects.create(
            cart=cart,
            menu_item=second_menu_item,
            quantity=1,
            unit_price_amount=second_menu_item.price_amount,
            line_total_amount=second_menu_item.price_amount,
            menu_item_name=second_menu_item.name,
            sort_order=2,
        )
        Device.objects.create(
            user=self.customer,
            platform=Device.Platform.ANDROID,
            fcm_token="discovery-device-token",
            permission_granted=True,
            is_active=True,
        )

    def test_home_endpoint_returns_expected_blocks(self):
        self.client.force_authenticate(self.customer)
        response = self.client.get("/api/v1/discovery/home/?district=BEYLIKDUZU")
        self.assertEqual(response.status_code, 200)
        self.assertIn("categories", response.data)
        self.assertIn("featured_businesses", response.data)
        self.assertIn("other_businesses", response.data)
        self.assertIn("menu_items", response.data)
        self.assertIn("active_offers", response.data)
        self.assertGreaterEqual(len(response.data["menu_items"]), 2)
        self.assertEqual(response.data["wallet_summary"]["balance"], 55000)
        self.assertEqual(response.data["active_cart_summary"]["item_count"], 2)
        self.assertTrue(response.data["notification_readiness"]["notification_ready"])

    def test_home_cart_summary_uses_actual_items_not_stale_snapshot(self):
        customer = create_user(username="stale-cart-customer")
        Cart.objects.create(
            user=customer,
            business=self.featured_high,
            status=Cart.Status.ACTIVE,
            subtotal_amount=0,
            customer_fee_amount=0,
            total_amount=0,
            snapshot={"item_count": 3, "items": [{"name": "stale"}]},
        )

        self.client.force_authenticate(customer)
        response = self.client.get("/api/v1/discovery/home/?district=BEYLIKDUZU")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["active_cart_summary"]["item_count"], 0)

    def test_home_featured_ordering_and_restaurant_block_includes_other_businesses(self):
        response = self.client.get("/api/v1/discovery/home/?district=BEYLIKDUZU")
        self.assertEqual(response.status_code, 200)
        featured_names = [item["business_name"] for item in response.data["featured_businesses"]]
        self.assertEqual(featured_names[0], "Featured High")

        other_names = [item["business_name"] for item in response.data["other_businesses"]]
        self.assertIn("Volunteer Biz", other_names)

    def test_public_business_cards_include_menu_quota_summary(self):
        quota, _ = MenuItemQuota.objects.update_or_create(
            menu_item=self.menu_item,
            defaults={
                "is_enabled": True,
                "quota_total": 8,
                "quota_remaining": 5,
                "quota_reserved": 0,
            },
        )

        response = self.client.get("/api/v1/discovery/home/?district=BEYLIKDUZU")

        self.assertEqual(response.status_code, 200)
        featured = next(item for item in response.data["featured_businesses"] if item["id"] == self.featured_high.id)
        self.assertEqual(featured["menu_quota_item_count"], 1)
        self.assertEqual(featured["menu_quota_remaining"], 5)
        self.assertEqual(featured["menu_quota_label"], "5 adet bulunmakta")
        self.assertFalse(featured["menu_quota_is_sold_out"])

        quota.quota_remaining = 0
        quota.save(update_fields=["quota_remaining", "updated_at"])

        response = self.client.get("/api/v1/catalog/businesses/")

        self.assertEqual(response.status_code, 200)
        listed = next(item for item in response.data["results"] if item["id"] == self.featured_high.id)
        self.assertEqual(listed["menu_quota_remaining"], 0)
        self.assertEqual(listed["menu_quota_label"], "Hepsi tükendi")
        self.assertTrue(listed["menu_quota_is_sold_out"])

    def test_category_discovery_supports_listing_filter_and_pagination_shape(self):
        response = self.client.get(
            "/api/v1/discovery/categories/burger/businesses/?district=BEYLIKDUZU&listing_type=CONTRACTED&page=1&page_size=10"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("count", response.data)
        self.assertIn("results", response.data)
        self.assertEqual(response.data["count"], 2)

    def test_business_detail_is_enriched_and_filters_inactive_media(self):
        response = self.client.get(f"/api/v1/catalog/businesses/{self.featured_high.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["business"]["short_description"], "Yüksek öncelikli anlaşmalı işletme")
        media_urls = [asset["url"] for asset in response.data["media"]]
        self.assertIn("https://cdn.example.com/business-cover.jpg", media_urls)
        self.assertNotIn("https://cdn.example.com/business-cover-inactive.jpg", media_urls)

    def test_offer_visibility_only_active_window(self):
        response = self.client.get("/api/v1/discovery/home/?district=BEYLIKDUZU")
        self.assertEqual(response.status_code, 200)
        offer_titles = [offer["title"] for offer in response.data["active_offers"]]
        self.assertEqual(offer_titles, ["Halk Menü"])

    def test_public_menu_response_contains_enriched_offer_and_menu_images(self):
        response = self.client.get(f"/api/v1/catalog/businesses/{self.featured_high.id}/menu/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["active_offers"][0]["image"], "https://cdn.example.com/offer.jpg")
        self.assertEqual(response.data["categories"][0]["menu_items"][0]["image"], "https://cdn.example.com/nohut.jpg")

from django.core.management import call_command


class DiscoveryBootstrapSeedTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_home_categories_not_empty_after_official_bootstrap(self):
        call_command("bootstrap_marketplace", district=BusinessProfile.District.BEYLIKDUZU)

        response = self.client.get("/api/v1/discovery/home/?district=BEYLIKDUZU")
        self.assertEqual(response.status_code, 200)
        slugs = [item["slug"] for item in response.data["categories"]]
        self.assertEqual(slugs, ["burger", "pizza", "doner", "kebap"])
