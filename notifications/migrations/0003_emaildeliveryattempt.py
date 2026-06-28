from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0002_alter_notification_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="EmailDeliveryAttempt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("email_to", models.EmailField(max_length=254)),
                ("provider", models.CharField(default="EMAIL", max_length=32)),
                ("status", models.CharField(choices=[("PENDING", "Pending"), ("SENT", "Sent"), ("FAILED", "Failed")], default="PENDING", max_length=16)),
                ("error", models.TextField(blank=True, default="")),
                ("retry_count", models.PositiveIntegerField(default=0)),
                ("retry_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                ("notification", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="email_attempts", to="notifications.notification")),
            ],
        ),
        migrations.AddIndex(
            model_name="emaildeliveryattempt",
            index=models.Index(fields=["status", "retry_at"], name="idx_email_delivery_retry"),
        ),
        migrations.AddIndex(
            model_name="emaildeliveryattempt",
            index=models.Index(fields=["notification", "email_to"], name="idx_email_delivery_notif"),
        ),
    ]
