from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("businesses", "0009_businessprofile_is_listed_and_public_index"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="businessprofile",
            name="user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                help_text="Legacy/metadata contact user. Business authority comes from BusinessMember.",
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="business_contact_profiles",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
