from __future__ import annotations

import secrets

from django.db import migrations, models


ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


def _generate_code(length: int = 6) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def populate_cashier_codes(apps, schema_editor):
    CheckoutSession = apps.get_model("orders", "CheckoutSession")
    used_codes = set(
        code
        for code in CheckoutSession.objects.exclude(cashier_code__isnull=True).values_list("cashier_code", flat=True)
        if code
    )

    for session in CheckoutSession.objects.filter(cashier_code__isnull=True).iterator():
        code = _generate_code()
        while code in used_codes:
            code = _generate_code()
        used_codes.add(code)
        session.cashier_code = code
        session.save(update_fields=["cashier_code"])


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0012_alter_order_menu"),
    ]

    operations = [
        migrations.AddField(
            model_name="checkoutsession",
            name="cashier_code",
            field=models.CharField(blank=True, db_index=True, max_length=6, null=True, unique=True),
        ),
        migrations.RunPython(populate_cashier_codes, migrations.RunPython.noop),
    ]
