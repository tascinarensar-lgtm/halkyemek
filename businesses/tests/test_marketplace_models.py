from django.core.exceptions import ValidationError
from django.test import TestCase

from businesses.models import BusinessCategoryAssignment, BusinessProfile, MarketplaceCategory
from test_support import create_business, create_user


class MarketplaceCategoryModelTests(TestCase):
    def test_single_other_category_per_district(self):
        MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug="diger",
            name="Diğer",
            is_other=True,
        )
        with self.assertRaises(ValidationError):
            MarketplaceCategory.objects.create(
                district=BusinessProfile.District.BEYLIKDUZU,
                slug="other-second",
                name="Other",
                is_other=True,
            )


class BusinessCategoryAssignmentModelTests(TestCase):
    def setUp(self):
        owner = create_user(username="owner")
        self.business = create_business(name="Assign Biz", contact_user=owner)
        self.category_a = MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug="ev-yemegi",
            name="Ev Yemeği",
        )
        self.category_b = MarketplaceCategory.objects.create(
            district=BusinessProfile.District.BEYLIKDUZU,
            slug="diger",
            name="Diğer",
            is_other=True,
        )

    def test_business_can_have_only_one_active_primary_assignment(self):
        BusinessCategoryAssignment.objects.create(
            business=self.business,
            marketplace_category=self.category_a,
            is_primary=True,
            is_active=True,
        )
        with self.assertRaises(ValidationError):
            BusinessCategoryAssignment.objects.create(
                business=self.business,
                marketplace_category=self.category_b,
                is_primary=True,
                is_active=True,
            )

    def test_primary_assignment_must_be_active(self):
        assignment = BusinessCategoryAssignment(
            business=self.business,
            marketplace_category=self.category_a,
            is_primary=True,
            is_active=False,
        )
        with self.assertRaises(ValidationError):
            assignment.full_clean()


class BusinessProfileListingFieldsTests(TestCase):
    def test_listing_type_and_feature_fields_defaults(self):
        profile = create_business(name="Listing Biz")
        self.assertEqual(profile.listing_type, BusinessProfile.ListingType.CONTRACTED)
        self.assertFalse(profile.is_featured)
        self.assertEqual(profile.display_priority, 0)
        self.assertTrue(profile.marketplace_is_visible)
