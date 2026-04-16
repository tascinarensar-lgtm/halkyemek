from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0007_paymentintent_gross_price_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="paymentintent",
            name="provider",
            field=models.CharField(
                choices=[("MOCK", "Mock"), ("IYZICO", "Iyzico")],
                default="IYZICO",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="paymentintent",
            name="provider_page_url",
            field=models.URLField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="paymentintent",
            name="provider_raw_init",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="paymentintent",
            name="provider_raw_result",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="paymentintent",
            name="provider_session_token",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
        migrations.AddIndex(
            model_name="paymentintent",
            index=models.Index(fields=["provider", "status", "created_at"], name="payments_pa_provide_a319c5_idx"),
        ),
        migrations.AddIndex(
            model_name="paymentintent",
            index=models.Index(fields=["provider_session_token"], name="idx_intent_provider_session"),
        ),
    ]
