from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0012_paymentintent_runtime_sync"),
    ]

    operations = [
        migrations.AddField(
            model_name="settlementrecord",
            name="last_retry_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="next_retry_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="retry_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddIndex(
            model_name="settlementrecord",
            index=models.Index(
                fields=["is_processed", "next_retry_at", "id"],
                name="idx_settle_retry_window",
            ),
        ),
    ]
