from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0016_finalize_settlementrecord_updated_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="settlementimport",
            name="checksum_verified_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="settlementimport",
            name="lifecycle_events",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="lifecycle_events",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="unmatched_opened_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="unmatched_resolved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="settlementrecord",
            name="review_status",
            field=models.CharField(
                choices=[
                    ("OPEN", "Open"),
                    ("ACKNOWLEDGED", "Acknowledged"),
                    ("RETRY_SCHEDULED", "Retry Scheduled"),
                    ("RESOLVED", "Resolved"),
                    ("IGNORED", "Ignored"),
                ],
                default="OPEN",
                max_length=24,
            ),
        ),
    ]
