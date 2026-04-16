from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        ("payments", "0013_settlementrecord_retry_runtime"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="paymentreversal",
            constraint=models.UniqueConstraint(
                fields=["order", "provider_event", "reversal_type"],
                condition=Q(order__isnull=False, provider_event__isnull=False),
                name="uq_payrev_order_provider_event_type",
            ),
        ),
    ]
