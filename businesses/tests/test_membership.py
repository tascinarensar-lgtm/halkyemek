from django.test import TestCase
from django.contrib.auth import get_user_model

from businesses.models import BusinessProfile, BusinessMember

User = get_user_model()


class BusinessMembershipTests(TestCase):
    def _create_business(self, name: str, owner: User) -> BusinessProfile: # type: ignore
        return BusinessProfile.objects.create(
            contact_user=owner,
            business_name=name,
            category="Restaurant",
            adress="Test adres",
            district=BusinessProfile.District.BEYLIKDUZU,
        )

    def test_user_can_have_multiple_business_memberships(self):
        member_user = User.objects.create_user( # type: ignore
            username="member1",
            password="testpass123",
        )

        owner1 = User.objects.create_user( # type: ignore
            username="owner1",
            password="testpass123",
        )
        owner2 = User.objects.create_user( # type: ignore
            username="owner2",
            password="testpass123",
        )

        b1 = self._create_business("A", owner1)
        b2 = self._create_business("B", owner2)

        BusinessMember.objects.create(
            business=b1,
            user=member_user,
            role=BusinessMember.Role.CASHIER,
            granted_by=owner1,
        )
        BusinessMember.objects.create(
            business=b2,
            user=member_user,
            role=BusinessMember.Role.MANAGER,
            granted_by=owner2,
        )

        self.assertEqual(
            BusinessMember.objects.filter(user=member_user, is_active=True).count(),
            2,
        )

    def test_business_can_have_multiple_members(self):
        owner = User.objects.create_user( # type: ignore
            username="owner_main",
            password="testpass123",
        )
        member1 = User.objects.create_user( # type: ignore
            username="member_a",
            password="testpass123",
        )
        member2 = User.objects.create_user( # type: ignore
            username="member_b",
            password="testpass123",
        )

        b = self._create_business("A", owner)

        BusinessMember.objects.create(
            business=b,
            user=member1,
            role=BusinessMember.Role.CASHIER,
            granted_by=owner,
        )
        BusinessMember.objects.create(
            business=b,
            user=member2,
            role=BusinessMember.Role.MANAGER,
            granted_by=owner,
        )

        self.assertEqual(
            BusinessMember.objects.filter(business=b, is_active=True).count(),
            2,
        )