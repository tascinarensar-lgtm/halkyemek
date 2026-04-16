from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("businesses", "0007_businessprofile_iyzico_last_error_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="BusinessMember",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(choices=[("OWNER", "Owner"), ("MANAGER", "Manager"), ("CASHIER", "Cashier")], max_length=20)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "business",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="memberships",
                        to="businesses.businessprofile",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="business_memberships",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "granted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="granted_business_memberships",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="businessmember",
            constraint=models.UniqueConstraint(
                fields=("business", "user"),
                name="uq_business_member_business_user",
            ),
        ),
        migrations.AddIndex(
            model_name="businessmember",
            index=models.Index(fields=["user", "is_active"], name="idx_bm_user_active"),
        ),
        migrations.AddIndex(
            model_name="businessmember",
            index=models.Index(fields=["business", "is_active"], name="idx_bm_business_active"),
        ),
    ]