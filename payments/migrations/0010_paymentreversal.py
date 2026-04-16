from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("orders", "0006_order_refund_fields"),
        ("payments", "0009_settlementrecord_resolution_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="PaymentReversal",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reversal_type", models.CharField(choices=[("ORDER_REFUND", "Order Refund"), ("TOPUP_REVERSAL", "Topup Reversal"), ("CHARGEBACK", "Chargeback")], max_length=32)),
                ("status", models.CharField(choices=[("REQUESTED", "Requested"), ("APPLIED", "Applied"), ("FAILED", "Failed"), ("CANCELLED", "Cancelled")], default="REQUESTED", max_length=16)),
                ("amount", models.PositiveBigIntegerField(help_text="Kuruş")),
                ("reason_code", models.CharField(blank=True, default="", max_length=64)),
                ("note", models.CharField(blank=True, default="", max_length=255)),
                ("idempotency_key", models.CharField(max_length=96, unique=True)),
                ("wallet_effect_applied", models.BooleanField(default=False)),
                ("business_effect_applied", models.BooleanField(default=False)),
                ("failure_reason", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("applied_at", models.DateTimeField(blank=True, null=True)),
                ("order", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="payment_reversals", to="orders.order")),
                ("payment_intent", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="reversals", to="payments.paymentintent")),
                ("provider_event", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="payment_reversals", to="payments.providerevent")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="payment_reversals", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "indexes": [
                    models.Index(fields=["reversal_type", "status", "created_at"], name="idx_payrev_type_status"),
                    models.Index(fields=["payment_intent", "created_at"], name="idx_payrev_intent_created"),
                    models.Index(fields=["order", "created_at"], name="idx_payrev_order_created"),
                ],
            },
        ),
    ]
