from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("businesses", "0013_rename_businessprofile_contact_user"),
    ]

    operations = [
        migrations.AlterField(
            model_name="businessprofile",
            name="district",
            field=models.CharField(
                choices=[("BEYLIKDUZU", "Beylikduzu")],
                default="BEYLIKDUZU",
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="businessprofile",
            name="iyzico_submerchant_type",
            field=models.CharField(blank=True, default="PERSONAL", max_length=32),
        ),
        migrations.DeleteModel(name="BusinessTransaction"),
        migrations.DeleteModel(name="BusinessWallet"),
    ]
