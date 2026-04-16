from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('businesses', '0008_businessmember'),
    ]

    operations = [
        migrations.AddField(
            model_name='businessprofile',
            name='is_listed',
            field=models.BooleanField(default=True),
        ),
        migrations.AddIndex(
            model_name='businessprofile',
            index=models.Index(
                fields=['district', 'is_active', 'is_approved', 'is_listed'],
                name='idx_bp_public_list',
            ),
        ),
    ]
