from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from django.utils import timezone
from django.utils.text import slugify

from accounts.models import User
from businesses.models import BusinessCategoryAssignment, BusinessMember, BusinessProfile, MarketplaceCategory
from menus.models import Category, MenuItem, MenuItemMarketplaceCategoryAssignment
from notifications.models import Device
from wallets.models import Wallet
from wallets.services import WalletService


_counter = 0


def _next(prefix: str) -> str:
    global _counter
    _counter += 1
    return f"{prefix}{_counter}"


def create_user(*, username: str | None = None, password: str = "pass", role: str = User.Role.CUSTOMER, is_staff: bool = False):
    username = username or _next("user")
    return User.objects.create_user(username=username, password=password, role=role, is_staff=is_staff)


def create_business(*, contact_user: User | None = None, name: str | None = None, district: str = BusinessProfile.District.BEYLIKDUZU,
                     is_active: bool = True, is_approved: bool = True, is_listed: bool = True,
                     category: str = "Food", adress: str = "Test address") -> BusinessProfile:
    name = name or _next("Business")
    return BusinessProfile.objects.create(
        contact_user=contact_user,
        business_name=name,
        category=category,
        adress=adress,
        district=district,
        is_active=is_active,
        is_approved=is_approved,
        is_listed=is_listed,
    )


def add_membership(*, business: BusinessProfile, user: User, role: str = BusinessMember.Role.MANAGER, granted_by: User | None = None):
    return BusinessMember.objects.create(
        business=business,
        user=user,
        role=role,
        granted_by=granted_by,
    )


def create_category(*, business: BusinessProfile, name: str | None = None, is_active: bool = True, is_visible: bool = True, sort_order: int = 1):
    return Category.objects.create(
        business=business,
        name=name or _next("Category"),
        is_active=is_active,
        is_visible=is_visible,
        sort_order=sort_order,
    )


def create_menu_item(*, business: BusinessProfile, category: Category | None = None, name: str | None = None,
                     price_amount: int = 25000, is_active: bool = True, is_visible: bool = True,
                     is_available: bool = True, slug: str | None = None, sort_order: int = 1):
    category = category or create_category(business=business)
    name = name or _next("Menu")
    item = MenuItem.objects.create(
        business=business,
        category=category,
        name=name,
        slug=slug or name.lower().replace(" ", "-"),
        price_amount=price_amount,
        is_active=is_active,
        is_visible=is_visible,
        is_available=is_available,
        sort_order=sort_order,
    )
    marketplace_category, _ = MarketplaceCategory.objects.get_or_create(
        district=business.district,
        slug=slugify(category.name),
        defaults={
            "name": category.name,
            "description": category.description,
            "sort_order": category.sort_order,
            "is_active": True,
        },
    )
    BusinessCategoryAssignment.objects.get_or_create(
        business=business,
        marketplace_category=marketplace_category,
        defaults={
            "is_active": True,
            "is_primary": not BusinessCategoryAssignment.objects.filter(
                business=business,
                is_active=True,
                is_primary=True,
            ).exists(),
            "sort_order": category.sort_order,
        },
    )
    MenuItemMarketplaceCategoryAssignment.objects.get_or_create(
        menu_item=item,
        marketplace_category=marketplace_category,
        defaults={"is_primary": True, "sort_order": 0},
    )
    return item


def seed_wallet(*, user: User, amount: int):
    wallet = Wallet.objects.get(user=user)
    if amount:
        WalletService.topup(user=user, amount=amount, description="seed")
    wallet.refresh_from_db()
    return wallet


def expired_time(minutes: int = 1):
    return timezone.now() - timedelta(minutes=minutes)


def enable_push_device(*, user: User, platform: str = Device.Platform.ANDROID, permission_granted: bool = True, is_active: bool = True):
    return Device.objects.create(
        user=user,
        platform=platform,
        fcm_token=_next("tok-"),
        permission_granted=permission_granted,
        is_active=is_active,
    )
