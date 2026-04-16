from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("wallets", "0011_pendingwallet_constraint_alignment"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="pendingwallettransaction",
            name="uq_pendingtx_topup_per_payment_intent",
        ),
        migrations.RemoveConstraint(
            model_name="pendingwallettransaction",
            name="uq_pendingtx_settlement_per_payment_intent",
        ),
        migrations.AddConstraint(
            model_name="pendingwallettransaction",
            constraint=models.UniqueConstraint(
                fields=("payment_intent",),
                condition=Q(transaction_type="TOPUP_PENDING", payment_intent__isnull=False),
                name="uq_pendingtx_topup_per_payment_intent",
            ),
        ),
        migrations.AddConstraint(
            model_name="pendingwallettransaction",
            constraint=models.UniqueConstraint(
                fields=("payment_intent",),
                condition=Q(transaction_type="SETTLEMENT_OUT", payment_intent__isnull=False),
                name="uq_pendingtx_settlement_per_payment_intent",
            ),
        ),
    ]
