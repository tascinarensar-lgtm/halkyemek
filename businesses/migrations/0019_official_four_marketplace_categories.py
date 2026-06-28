from django.db import migrations


OFFICIAL_CATEGORIES = (
    ("burger", "Burger", "Burger menülerini tek katalogda toplayan resmi HalkYemek kategorisi.", 10),
    ("pizza", "Pizza", "Pizza menülerini tek katalogda toplayan resmi HalkYemek kategorisi.", 20),
    ("doner", "Döner", "Döner menülerini tek katalogda toplayan resmi HalkYemek kategorisi.", 30),
    ("kebap", "Kebap", "Kebap menülerini tek katalogda toplayan resmi HalkYemek kategorisi.", 40),
)

OLD_TO_NEW_SLUGS = {
    "tavuk-doner": "doner",
    "et-doner": "doner",
}

BUSINESS_CATEGORY_FALLBACKS = {
    "tavuk döner": "Döner",
    "tavuk doner": "Döner",
    "et döner": "Döner",
    "et doner": "Döner",
    "döner": "Döner",
    "doner": "Döner",
    "burger": "Burger",
    "pizza": "Pizza",
    "kebap": "Kebap",
    "kebab": "Kebap",
}


def normalize_business_category(value):
    text = (value or "").strip()
    return BUSINESS_CATEGORY_FALLBACKS.get(text.casefold(), "Burger")


def forwards(apps, schema_editor):
    BusinessProfile = apps.get_model("businesses", "BusinessProfile")
    MarketplaceCategory = apps.get_model("businesses", "MarketplaceCategory")
    BusinessCategoryAssignment = apps.get_model("businesses", "BusinessCategoryAssignment")
    MenuItemMarketplaceCategoryAssignment = apps.get_model("menus", "MenuItemMarketplaceCategoryAssignment")

    district = "BEYLIKDUZU"
    official_by_slug = {}
    for slug, name, description, sort_order in OFFICIAL_CATEGORIES:
        category, _ = MarketplaceCategory.objects.update_or_create(
            district=district,
            slug=slug,
            defaults={
                "name": name,
                "description": description,
                "sort_order": sort_order,
                "is_active": True,
                "is_other": False,
            },
        )
        official_by_slug[slug] = category

    for old_slug, new_slug in OLD_TO_NEW_SLUGS.items():
        old_category = MarketplaceCategory.objects.filter(district=district, slug=old_slug).first()
        new_category = official_by_slug[new_slug]
        if old_category is None:
            continue

        for assignment in BusinessCategoryAssignment.objects.filter(marketplace_category=old_category):
            if assignment.is_primary and assignment.is_active:
                BusinessCategoryAssignment.objects.filter(
                    business_id=assignment.business_id,
                    is_active=True,
                    is_primary=True,
                ).update(is_primary=False)

            BusinessCategoryAssignment.objects.update_or_create(
                business_id=assignment.business_id,
                marketplace_category=new_category,
                defaults={
                    "is_primary": assignment.is_primary,
                    "is_active": assignment.is_active,
                    "sort_order": assignment.sort_order,
                },
            )

        for assignment in MenuItemMarketplaceCategoryAssignment.objects.filter(marketplace_category=old_category):
            MenuItemMarketplaceCategoryAssignment.objects.update_or_create(
                menu_item_id=assignment.menu_item_id,
                marketplace_category=new_category,
                defaults={
                    "is_primary": assignment.is_primary,
                    "sort_order": assignment.sort_order,
                },
            )

        BusinessCategoryAssignment.objects.filter(marketplace_category=old_category).delete()
        MenuItemMarketplaceCategoryAssignment.objects.filter(marketplace_category=old_category).delete()

    official_slugs = [slug for slug, _name, _description, _sort_order in OFFICIAL_CATEGORIES]
    MarketplaceCategory.objects.filter(district=district).exclude(slug__in=official_slugs).update(
        is_active=False,
        is_other=False,
    )

    for business in BusinessProfile.objects.filter(district=district):
        normalized = normalize_business_category(business.category)
        if business.category != normalized:
            business.category = normalized
            business.save(update_fields=["category"])


def backwards(apps, schema_editor):
    # The old category set was intentionally broad and is not restored automatically.
    # Keeping rollback as a no-op prevents destructive churn in business/menu assignments.
    return None


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0018_businessprofile_address_line_and_more"),
        ("menus", "0009_menuitemquota_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
