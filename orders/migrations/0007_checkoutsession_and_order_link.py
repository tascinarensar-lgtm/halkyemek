from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("menus", "0004_menu_schema_sync"),
        ("orders", "0006_order_refund_fields"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CheckoutSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token", models.CharField(db_index=True, max_length=64, unique=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PENDING", "Pending"),
                            ("CONFIRMED", "Confirmed"),
                            ("CONSUMED", "Consumed"),
                            ("EXPIRED", "Expired"),
                            ("CANCELLED", "Cancelled"),
                        ],
                        default="PENDING",
                        max_length=20,
                    ),
                ),
                ("amount", models.PositiveIntegerField()),
                ("menu_item_name", models.CharField(max_length=160)),
                ("business_name", models.CharField(max_length=160)),
                ("expires_at", models.DateTimeField()),
                ("confirmed_at", models.DateTimeField(blank=True, null=True)),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "business",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="checkout_sessions", to="businesses.businessprofile"),
                ),
                (
                    "consumed_by",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="consumed_checkout_sessions", to=settings.AUTH_USER_MODEL),
                ),
                (
                    "menu_item",
                    models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="checkout_sessions", to="menus.menuitem"),
                ),
                (
                    "user",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="checkout_sessions", to=settings.AUTH_USER_MODEL),
                ),
            ],
        ),
        migrations.AddField(
            model_name="order",
            name="checkout_session",
            field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="order", to="orders.checkoutsession"),
        ),
        migrations.AddIndex(
            model_name="checkoutsession",
            index=models.Index(fields=["user", "status", "-created_at"], name="idx_checkout_user_status"),
        ),
        migrations.AddIndex(
            model_name="checkoutsession",
            index=models.Index(fields=["business", "status", "-created_at"], name="idx_checkout_business_status"),
        ),
        migrations.AddIndex(
            model_name="checkoutsession",
            index=models.Index(fields=["expires_at"], name="idx_checkout_expires_at"),
        ),
    ]
