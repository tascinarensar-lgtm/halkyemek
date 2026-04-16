from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0004_menu_schema_sync"),
    ]

    operations = [
        migrations.AlterField(
            model_name="category",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True),
        ),
        migrations.AlterField(
            model_name="category",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AlterField(
            model_name="menuitem",
            name="slug",
            field=models.SlugField(blank=True, max_length=180),
        ),
        migrations.AlterField(
            model_name="menuitem",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
    ]
