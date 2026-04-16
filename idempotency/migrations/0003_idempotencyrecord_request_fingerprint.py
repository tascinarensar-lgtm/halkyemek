from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("idempotency", "0002_rename_idempotency_user_scope_key_idx_idempotency_user_id_94bd2b_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="idempotencyrecord",
            name="request_fingerprint",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
    ]
