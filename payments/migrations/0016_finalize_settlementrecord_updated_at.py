from django.db import migrations, models
from django.utils import timezone


def populate_missing_updated_at(apps, schema_editor):
    SettlementRecord = apps.get_model("payments", "SettlementRecord")
    now = timezone.now()
    SettlementRecord.objects.filter(updated_at__isnull=True).update(updated_at=now)


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0015_settlement_import_surface"),
    ]

    operations = [
        migrations.RunPython(populate_missing_updated_at, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="settlementrecord",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
    ]
