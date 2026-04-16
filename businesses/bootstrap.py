from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from businesses.models import BusinessProfile, MarketplaceCategory


@dataclass(frozen=True)
class MarketplaceBootstrapItem:
    slug: str
    name: str
    description: str
    sort_order: int
    is_other: bool = False


DEFAULT_MARKETPLACE_BOOTSTRAP: dict[str, tuple[MarketplaceBootstrapItem, ...]] = {
    BusinessProfile.District.BEYLIKDUZU: (
        MarketplaceBootstrapItem("tavuk-doner", "Tavuk Döner", "Uygun fiyatlı tavuk döner ve pratik menü seçenekleri.", 10),
        MarketplaceBootstrapItem("et-doner", "Et Döner", "Et döner sevenler için doyurucu ve avantajlı menüler.", 20),
        MarketplaceBootstrapItem("burger", "Burger", "Klasik ve özel burger menülerini bir araya getiren kategori.", 30),
        MarketplaceBootstrapItem("pizza", "Pizza", "Farklı boy ve içeriklerde pizza seçenekleri.", 40),
        MarketplaceBootstrapItem("pilav-tencere-yemekleri", "Pilav & Tencere Yemekleri", "Pilav, tencere yemekleri ve doyurucu tabaklar.", 50),
        MarketplaceBootstrapItem("ev-yemekleri", "Ev Yemekleri", "Esnaf usulü günlük menüler ve ev yemeği seçenekleri.", 60),
        MarketplaceBootstrapItem("kebap", "Kebap", "Kebap ve ızgara çeşitlerini bir araya getiren kategori.", 70),
        MarketplaceBootstrapItem("diger", "Diğer", "Diğer tüm özel veya ayrı sınıflanan işletmeler.", 80, is_other=True),
    ),
}


def district_bootstrap_items(district: str) -> tuple[MarketplaceBootstrapItem, ...]:
    return DEFAULT_MARKETPLACE_BOOTSTRAP.get(district, ())


def seed_marketplace_categories(*, district: str, overwrite_descriptions: bool = False) -> dict[str, object]:
    items = district_bootstrap_items(district)
    created = 0
    updated = 0
    untouched = 0
    created_slugs: list[str] = []
    updated_slugs: list[str] = []

    for item in items:
        category, was_created = MarketplaceCategory.objects.get_or_create(
            district=district,
            slug=item.slug,
            defaults={
                "name": item.name,
                "description": item.description,
                "sort_order": item.sort_order,
                "is_other": item.is_other,
                "is_active": True,
            },
        )
        if was_created:
            created += 1
            created_slugs.append(item.slug)
            continue

        dirty_fields: list[str] = []
        if category.name != item.name:
            category.name = item.name
            dirty_fields.append("name")
        if overwrite_descriptions and category.description != item.description:
            category.description = item.description
            dirty_fields.append("description")
        if category.sort_order != item.sort_order:
            category.sort_order = item.sort_order
            dirty_fields.append("sort_order")
        if category.is_other != item.is_other:
            category.is_other = item.is_other
            dirty_fields.append("is_other")
        if not category.is_active:
            category.is_active = True
            dirty_fields.append("is_active")
        if dirty_fields:
            category.save(update_fields=dirty_fields + ["updated_at"])
            updated += 1
            updated_slugs.append(item.slug)
        else:
            untouched += 1

    return {
        "district": district,
        "expected_count": len(items),
        "created": created,
        "updated": updated,
        "untouched": untouched,
        "created_slugs": created_slugs,
        "updated_slugs": updated_slugs,
    }
