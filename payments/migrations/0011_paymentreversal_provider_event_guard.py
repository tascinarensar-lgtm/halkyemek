from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0010_paymentreversal"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="paymentreversal",
            constraint=models.UniqueConstraint(
                fields=["payment_intent", "provider_event", "reversal_type"],
                condition=Q(payment_intent__isnull=False, provider_event__isnull=False),
                name="uq_payrev_intent_provider_event_type",
            ),
        ),
    ]
