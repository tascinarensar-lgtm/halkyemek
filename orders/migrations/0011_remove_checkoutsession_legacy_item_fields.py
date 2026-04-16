from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0010_checkoutsession_business_fee_amount_and_more"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="checkoutsession",
            name="menu_item",
        ),
        migrations.RemoveField(
            model_name="checkoutsession",
            name="menu_item_name",
        ),
    ]
