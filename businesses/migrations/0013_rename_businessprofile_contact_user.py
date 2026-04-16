from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("businesses", "0012_businessprofile_onboarding_review_fields"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RenameField(
            model_name="businessprofile",
            old_name="user",
            new_name="contact_user",
        ),
        migrations.AlterField(
            model_name="businessprofile",
            name="contact_user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                help_text=(
                    "Metadata/KYC contact user only. Business authority is always derived from "
                    "BusinessMember, not from this relation."
                ),
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="contact_business_profiles",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
