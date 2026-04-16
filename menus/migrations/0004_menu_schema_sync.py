from django.db import migrations, models
from django.utils import timezone
from django.utils.text import slugify
import django.db.models.deletion


def _sync_categories_and_menuitems(apps, schema_editor):
    BusinessProfile = apps.get_model("businesses", "BusinessProfile")
    Category = apps.get_model("menus", "Category")
    MenuItem = apps.get_model("menus", "MenuItem")

    fallback_business = BusinessProfile.objects.order_by("id").first()

    for category in Category.objects.order_by("id").iterator():
        menu_items = list(MenuItem.objects.filter(category_id=category.pk).order_by("id"))
        business_ids = []
        for item in menu_items:
            if item.business_id not in business_ids:
                business_ids.append(item.business_id)

        if not business_ids:
            if fallback_business is None:
                raise RuntimeError("Cannot backfill menus.Category.business without any businesses.")
            business_ids = [fallback_business.pk]

        primary_business_id = business_ids[0]
        category.business_id = primary_business_id
        if not category.is_active:
            category.is_visible = False
        category.save(update_fields=["business", "is_visible", "updated_at"])

        for extra_business_id in business_ids[1:]:
            clone, _created = Category.objects.get_or_create(
                business_id=extra_business_id,
                name=category.name,
                defaults={
                    "description": category.description,
                    "sort_order": category.sort_order,
                    "is_active": category.is_active,
                    "is_visible": category.is_visible,
                    "created_at": category.created_at,
                    "updated_at": category.updated_at,
                },
            )
            MenuItem.objects.filter(category_id=category.pk, business_id=extra_business_id).update(category_id=clone.pk)

    for item in MenuItem.objects.select_related("category").order_by("id").iterator():
        cleaned_name = (item.name or "").strip() or f"menu-item-{item.pk}"
        base_slug = slugify(cleaned_name) or f"menu-item-{item.pk}"
        slug_candidate = base_slug
        counter = 1
        while MenuItem.objects.filter(business_id=item.business_id, slug=slug_candidate).exclude(pk=item.pk).exists():
            counter += 1
            slug_candidate = f"{base_slug}-{counter}"

        item.name = cleaned_name
        item.slug = slug_candidate
        item.sort_order = int(item.sort_order or 0)
        if not item.category.is_active:
            item.is_active = False
            item.is_visible = False
            item.is_available = False
        else:
            item.is_visible = bool(item.is_active)
            item.is_available = bool(item.is_active)
        item.save(
            update_fields=[
                "name",
                "slug",
                "sort_order",
                "is_active",
                "is_visible",
                "is_available",
                "updated_at",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0014_remove_businesswallet_business_and_more"),
        ("menus", "0003_menu_idx_menu_business_active_and_more"),
    ]

    operations = [
        migrations.RenameModel(old_name="Menu", new_name="MenuItem"),
        migrations.RenameField(model_name="menuitem", old_name="title", new_name="name"),
        migrations.RenameField(model_name="menuitem", old_name="price", new_name="price_amount"),
        migrations.AddField(
            model_name="category",
            name="business",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="categories", to="businesses.businessprofile"),
        ),
        migrations.AddField(
            model_name="category",
            name="created_at",
            field=models.DateTimeField(default=timezone.now),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="category",
            name="is_visible",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="category",
            name="sort_order",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="category",
            name="updated_at",
            field=models.DateTimeField(default=timezone.now),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="menuitem",
            name="image_url",
            field=models.URLField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="menuitem",
            name="is_available",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="menuitem",
            name="is_visible",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="menuitem",
            name="slug",
            field=models.SlugField(blank=True, default="", max_length=180),
        ),
        migrations.AddField(
            model_name="menuitem",
            name="sort_order",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="menuitem",
            name="updated_at",
            field=models.DateTimeField(default=timezone.now),
            preserve_default=False,
        ),
        migrations.RemoveField(model_name="menuitem", name="is_halkyemek_special"),
        migrations.AlterModelOptions(name="category", options={"ordering": ["sort_order", "id"]}),
        migrations.AlterModelOptions(name="menuitem", options={"ordering": ["sort_order", "id"]}),
        migrations.AlterField(
            model_name="category",
            name="description",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AlterField(
            model_name="category",
            name="name",
            field=models.CharField(max_length=120),
        ),
        migrations.AlterField(
            model_name="menuitem",
            name="business",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="menu_items", to="businesses.businessprofile"),
        ),
        migrations.AlterField(
            model_name="menuitem",
            name="category",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="menu_items", to="menus.category"),
        ),
        migrations.AlterField(
            model_name="menuitem",
            name="description",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AlterField(
            model_name="menuitem",
            name="name",
            field=models.CharField(max_length=160),
        ),
        migrations.AlterField(
            model_name="menuitem",
            name="price_amount",
            field=models.PositiveIntegerField(),
        ),
        migrations.RunPython(_sync_categories_and_menuitems, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="category",
            name="business",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="categories", to="businesses.businessprofile"),
        ),
        migrations.RemoveIndex(model_name="menuitem", name="idx_menu_business_active"),
        migrations.RemoveIndex(model_name="menuitem", name="idx_menu_category_active"),
        migrations.RemoveIndex(model_name="menuitem", name="idx_menu_active"),
        migrations.AddIndex(
            model_name="menuitem",
            index=models.Index(fields=["business", "is_active", "is_visible"], name="idx_menu_public"),
        ),
        migrations.AddIndex(
            model_name="menuitem",
            index=models.Index(fields=["category", "is_active", "is_visible"], name="idx_menu_category_public"),
        ),
        migrations.AddConstraint(
            model_name="category",
            constraint=models.UniqueConstraint(fields=("business", "name"), name="uq_category_business_name"),
        ),
        migrations.AddConstraint(
            model_name="menuitem",
            constraint=models.UniqueConstraint(
                fields=("business", "slug"),
                condition=~models.Q(slug=""),
                name="uq_menuitem_business_slug_nonempty",
            ),
        ),
    ]
