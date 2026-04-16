from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("wallets", "0009_wallet_reversal_constraints"),
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
        migrations.AlterField(
            model_name="pendingwallettransaction",
            name="transaction_type",
            field=models.CharField(
                choices=[
                    ("TOPUP_PENDING", "Topup Pending"),
                    ("SETTLEMENT_OUT", "Settlement Out"),
                    ("REVERSAL_OUT", "Reversal Out"),
                ],
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="wallet",
            name="balance",
            field=models.PositiveBigIntegerField(default=0, help_text="Kuruş cinsinden kullanılabilir bakiye"),
        ),
        migrations.AlterField(
            model_name="wallet",
            name="pending_balance",
            field=models.PositiveBigIntegerField(default=0, help_text="Kuruş cinsinden settlement bekleyen bakiye"),
        ),
        migrations.AlterField(
            model_name="wallettransaction",
            name="after_balance",
            field=models.PositiveBigIntegerField(help_text="İşlem sonrası bakiye"),
        ),
        migrations.AlterField(
            model_name="wallettransaction",
            name="amount",
            field=models.BigIntegerField(help_text="Kuruş cinsinden signed işlem tutarı"),
        ),
        migrations.AlterField(
            model_name="wallettransaction",
            name="before_balance",
            field=models.PositiveBigIntegerField(help_text="İşlem öncesi bakiye"),
        ),
        migrations.AlterField(
            model_name="wallettransaction",
            name="description",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AlterField(
            model_name="wallettransaction",
            name="transaction_type",
            field=models.CharField(
                choices=[
                    ("TOP_UP", "Top Up"),
                    ("PURCHASE", "Purchase"),
                    ("REFUND", "Refund"),
                    ("ADJUSTMENT", "Adjustment"),
                    ("REVERSAL", "Reversal"),
                    ("CHARGEBACK", "Chargeback"),
                ],
                max_length=20,
            ),
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
