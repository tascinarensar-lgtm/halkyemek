from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0014_remove_businesswallet_business_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="businessprofile",
            name="district",
            field=models.CharField(
                choices=[("BEYLIKDUZU", "Beylikdüzü")],
                default="BEYLIKDUZU",
                max_length=32,
            ),
        ),
    ]
