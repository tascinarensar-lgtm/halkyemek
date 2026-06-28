from django.db import migrations


OFFICIAL_CATEGORIES = (
    ("burger", "Burger", "Burger menülerini tek katalogda toplayan resmi HalkYemek kategorisi.", 10),
    ("pizza", "Pizza", "Pizza menülerini tek katalogda toplayan resmi HalkYemek kategorisi.", 20),
    ("doner", "Döner", "Döner menülerini tek katalogda toplayan resmi HalkYemek kategorisi.", 30),
    ("kebap", "Kebap", "Kebap menülerini tek katalogda toplayan resmi HalkYemek kategorisi.", 40),
)

OLD_TO_NEW_SLUGS = {
    "firin-pastane": "burger",
    "kafe-kahve-zincirleri": "burger",
    "marketler": "burger",
    "fast-food-restoranlari": "burger",
    "doner-kebap-isletmeleri": "doner",
    "tavuk-doner": "doner",
    "et-doner": "doner",
}

BUSINESS_CATEGORY_FALLBACKS = {
    "burger": "Burger",
    "pizza": "Pizza",
    "döner": "Döner",
    "doner": "Döner",
    "kebap": "Kebap",
    "kebab": "Kebap",
    "tavuk döner": "Döner",
    "tavuk doner": "Döner",
    "et döner": "Döner",
    "et doner": "Döner",
    "döner-kebap": "Döner",
    "döner-kebap işletmeleri": "Döner",
    "fast food": "Burger",
    "fast food restoranları": "Burger",
    "fırın": "Burger",
    "firin": "Burger",
    "pastane": "Burger",
    "kafe": "Burger",
    "cafe": "Burger",
    "kahve": "Burger",
    "market": "Burger",
    "marketler": "Burger",
}


def normalize_business_category(value):
    text = " ".join((value or "").split())
    return BUSINESS_CATEGORY_FALLBACKS.get(text.casefold(), "Burger")


def _move_business_assignments(old_category, new_category, BusinessCategoryAssignment):
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


def _move_menu_item_assignments(old_category, new_category, MenuItemMarketplaceCategoryAssignment):
    for assignment in MenuItemMarketplaceCategoryAssignment.objects.filter(marketplace_category=old_category):
        if assignment.is_primary:
            MenuItemMarketplaceCategoryAssignment.objects.filter(
                menu_item_id=assignment.menu_item_id,
                is_primary=True,
            ).update(is_primary=False)

        target_assignment = MenuItemMarketplaceCategoryAssignment.objects.filter(
            menu_item_id=assignment.menu_item_id,
            marketplace_category=new_category,
        ).first()
        if target_assignment is None:
            MenuItemMarketplaceCategoryAssignment.objects.create(
                menu_item_id=assignment.menu_item_id,
                marketplace_category=new_category,
                is_primary=assignment.is_primary,
                sort_order=assignment.sort_order,
            )
            continue

        update_fields = []
        if assignment.is_primary and not target_assignment.is_primary:
            target_assignment.is_primary = True
            update_fields.append("is_primary")
        if assignment.sort_order < target_assignment.sort_order:
            target_assignment.sort_order = assignment.sort_order
            update_fields.append("sort_order")
        if update_fields:
            target_assignment.save(update_fields=update_fields)


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
        if old_category is None:
            continue
        new_category = official_by_slug[new_slug]
        _move_business_assignments(old_category, new_category, BusinessCategoryAssignment)
        _move_menu_item_assignments(old_category, new_category, MenuItemMarketplaceCategoryAssignment)

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
    return None


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0020_halktasarruf_marketplace_categories"),
        ("menus", "0009_menuitemquota_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
