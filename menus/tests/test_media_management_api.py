import shutil
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.test.utils import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from businesses.models import BusinessMember, BusinessProfile, MarketplaceCategory
from menus.models import BusinessOffer, MediaAsset
from test_support import add_membership, create_business, create_category, create_menu_item, create_user


class BusinessMediaManagementApiTests(TestCase):
    def setUp(self):
        self.temp_media_root = tempfile.mkdtemp(prefix="halkyemek-media-test-")
        self.client = APIClient()
        self.owner = create_user(username="owner")
        self.manager = create_user(username="manager")
        self.other_manager = create_user(username="other-manager")
        self.admin = create_user(username="admin", role=User.Role.ADMIN, is_staff=True)

        self.business = create_business(name="Media Biz", contact_user=self.owner)
        self.other_business = create_business(name="Other Biz")
        add_membership(business=self.business, user=self.owner, role=BusinessMember.Role.OWNER)
        add_membership(business=self.business, user=self.manager, role=BusinessMember.Role.MANAGER)
        add_membership(business=self.other_business, user=self.other_manager, role=BusinessMember.Role.MANAGER)

        self.category = create_category(business=self.business, name="Ana")
        self.menu_item = create_menu_item(
            business=self.business,
            category=self.category,
            name="Tas Kebabı",
            slug="tas-kebabi",
        )
        self.marketplace_category = MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug="ev-yemegi-test",
            name="Ev Yemeği Test",
            is_active=True,
        )
        self.offer = BusinessOffer.objects.create(
            business=self.business,
            menu_item=self.menu_item,
            title="Halk Menü",
            offer_price_amount=1800,
            starts_at=timezone.now() - timedelta(hours=1),
            ends_at=timezone.now() + timedelta(hours=1),
            is_active=True,
        )

    def tearDown(self):
        shutil.rmtree(self.temp_media_root, ignore_errors=True)


    def test_manager_can_create_media_for_own_business(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/media/",
            {
                "menu_item": self.menu_item.id,
                "file_url": "https://cdn.example.com/menu-item.jpg",
                "media_type": "IMAGE",
                "asset_role": "THUMBNAIL",
                "sort_order": 1,
                "is_active": True,
                "metadata": {"file_size_bytes": 1024},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(MediaAsset.objects.filter(menu_item=self.menu_item, is_active=True).exists())

    def test_manager_cannot_manage_other_business_media(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(f"/api/v1/businesses/{self.other_business.id}/media/")
        self.assertEqual(response.status_code, 403)

    def test_admin_override_can_manage_media(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            f"/api/v1/businesses/{self.other_business.id}/media/",
            {
                "file_url": "https://cdn.example.com/other-business-cover.jpg",
                "media_type": "IMAGE",
                "asset_role": "COVER",
                "sort_order": 0,
                "is_active": True,
                "metadata": {"file_size_bytes": 2048},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_media_validation_rejects_unsupported_extension(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/media/",
            {
                "file_url": "https://cdn.example.com/invalid.exe",
                "media_type": "IMAGE",
                "asset_role": "COVER",
                "sort_order": 0,
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_offer_and_category_targets_supported(self):
        self.client.force_authenticate(self.manager)
        offer_resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/media/",
            {
                "offer": self.offer.id,
                "file_url": "https://cdn.example.com/offer-cover.jpg",
                "media_type": "IMAGE",
                "asset_role": "COVER",
                "sort_order": 0,
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(offer_resp.status_code, 201)

        category_resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/media/",
            {
                "marketplace_category": self.marketplace_category.id,
                "file_url": "https://cdn.example.com/category-cover.jpg",
                "media_type": "IMAGE",
                "asset_role": "COVER",
                "sort_order": 0,
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(category_resp.status_code, 201)

    @override_settings(MEDIA_ASSET_MAX_BYTES=8 * 1024 * 1024)
    def test_manager_can_upload_real_image_file(self):
        self.client.force_authenticate(self.manager)
        image = SimpleUploadedFile(
            "menu-cover.png",
            (
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
                b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT\x08\x99c```\x00\x00"
                b"\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB`\x82"
            ),
            content_type="image/png",
        )

        with override_settings(MEDIA_ROOT=self.temp_media_root):
            response = self.client.post(
                f"/api/v1/businesses/{self.business.id}/media/",
                {
                    "menu_item": self.menu_item.id,
                    "file": image,
                    "media_type": "IMAGE",
                    "asset_role": "COVER",
                    "sort_order": 0,
                    "is_active": True,
                },
            )

        self.assertEqual(response.status_code, 201)
        asset = MediaAsset.objects.get(menu_item=self.menu_item, asset_role="COVER")
        self.assertTrue(asset.file_path.startswith("business-media/"))
        self.assertIn("/media/business-media/", asset.file_url)
