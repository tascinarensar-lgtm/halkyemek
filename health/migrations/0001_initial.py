from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="JobHeartbeat",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("job_name", models.CharField(max_length=128, unique=True)),
                ("status", models.CharField(choices=[("SUCCESS", "Success"), ("FAILED", "Failed")], default="SUCCESS", max_length=16)),
                ("last_success_at", models.DateTimeField(blank=True, null=True)),
                ("last_failure_at", models.DateTimeField(blank=True, null=True)),
                ("error", models.TextField(blank=True, default="")),
                ("meta", models.JSONField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["job_name"]},
        )
    ]
