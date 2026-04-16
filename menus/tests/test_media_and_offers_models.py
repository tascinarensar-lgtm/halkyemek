from datetime import timedelta

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from menus.models import BusinessOffer, MediaAsset
from test_support import create_business, create_category, create_menu_item, create_user


class MediaAssetModelTests(TestCase):
    def setUp(self):
        self.user = create_user(username="uploader")
        self.business = create_business(name="Media Biz")
        self.category = create_category(business=self.business, name="Main")
        self.item = create_menu_item(
            business=self.business,
            category=self.category,
            name="Pilav",
            slug="pilav",
            price_amount=1000,
        )

    def test_requires_target_and_file_reference(self):
        asset = MediaAsset(media_type=MediaAsset.MediaType.IMAGE)
        with self.assertRaises(ValidationError):
            asset.full_clean()

    def test_menu_item_attachment_sets_business(self):
        asset = MediaAsset.objects.create(
            menu_item=self.item,
            file_url="https://example.com/pilav.jpg",
            uploaded_by=self.user,
        )
        self.assertEqual(asset.business_id, self.business.id)


class BusinessOfferModelTests(TestCase):
    def setUp(self):
        self.business = create_business(name="Offer Biz")
        category = create_category(business=self.business, name="Main")
        self.item = create_menu_item(
            business=self.business,
            category=category,
            name="Mercimek",
            slug="mercimek",
            price_amount=1800,
        )

    def test_offer_window_must_be_valid(self):
        now = timezone.now()
        offer = BusinessOffer(
            business=self.business,
            menu_item=self.item,
            title="Halk Menüsü",
            offer_price_amount=1200,
            starts_at=now,
            ends_at=now,
        )
        with self.assertRaises(ValidationError):
            offer.full_clean()

    def test_offer_daily_limit_positive_when_present(self):
        now = timezone.now()
        offer = BusinessOffer(
            business=self.business,
            menu_item=self.item,
            title="Halk Menüsü",
            offer_price_amount=1200,
            starts_at=now,
            ends_at=now + timedelta(hours=2),
            daily_limit=0,
        )
        with self.assertRaises(ValidationError):
            offer.full_clean()

    def test_offer_can_be_created_with_valid_payload(self):
        now = timezone.now()
        offer = BusinessOffer.objects.create(
            business=self.business,
            menu_item=self.item,
            title="Halk Menüsü",
            short_description="Özel uygun fiyatlı menü",
            offer_price_amount=1200,
            starts_at=now,
            ends_at=now + timedelta(hours=2),
            is_active=True,
            is_featured=True,
            daily_limit=50,
        )
        self.assertTrue(offer.is_active)
        self.assertTrue(offer.is_featured)
