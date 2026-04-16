from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0008b_settlementrecord_initial'),
        ('payouts', '0006_merge_0002_breakdown_and_0005_payouts'),
    ]

    operations = [
        migrations.AddField(
            model_name='settlementrecord',
            name='conversation_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='settlementrecord',
            name='match_type',
            field=models.CharField(choices=[('UNMATCHED', 'Unmatched'), ('PAYMENT_INTENT', 'Payment Intent'), ('PAYOUT', 'Payout')], default='UNMATCHED', max_length=32),
        ),
        migrations.AddField(
            model_name='settlementrecord',
            name='payment_intent',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='settlement_records', to='payments.paymentintent'),
        ),
        migrations.AddField(
            model_name='settlementrecord',
            name='payout',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='settlement_records', to='payouts.payout'),
        ),
        migrations.AddField(
            model_name='settlementrecord',
            name='provider_event',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='settlement_records', to='payments.providerevent'),
        ),
        migrations.AddField(
            model_name='settlementrecord',
            name='provider_reference',
            field=models.CharField(blank=True, db_index=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='settlementrecord',
            name='settlement_reference_code',
            field=models.CharField(blank=True, db_index=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='settlementrecord',
            name='submerchant_key',
            field=models.CharField(blank=True, db_index=True, default='', max_length=64),
        ),
        migrations.AddIndex(
            model_name='settlementrecord',
            index=models.Index(fields=['provider', 'match_type', 'created_at'], name='idx_settlement_record_match'),
        ),
        migrations.AddIndex(
            model_name='settlementrecord',
            index=models.Index(fields=['payment_intent'], name='idx_settlement_record_intent'),
        ),
        migrations.AddIndex(
            model_name='settlementrecord',
            index=models.Index(fields=['payout'], name='idx_settlement_record_payout'),
        ),
    ]
