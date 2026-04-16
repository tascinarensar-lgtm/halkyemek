from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("orders", "0005_order_idx_order_user_created_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="refund_status",
            field=models.CharField(
                choices=[("NONE", "None"), ("PARTIAL", "Partial"), ("FULL", "Full"), ("CHARGEBACK", "Chargeback")],
                default="NONE",
                max_length=16,
            ),
        ),
        migrations.AddField(model_name="order", name="refunded_amount", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="order", name="refunded_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="order", name="chargeback_amount", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="order", name="chargeback_at", field=models.DateTimeField(blank=True, null=True)),
    ]
