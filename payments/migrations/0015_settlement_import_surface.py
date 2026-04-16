from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0014_paymentreversal_order_provider_event_guard"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SettlementImport",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("provider", models.CharField(choices=[("MOCK", "Mock"), ("IYZICO", "Iyzico")], default="IYZICO", max_length=16)),
                ("source_type", models.CharField(choices=[("COMMAND", "Command"), ("API_UPLOAD", "API Upload"), ("INBOX", "Inbox"), ("TASK", "Task")], default="COMMAND", max_length=24)),
                ("source_label", models.CharField(blank=True, default="", max_length=255)),
                ("source_metadata", models.JSONField(blank=True, default=dict)),
                ("original_filename", models.CharField(blank=True, default="", max_length=255)),
                ("storage_path", models.CharField(blank=True, default="", max_length=1024)),
                ("checksum_sha256", models.CharField(db_index=True, max_length=64)),
                ("file_size_bytes", models.BigIntegerField(default=0)),
                ("imported_by_label", models.CharField(blank=True, default="", max_length=255)),
                ("imported_at", models.DateTimeField(auto_now_add=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
                ("parse_status", models.CharField(choices=[("NOT_STARTED", "Not started"), ("PARSING", "Parsing"), ("PARSED", "Parsed"), ("FAILED", "Failed")], default="NOT_STARTED", max_length=24)),
                ("applied_status", models.CharField(choices=[("NOT_APPLIED", "Not applied"), ("APPLYING", "Applying"), ("APPLIED", "Applied"), ("FAILED", "Failed"), ("DUPLICATE_REJECTED", "Duplicate rejected")], default="NOT_APPLIED", max_length=24)),
                ("total_rows", models.PositiveIntegerField(default=0)),
                ("created_records", models.PositiveIntegerField(default=0)),
                ("duplicate_records", models.PositiveIntegerField(default=0)),
                ("processed_records", models.PositiveIntegerField(default=0)),
                ("failed_records", models.PositiveIntegerField(default=0)),
                ("skipped_rows", models.PositiveIntegerField(default=0)),
                ("unmatched_records", models.PositiveIntegerField(default=0)),
                ("retry_count", models.PositiveIntegerField(default=0)),
                ("error_message", models.TextField(blank=True, default="")),
                ("imported_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="settlement_imports", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "indexes": [
                    models.Index(fields=["provider", "imported_at"], name="idx_settlement_import_created"),
                    models.Index(fields=["parse_status", "applied_status", "id"], name="idx_settlement_import_state"),
                ],
                "constraints": [
                    models.UniqueConstraint(fields=("provider", "checksum_sha256"), name="uq_settlement_import_provider_checksum"),
                ],
            },
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="last_reviewed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="operator_note",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="review_status",
            field=models.CharField(default="OPEN", max_length=24),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="row_fingerprint",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="row_number",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="settlement_import",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="records", to="payments.settlementimport"),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="unmatched_reason_code",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="settlementrecord",
            name="updated_at",
            field=models.DateTimeField(auto_now=True, null=True),
        ),
        migrations.AddIndex(
            model_name="settlementrecord",
            index=models.Index(fields=["settlement_import", "row_number"], name="idx_settle_record_import_row"),
        ),
        migrations.AddIndex(
            model_name="settlementrecord",
            index=models.Index(fields=["review_status", "unmatched_reason_code", "id"], name="idx_settle_review_state"),
        ),
    ]
