from django.db import migrations, models
from django.utils.text import slugify


def seed_menu_item_marketplace_categories(apps, schema_editor):
    MenuItem = apps.get_model("menus", "MenuItem")
    MenuItemMarketplaceCategoryAssignment = apps.get_model("menus", "MenuItemMarketplaceCategoryAssignment")
    MarketplaceCategory = apps.get_model("businesses", "MarketplaceCategory")
    BusinessCategoryAssignment = apps.get_model("businesses", "BusinessCategoryAssignment")

    for menu_item in MenuItem.objects.select_related("business", "category").all():
        district_categories = list(
            MarketplaceCategory.objects.filter(
                district=menu_item.business.district,
                is_active=True,
            ).order_by("sort_order", "id")
        )
        if not district_categories:
            continue

        category_slug = slugify(menu_item.category.name or "")
        target_category = next(
            (category for category in district_categories if category.slug == category_slug),
            None,
        )

        if target_category is None:
            business_primary = BusinessCategoryAssignment.objects.filter(
                business=menu_item.business,
                is_active=True,
                is_primary=True,
            ).select_related("marketplace_category").first()
            if business_primary is not None:
                target_category = business_primary.marketplace_category

        if target_category is None:
            target_category = next((category for category in district_categories if category.is_other), None)

        if target_category is None:
            target_category = district_categories[0]

        MenuItemMarketplaceCategoryAssignment.objects.update_or_create(
            menu_item=menu_item,
            marketplace_category=target_category,
            defaults={
                "is_primary": True,
                "sort_order": 0,
            },
        )
        BusinessCategoryAssignment.objects.update_or_create(
            business=menu_item.business,
            marketplace_category=target_category,
            defaults={
                "is_active": True,
                "is_primary": BusinessCategoryAssignment.objects.filter(
                    business=menu_item.business,
                    is_active=True,
                    is_primary=True,
                ).exclude(marketplace_category=target_category).count()
                == 0,
                "sort_order": 0,
            },
        )


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0017_businessprofile_badge_text_and_more"),
        ("menus", "0007_businessoffer_description_businessoffer_label_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="MenuItemMarketplaceCategoryAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("is_primary", models.BooleanField(default=False)),
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "marketplace_category",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="menu_item_assignments", to="businesses.marketplacecategory"),
                ),
                (
                    "menu_item",
                    models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="marketplace_category_assignments", to="menus.menuitem"),
                ),
            ],
            options={
                "ordering": ["sort_order", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="menuitemmarketplacecategoryassignment",
            index=models.Index(fields=["menu_item", "sort_order"], name="idx_mimca_menu_item"),
        ),
        migrations.AddIndex(
            model_name="menuitemmarketplacecategoryassignment",
            index=models.Index(fields=["marketplace_category", "sort_order"], name="idx_mimca_marketplace_category"),
        ),
        migrations.AddConstraint(
            model_name="menuitemmarketplacecategoryassignment",
            constraint=models.UniqueConstraint(fields=("menu_item", "marketplace_category"), name="uq_menuitem_marketplace_category_assignment"),
        ),
        migrations.AddConstraint(
            model_name="menuitemmarketplacecategoryassignment",
            constraint=models.UniqueConstraint(condition=models.Q(is_primary=True), fields=("menu_item",), name="uq_menuitem_single_primary_marketplace_category"),
        ),
        migrations.RunPython(seed_menu_item_marketplace_categories, migrations.RunPython.noop),
    ]
