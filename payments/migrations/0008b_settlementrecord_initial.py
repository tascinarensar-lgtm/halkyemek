from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0006_order_refund_fields"),
        ("businesses", "0008_businessprofile_kyc_tax_office"),
        ("payments", "0008_paymentintent_provider_runtime_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="SettlementRecord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(choices=[("MOCK", "Mock"), ("IYZICO", "Iyzico")], max_length=16)),
                ("external_settlement_id", models.CharField(db_index=True, max_length=128)),
                ("external_transaction_id", models.CharField(blank=True, db_index=True, default="", max_length=128)),
                ("amount", models.BigIntegerField()),
                ("currency", models.CharField(blank=True, default="TRY", max_length=8)),
                ("raw_payload", models.JSONField(blank=True, default=dict)),
                ("is_processed", models.BooleanField(default=False)),
                ("processed_at", models.DateTimeField(blank=True, null=True)),
                ("processing_error", models.TextField(blank=True, default="")),
                ("settled_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "business",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="settlement_records",
                        to="businesses.businessprofile",
                    ),
                ),
                (
                    "order",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="settlement_records",
                        to="orders.order",
                    ),
                ),
            ],
            options={
                "indexes": [
                    models.Index(fields=["provider", "created_at"], name="idx_settlement_record_provider_created"),
                ],
            },
        ),
        migrations.AddConstraint(
            model_name="settlementrecord",
            constraint=models.UniqueConstraint(
                fields=("provider", "external_settlement_id"),
                name="uq_settlement_record_provider_external_settlement_id",
            ),
        ),
    ]
