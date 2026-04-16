from django.db import migrations, models
from django.utils import timezone
import django.db.models.deletion


def _sync_payout_batches(apps, schema_editor):
    PayoutBatch = apps.get_model("payouts", "PayoutBatch")
    Payout = apps.get_model("payouts", "Payout")
    PayoutItem = apps.get_model("payouts", "PayoutItem")

    for batch in PayoutBatch.objects.order_by("id").iterator():
        payouts = list(Payout.objects.filter(batch_id=batch.pk).order_by("id"))
        business_ids = {p.business_id for p in payouts if p.business_id is not None}
        if not business_ids:
            raise RuntimeError(f"PayoutBatch {batch.pk} cannot be backfilled without related payouts.")
        if len(business_ids) != 1:
            raise RuntimeError(f"PayoutBatch {batch.pk} has payouts from multiple businesses.")

        batch.business_id = next(iter(business_ids))
        batch.total_amount = sum(int(p.amount or 0) for p in payouts)
        batch.earning_count = PayoutItem.objects.filter(payout__batch_id=batch.pk).count()
        batch.updated_at = timezone.now()

        old_status = (batch.status or "").upper()
        if old_status == "CREATED":
            batch.status = "DRAFT"
        elif old_status == "PROCESSING":
            batch.status = "DISPATCHED"
            batch.dispatched_at = batch.created_at
        elif old_status == "DONE":
            batch.status = "CONFIRMED"
            batch.dispatched_at = batch.created_at
            batch.confirmed_at = batch.confirmed_at or batch.created_at
        elif old_status == "FAILED":
            batch.status = "FAILED"
            batch.dispatched_at = batch.created_at
            batch.failed_at = batch.created_at

        batch.save(
            update_fields=[
                "business",
                "total_amount",
                "earning_count",
                "status",
                "dispatched_at",
                "confirmed_at",
                "failed_at",
                "updated_at",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        ("payouts", "0010_remove_businessearning_amount"),
        ("businesses", "0014_remove_businesswallet_business_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="payoutbatch",
            name="business",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="payout_batches", to="businesses.businessprofile"),
        ),
        migrations.AddField(
            model_name="payoutbatch",
            name="confirmed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="payoutbatch",
            name="dispatched_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="payoutbatch",
            name="earning_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="payoutbatch",
            name="external_batch_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=128),
        ),
        migrations.AddField(
            model_name="payoutbatch",
            name="failed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="payoutbatch",
            name="failure_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="payoutbatch",
            name="total_amount",
            field=models.BigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="payoutbatch",
            name="updated_at",
            field=models.DateTimeField(default=timezone.now),
            preserve_default=False,
        ),
        migrations.RunPython(_sync_payout_batches, migrations.RunPython.noop),
        migrations.RemoveField(model_name="payoutbatch", name="note"),
        migrations.RemoveField(model_name="payoutbatch", name="processed_at"),
        migrations.AlterField(
            model_name="businessearning",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING", "Pending"),
                    ("ELIGIBLE", "Eligible"),
                    ("IN_PAYOUT", "In payout"),
                    ("PAID", "Paid"),
                    ("FAILED", "Failed"),
                    ("REVERSED", "Reversed"),
                ],
                default="PENDING",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="payoutbatch",
            name="business",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="payout_batches", to="businesses.businessprofile"),
        ),
        migrations.AlterField(
            model_name="payoutbatch",
            name="provider",
            field=models.CharField(blank=True, default="", max_length=16),
        ),
        migrations.AlterField(
            model_name="payoutbatch",
            name="status",
            field=models.CharField(
                choices=[
                    ("DRAFT", "Draft"),
                    ("DISPATCHED", "Dispatched"),
                    ("CONFIRMED", "Confirmed"),
                    ("FAILED", "Failed"),
                ],
                default="DRAFT",
                max_length=20,
            ),
        ),
    ]
