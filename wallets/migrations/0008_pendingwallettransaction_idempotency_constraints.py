from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("wallets", "0007_pendingwallettransaction_and_more"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="pendingwallettransaction",
            constraint=models.UniqueConstraint(
                fields=("payment_intent",),
                condition=Q(payment_intent__isnull=False, transaction_type="TOPUP_PENDING"),
                name="uq_pendingtx_topup_per_payment_intent",
            ),
        ),
        migrations.AddConstraint(
            model_name="pendingwallettransaction",
            constraint=models.UniqueConstraint(
                fields=("payment_intent",),
                condition=Q(payment_intent__isnull=False, transaction_type="SETTLEMENT_OUT"),
                name="uq_pendingtx_settlement_per_payment_intent",
            ),
        ),
    ]
