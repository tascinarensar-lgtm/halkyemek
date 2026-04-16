from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("wallets", "0008_pendingwallettransaction_idempotency_constraints"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="wallettransaction",
            constraint=models.CheckConstraint(
                check=Q(transaction_type="REVERSAL", amount__lt=0) | ~Q(transaction_type="REVERSAL"),
                name="ck_wt_reversal_amount_negative",
            ),
        ),
        migrations.AddConstraint(
            model_name="wallettransaction",
            constraint=models.CheckConstraint(
                check=Q(transaction_type="CHARGEBACK", amount__lt=0) | ~Q(transaction_type="CHARGEBACK"),
                name="ck_wt_chargeback_amount_negative",
            ),
        ),
        migrations.AddConstraint(
            model_name="pendingwallettransaction",
            constraint=models.CheckConstraint(
                check=Q(transaction_type="REVERSAL_OUT", amount__lt=0) | ~Q(transaction_type="REVERSAL_OUT"),
                name="ck_pendingtx_reversal_amount_negative",
            ),
        ),
    ]
