from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payouts", "0007_earning_reversal_and_adjustment"),
    ]

    operations = [
        migrations.AddField(
            model_name="payout",
            name="provider_dispatch_payload",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="payout",
            name="provider_item_reference_code",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
        migrations.AddField(
            model_name="payout",
            name="provider_status_payload",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
