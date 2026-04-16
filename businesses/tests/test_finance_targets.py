from test_support import create_business


from django.test import TestCase

from accounts.models import User
from businesses.models import BusinessMember, BusinessProfile
from businesses.services.membership import (
    get_business_contact_email,
    get_business_contact_metadata,
    get_business_finance_notification_users,
    get_business_operational_notification_users,
)


class BusinessFinanceTargetTests(TestCase):
    def test_finance_notifications_prefer_owner_and_manager_memberships(self):
        primary_contact = User.objects.create_user(username="primary", password="pass", email="primary@example.com")
        owner = User.objects.create_user(username="owner", password="pass")
        manager = User.objects.create_user(username="manager", password="pass")
        cashier = User.objects.create_user(username="cashier", password="pass")

        business = BusinessProfile.objects.create(
            contact_user=primary_contact,
            business_name="Biz",
            category="Food",
            adress="Addr",
            district=BusinessProfile.District.BEYLIKDUZU,
        )

        BusinessMember.objects.create(business=business, user=owner, role=BusinessMember.Role.OWNER, is_active=True)
        BusinessMember.objects.create(business=business, user=manager, role=BusinessMember.Role.MANAGER, is_active=True)
        BusinessMember.objects.create(business=business, user=cashier, role=BusinessMember.Role.CASHIER, is_active=True)

        target_ids = {user.id for user in get_business_finance_notification_users(business)}

        self.assertEqual(target_ids, {owner.id, manager.id})

    def test_finance_notifications_do_not_fallback_to_primary_contact_without_membership(self):
        primary_contact = User.objects.create_user(
            username="primary",
            password="pass",
            email="primary@example.com",
            google_email="primary-google@example.com",
        )
        business = BusinessProfile.objects.create(
            contact_user=primary_contact,
            business_name="Biz",
            category="Food",
            adress="Addr",
            district=BusinessProfile.District.BEYLIKDUZU,
            kyc_email="",
        )

        users = get_business_finance_notification_users(business)

        self.assertEqual(users, [])
        self.assertEqual(get_business_contact_email(business), "")

    def test_contact_metadata_payload_uses_kyc_fields_only(self):
        primary_contact = User.objects.create_user(
            username="primary-meta",
            password="pass",
            email="primary@example.com",
            google_email="primary-google@example.com",
        )
        business = BusinessProfile.objects.create(
            contact_user=primary_contact,
            business_name="Biz Meta",
            category="Food",
            adress="Addr",
            district=BusinessProfile.District.BEYLIKDUZU,
            kyc_email="ops@example.com",
            kyc_gsm_number="05551234567",
        )

        payload = get_business_contact_metadata(business)

        self.assertEqual(
            payload,
            {
                "contact_user_id": primary_contact.id,
                "email": "ops@example.com",
                "gsm_number": "05551234567",
            },
        )

    def test_business_profile_contact_helpers_expose_final_semantics(self):
        primary_contact = User.objects.create_user(username="meta-owner", password="pass")
        business = BusinessProfile.objects.create(
            contact_user=primary_contact,
            business_name="Final Biz",
            category="Food",
            adress="Addr",
            district=BusinessProfile.District.BEYLIKDUZU,
            kyc_email="final@example.com",
            kyc_gsm_number="05550000000",
        )

        self.assertEqual(business.contact_user_id, primary_contact.id)
        self.assertEqual(business.contact_email, "final@example.com")
        self.assertEqual(business.contact_gsm_number, "05550000000")
        self.assertEqual(
            business.contact_metadata(),
            {
                "contact_user_id": primary_contact.id,
                "email": "final@example.com",
                "gsm_number": "05550000000",
            },
        )

    def test_create_business_helper_does_not_invent_contact_user_metadata(self):
        business = create_business(name="No Contact Biz")

        self.assertIsNone(business.contact_user_id)
        self.assertEqual(
            business.contact_metadata(),
            {
                "contact_user_id": None,
                "email": "",
                "gsm_number": "",
            },
        )

    def test_operational_notifications_include_cashier_memberships(self):
        primary_contact = User.objects.create_user(username="primary2", password="pass")
        owner = User.objects.create_user(username="owner2", password="pass")
        manager = User.objects.create_user(username="manager2", password="pass")
        cashier = User.objects.create_user(username="cashier2", password="pass")

        business = BusinessProfile.objects.create(
            contact_user=primary_contact,
            business_name="Biz2",
            category="Food",
            adress="Addr",
            district=BusinessProfile.District.BEYLIKDUZU,
        )

        BusinessMember.objects.create(business=business, user=owner, role=BusinessMember.Role.OWNER, is_active=True)
        BusinessMember.objects.create(business=business, user=manager, role=BusinessMember.Role.MANAGER, is_active=True)
        BusinessMember.objects.create(business=business, user=cashier, role=BusinessMember.Role.CASHIER, is_active=True)

        target_ids = {user.id for user in get_business_operational_notification_users(business)}

        self.assertEqual(target_ids, {owner.id, manager.id, cashier.id})
