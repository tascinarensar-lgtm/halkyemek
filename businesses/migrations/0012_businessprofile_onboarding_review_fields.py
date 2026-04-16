from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("businesses", "0011_merge_0008_branches"),
    ]

    operations = [
        migrations.AddField(
            model_name="businessprofile",
            name="iyzico_last_response",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AlterField(
            model_name="businessprofile",
            name="iyzico_submerchant_status",
            field=models.CharField(
                choices=[
                    ("DRAFT", "Draft"),
                    ("PENDING", "Pending"),
                    ("ACTIVE", "Active"),
                    ("REJECTED", "Rejected"),
                    ("NEEDS_REVIEW", "Needs review"),
                ],
                default="DRAFT",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="businessprofile",
            name="payout_onboarding_status",
            field=models.CharField(
                choices=[
                    ("NONE", "None"),
                    ("PENDING", "Pending"),
                    ("APPROVED", "Approved"),
                    ("REJECTED", "Rejected"),
                    ("NEEDS_REVIEW", "Needs review"),
                ],
                default="NONE",
                max_length=16,
            ),
        ),
    ]
