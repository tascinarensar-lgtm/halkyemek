from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("payouts", "0011_payoutbatch_schema_sync"),
    ]

    operations = [
        migrations.AlterField(
            model_name="payoutbatch",
            name="id",
            field=models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID"),
        ),
        migrations.AlterField(
            model_name="payoutbatch",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
    ]
