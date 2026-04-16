from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payouts", "0012_payoutbatch_field_alignment"),
    ]

    operations = [
        migrations.AddField(
            model_name="payout",
            name="status_sync_attempt_count",
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
