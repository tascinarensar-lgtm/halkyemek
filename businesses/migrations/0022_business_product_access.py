from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("businesses", "0021_restore_halkyemek_marketplace_categories"),
    ]

    operations = [
        migrations.AddField(
            model_name="businessmember",
            name="access_halktasarruf",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="businessmember",
            name="access_halkyemek",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="businessprofile",
            name="supports_halktasarruf",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="businessprofile",
            name="supports_halkyemek",
            field=models.BooleanField(default=True),
        ),
    ]
