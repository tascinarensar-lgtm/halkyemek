from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("payouts", "0009_payout_adjustment_reversal_unique"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="businessearning",
            name="amount",
        ),
    ]
