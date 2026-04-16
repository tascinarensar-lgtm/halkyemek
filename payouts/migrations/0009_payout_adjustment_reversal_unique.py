from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("payouts", "0008_payout_provider_payload_fields"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="payoutadjustment",
            constraint=models.UniqueConstraint(
                fields=["payment_reversal"],
                condition=Q(payment_reversal__isnull=False),
                name="uq_padj_payment_reversal_nonnull",
            ),
        ),
    ]
