from django.db import migrations, models


def migrate_business_users_to_customer(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.filter(role="BUSINESS").update(role="CUSTOMER")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0003_alter_user_options_user_google_email_and_more"),
    ]

    operations = [
        migrations.RunPython(migrate_business_users_to_customer, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="role",
            field=models.CharField(
                choices=[("CUSTOMER", "Customer"), ("ADMIN", "Admin")],
                default="CUSTOMER",
                max_length=20,
            ),
        ),
    ]
