from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0011_paymentreversal_provider_event_guard"),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name="settlementrecord",
            name="idx_settlement_record_provider_created",
        ),
        migrations.RenameIndex(
            model_name="paymentintent",
            new_name="payments_pa_provide_460525_idx",
            old_name="payments_pa_provide_a319c5_idx",
        ),
        migrations.AddField(
            model_name="paymentintent",
            name="normalized_status",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
        migrations.AddField(
            model_name="paymentintent",
            name="processed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="paymentintent",
            name="processing_error",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AlterField(
            model_name="paymentintent",
            name="status",
            field=models.CharField(
                choices=[
                    ("INITIATED", "Initiated"),
                    ("PAID", "Paid"),
                    ("FAILED", "Failed"),
                    ("CANCELLED", "Cancelled"),
                ],
                default="INITIATED",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="providerevent",
            name="provider",
            field=models.CharField(
                choices=[("MOCK", "Mock"), ("IYZICO", "Iyzico")],
                default="MOCK",
                max_length=32,
            ),
        ),
    ]
