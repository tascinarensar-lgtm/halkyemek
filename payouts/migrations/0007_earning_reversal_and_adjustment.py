from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("orders", "0006_order_refund_fields"),
        ("payments", "0010_paymentreversal"),
        ("payouts", "0006_merge_0002_breakdown_and_0005_payouts"),
    ]

    operations = [
        migrations.AddField(model_name="businessearning", name="reversed_amount", field=models.PositiveBigIntegerField(default=0)),
        migrations.AddField(model_name="businessearning", name="reversed_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.CreateModel(
            name="PayoutAdjustment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("amount", models.BigIntegerField(help_text="Signed kuruş. Negative => business alacağından düşülür")),
                ("status", models.CharField(choices=[("PENDING", "Pending"), ("APPLIED", "Applied"), ("CANCELLED", "Cancelled")], default="PENDING", max_length=16)),
                ("reason_code", models.CharField(blank=True, default="", max_length=64)),
                ("description", models.CharField(blank=True, default="", max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("applied_at", models.DateTimeField(blank=True, null=True)),
                ("business", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="payout_adjustments", to="businesses.businessprofile")),
                ("order", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="payout_adjustments", to="orders.order")),
                ("payment_reversal", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="payout_adjustments", to="payments.paymentreversal")),
                ("payout", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="applied_adjustments", to="payouts.payout")),
            ],
            options={
                "indexes": [
                    models.Index(fields=["business", "status", "created_at"], name="idx_padj_business_status"),
                    models.Index(fields=["order", "created_at"], name="idx_padj_order_created"),
                ],
            },
        ),
    ]
