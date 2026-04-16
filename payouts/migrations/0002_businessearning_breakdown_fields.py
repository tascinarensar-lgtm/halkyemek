from django.db import migrations, models


def forwards(apps, schema_editor):
    BusinessEarning = apps.get_model('payouts', 'BusinessEarning')
    for earning in BusinessEarning.objects.all().iterator():
        amount = int(getattr(earning, 'amount', 0) or 0)
        earning.gross_amount = amount
        earning.platform_fee_amount = 0
        earning.net_amount = amount
        earning.save(update_fields=['gross_amount', 'platform_fee_amount', 'net_amount'])


def backwards(apps, schema_editor):
    BusinessEarning = apps.get_model('payouts', 'BusinessEarning')
    for earning in BusinessEarning.objects.all().iterator():
        earning.amount = int(getattr(earning, 'net_amount', 0) or 0)
        earning.save(update_fields=['amount'])


class Migration(migrations.Migration):

    dependencies = [
        ('payouts', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='businessearning',
            name='gross_amount',
            field=models.PositiveBigIntegerField(default=0, help_text='Customer charged amount in kuruş'),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='businessearning',
            name='platform_fee_amount',
            field=models.PositiveBigIntegerField(default=0, help_text='Platform fee in kuruş'),
        ),
        migrations.AddField(
            model_name='businessearning',
            name='net_amount',
            field=models.PositiveBigIntegerField(default=0, help_text='Business receivable in kuruş'),
            preserve_default=False,
        ),
        migrations.RunPython(forwards, backwards),
        migrations.AlterField(
            model_name='businessearning',
            name='amount',
            field=models.PositiveBigIntegerField(help_text='Deprecated alias of net_amount'),
        ),
    ]
