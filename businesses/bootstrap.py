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
        MarketplaceBootstrapItem("burger", "Burger", "Burger menulerini tek katalogda toplayan resmi HalkYemek kategorisi.", 10),
        MarketplaceBootstrapItem("pizza", "Pizza", "Pizza menulerini tek katalogda toplayan resmi HalkYemek kategorisi.", 20),
        MarketplaceBootstrapItem("doner", "Döner", "Doner menulerini tek katalogda toplayan resmi HalkYemek kategorisi.", 30),
        MarketplaceBootstrapItem("kebap", "Kebap", "Kebap menulerini tek katalogda toplayan resmi HalkYemek kategorisi.", 40),
    ),
}

HALKYEMEK_CATEGORY_NAMES = tuple(item.name for item in DEFAULT_MARKETPLACE_BOOTSTRAP[BusinessProfile.District.BEYLIKDUZU])
HALKTASARRUF_CATEGORY_NAMES = (
    "Fırın & Pastane",
    "Kafe & Kahve Zincirleri",
    "Marketler",
    "Fast Food Restoranları",
    "Döner-Kebap İşletmeleri",
)
OFFICIAL_MARKETPLACE_CATEGORY_NAMES = HALKYEMEK_CATEGORY_NAMES


def district_bootstrap_items(district: str) -> tuple[MarketplaceBootstrapItem, ...]:
    return DEFAULT_MARKETPLACE_BOOTSTRAP.get(district, ())


def normalize_official_business_category(value: str) -> str:
    text = " ".join((value or "").split())
    for name in OFFICIAL_MARKETPLACE_CATEGORY_NAMES:
        if text.casefold() == name.casefold():
            return name
    allowed = ", ".join(OFFICIAL_MARKETPLACE_CATEGORY_NAMES)
    raise ValueError(f"Kategori yalnızca şu resmi kategorilerden biri olabilir: {allowed}.")


def normalize_business_category_for_products(
    value: str,
    *,
    supports_halkyemek: bool,
    supports_halktasarruf: bool,
) -> str:
    text = " ".join((value or "").split())
    allowed_names: list[str] = []
    if supports_halkyemek:
        allowed_names.extend(HALKYEMEK_CATEGORY_NAMES)
    if supports_halktasarruf:
        allowed_names.extend(HALKTASARRUF_CATEGORY_NAMES)
    if not allowed_names:
        raise ValueError("En az bir ürün desteği seçilmelidir.")

    for name in allowed_names:
        if text.casefold() == name.casefold():
            return name

    allowed = ", ".join(dict.fromkeys(allowed_names))
    raise ValueError(f"Kategori seçilen ürün için yalnızca şu kategorilerden biri olabilir: {allowed}.")


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

    official_slugs = {item.slug for item in items}
    deactivated = MarketplaceCategory.objects.filter(
        district=district,
        is_active=True,
    ).exclude(slug__in=official_slugs).update(is_active=False)

    return {
        "district": district,
        "expected_count": len(items),
        "created": created,
        "updated": updated,
        "untouched": untouched,
        "deactivated": deactivated,
        "created_slugs": created_slugs,
        "updated_slugs": updated_slugs,
    }


def expected_bootstrap_slugs(district: str) -> Iterable[str]:
    return (item.slug for item in district_bootstrap_items(district))
