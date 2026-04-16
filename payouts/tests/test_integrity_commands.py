from io import StringIO
from datetime import timedelta

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from orders.models import Order
from payments.models import PaymentIntent
from payments.models import PaymentReversal, SettlementLine, SettlementRecord
from payouts.models import BusinessEarning, Payout, PayoutBatch
from test_support import create_business, create_category, create_menu_item, create_user


class IntegrityCommandsTests(TestCase):
    def test_verify_financial_integrity_runs_on_clean_test_db(self):
        stdout = StringIO()
        call_command('verify_financial_integrity', stdout=stdout)
        self.assertIn('OK: no issues found', stdout.getvalue())

    def test_report_financial_anomalies_runs_on_clean_test_db(self):
        stdout = StringIO()
        call_command('report_financial_anomalies', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)
        self.assertIn('No financial/operational anomalies detected.', stdout.getvalue())

    def test_verify_financial_integrity_flags_failed_payout_with_raw_settlement_line(self):
        business = create_business(name='Integrity Biz')
        batch = PayoutBatch.objects.create(business=business, provider='manual', status=PayoutBatch.Status.DISPATCHED)
        payout = Payout.objects.create(
            batch=batch,
            business=business,
            amount=100,
            currency='TRY',
            status='FAILED',
            idempotency_key='integrity-failed-proof-1',
            provider_reference='HY-PAYOUT-INTEGRITY-1',
        )
        SettlementLine.objects.create(
            provider='IYZICO',
            line_hash='integrity-proof-1',
            provider_reference='HY-PAYOUT-INTEGRITY-1',
            submerchant_key=business.iyzico_submerchant_key,
            amount=100,
        )

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command('verify_financial_integrity', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)

        self.assertEqual(ctx.exception.code, 2)
        self.assertIn('FAILED_PAYOUT_HAS_SETTLEMENT_PROOF', stdout.getvalue())

    def test_verify_financial_integrity_flags_failed_payout_with_processed_settlement_evidence_by_external_tx_id(self):
        business = create_business(name='Integrity TxId Biz')
        batch = PayoutBatch.objects.create(business=business, provider='manual', status=PayoutBatch.Status.DISPATCHED)
        payout = Payout.objects.create(
            batch=batch,
            business=business,
            amount=150,
            currency='TRY',
            status='FAILED',
            idempotency_key='integrity-failed-proof-txid-1',
            provider_reference='HY-PAYOUT-INTEGRITY-TXID-1',
            provider_payout_id='REQ-INTEGRITY-TXID-1',
        )
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-INTEGRITY-TXID-1',
            external_transaction_id='REQ-INTEGRITY-TXID-1',
            amount=150,
            currency='TRY',
            provider_reference='',
            payout=None,
            business=business,
            match_type=SettlementRecord.MatchType.UNMATCHED,
            is_processed=True,
            processed_at=timezone.now(),
        )

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command('verify_financial_integrity', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)

        self.assertEqual(ctx.exception.code, 2)
        self.assertIn('FAILED_PAYOUT_HAS_SETTLEMENT_PROOF', stdout.getvalue())

    def test_verify_financial_integrity_does_not_flag_late_settlement_when_raw_proof_exists(self):
        user = create_user(username='integrity-topup-proof')
        PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=500,
            status=PaymentIntent.Status.PAID,
            provider=PaymentIntent.Provider.IYZICO,
            is_processed=True,
            processed_at=timezone.now() - timedelta(days=2),
            is_settled=False,
            provider_payment_id='PAY-INTEGRITY-LATE-1',
        )
        SettlementLine.objects.create(
            provider='IYZICO',
            line_hash='late-proof-1',
            provider_reference='PAY-INTEGRITY-LATE-1',
            amount=500,
        )

        stdout = StringIO()
        call_command('verify_financial_integrity', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)
        self.assertIn('OK: no issues found', stdout.getvalue())

    def test_report_financial_anomalies_ignores_retryable_record_waiting_for_next_retry_window(self):
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-RETRY-WINDOW-1',
            amount=100,
            currency='TRY',
            is_processed=False,
            retry_count=1,
            processing_error='MATCHING_ENTITY_NOT_FOUND: Matching local entity not found.',
            next_retry_at=timezone.now() + timedelta(minutes=30),
        )

        stdout = StringIO()
        call_command('report_financial_anomalies', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)
        self.assertIn('Deferred retryable settlement records', stdout.getvalue())
        self.assertIn('No financial/operational anomalies detected.', stdout.getvalue())

    def test_verify_financial_integrity_flags_duplicate_processed_settlement_for_same_payout(self):
        business = create_business(name='Integrity Duplicate Biz')
        batch = PayoutBatch.objects.create(business=business, provider='manual', status=PayoutBatch.Status.CONFIRMED)
        payout = Payout.objects.create(
            batch=batch,
            business=business,
            amount=100,
            currency='TRY',
            status='CONFIRMED',
            idempotency_key='integrity-dup-payout-1',
            provider_reference='HY-PAYOUT-DUP-INTEGRITY-1',
            confirmed_at=timezone.now(),
        )
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-DUP-A',
            external_transaction_id='HY-PAYOUT-DUP-INTEGRITY-1',
            amount=100,
            currency='TRY',
            provider_reference='HY-PAYOUT-DUP-INTEGRITY-1',
            payout=payout,
            business=business,
            match_type=SettlementRecord.MatchType.PAYOUT,
            is_processed=True,
            processed_at=timezone.now(),
        )
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-DUP-B',
            external_transaction_id='HY-PAYOUT-DUP-INTEGRITY-1',
            amount=100,
            currency='TRY',
            provider_reference='HY-PAYOUT-DUP-INTEGRITY-1',
            payout=payout,
            business=business,
            match_type=SettlementRecord.MatchType.PAYOUT,
            is_processed=True,
            processed_at=timezone.now(),
        )

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command('verify_financial_integrity', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)

        self.assertEqual(ctx.exception.code, 2)
        self.assertIn('DUPLICATE_SETTLEMENT_PAYOUT_MATCH', stdout.getvalue())

    def test_report_financial_anomalies_does_not_flag_order_chargeback_without_wallet_effect(self):
        customer = create_user(username='anomaly-order-chargeback-customer')
        business = create_business(name='Anomaly Chargeback Biz')
        category = create_category(business=business, name='Main')
        menu_item = create_menu_item(business=business, category=category, price_amount=100)
        order = Order.objects.create(
            user=customer,
            business=business,
            menu=menu_item,
            amount=100,
            status=Order.Status.PAID,
            paid_at=timezone.now(),
            expires_at=timezone.now() + timedelta(hours=24),
        )
        PaymentReversal.objects.create(
            user=customer,
            order=order,
            reversal_type=PaymentReversal.Type.CHARGEBACK,
            status=PaymentReversal.Status.APPLIED,
            amount=100,
            idempotency_key='anomaly-chargeback-no-wallet-1',
            wallet_effect_applied=False,
            business_effect_applied=True,
            applied_at=timezone.now(),
        )

        stdout = StringIO()
        call_command('report_financial_anomalies', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)
        self.assertIn('No financial/operational anomalies detected.', stdout.getvalue())



    def test_verify_financial_integrity_flags_stale_manual_review_record(self):
        record = SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-STALE-MANUAL-1',
            amount=100,
            currency='TRY',
            is_processed=False,
            processing_error='MATCHING_ENTITY_NOT_FOUND: Matching local entity not found.',
        )
        SettlementRecord.objects.filter(pk=record.pk).update(created_at=timezone.now() - timedelta(days=2))

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command('verify_financial_integrity', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)

        self.assertEqual(ctx.exception.code, 2)
        self.assertIn('SETTLEMENT_MANUAL_REVIEW_STALE', stdout.getvalue())

    def test_report_financial_anomalies_flags_stale_manual_review_record(self):
        record = SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-STALE-ANOM-1',
            amount=100,
            currency='TRY',
            is_processed=False,
            processing_error='PAYMENT_INTENT_AMOUNT_MISMATCH: Matching payment intent amount mismatch.',
        )
        SettlementRecord.objects.filter(pk=record.pk).update(created_at=timezone.now() - timedelta(days=2))

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command('report_financial_anomalies', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)

        self.assertEqual(ctx.exception.code, 1)
        self.assertIn('SETTLEMENT_MANUAL_REVIEW_STALE', stdout.getvalue())

    def test_verify_financial_integrity_flags_processed_payout_settlement_business_mismatch(self):
        business = create_business(name='Integrity Biz Mismatch')
        other_business = create_business(name='Integrity Biz Other')
        business.iyzico_submerchant_key = 'SUB-INTEGRITY-A'
        other_business.iyzico_submerchant_key = 'SUB-INTEGRITY-B'
        business.save(update_fields=['iyzico_submerchant_key'])
        other_business.save(update_fields=['iyzico_submerchant_key'])
        batch = PayoutBatch.objects.create(business=business, provider='manual', status=PayoutBatch.Status.CONFIRMED)
        payout = Payout.objects.create(
            batch=batch,
            business=business,
            amount=100,
            currency='TRY',
            status='CONFIRMED',
            idempotency_key='integrity-payout-business-mismatch-1',
            provider_reference='HY-PAYOUT-INTEGRITY-MISMATCH-1',
            confirmed_at=timezone.now(),
        )
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-INTEGRITY-MISMATCH-1',
            external_transaction_id='HY-PAYOUT-INTEGRITY-MISMATCH-1',
            amount=100,
            currency='TRY',
            provider_reference='HY-PAYOUT-INTEGRITY-MISMATCH-1',
            payout=payout,
            business=other_business,
            submerchant_key='SUB-INTEGRITY-B',
            match_type=SettlementRecord.MatchType.PAYOUT,
            is_processed=True,
            processed_at=timezone.now(),
        )

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command('verify_financial_integrity', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)

        self.assertEqual(ctx.exception.code, 2)
        output = stdout.getvalue()
        self.assertIn('SETTLEMENT_RECORD_PAYOUT_BUSINESS_MISMATCH', output)
        self.assertIn('SETTLEMENT_RECORD_PAYOUT_SUBMERCHANT_MISMATCH', output)

    def test_verify_financial_integrity_flags_order_pricing_snapshot_drift(self):
        business = create_business(name='Integrity Pricing Drift Biz')
        category = create_category(business=business, name='Main')
        menu_item = create_menu_item(business=business, category=category, price_amount=1000)
        customer = create_user(username='integrity-pricing-customer')
        order = Order.objects.create(
            user=customer,
            business=business,
            menu=menu_item,
            amount=1100,
            subtotal_amount=1000,
            customer_fee_amount=100,
            business_fee_amount=50,
            total_charged_amount=1100,
            business_net_amount=950,
            item_count=1,
            pricing_snapshot={
                'subtotal_amount': 900,
                'customer_fee_amount': 100,
                'business_fee_amount': 50,
                'total_payable_amount': 1000,
                'business_net_amount': 850,
                'platform_total_fee_amount': 150,
                'currency': 'TRY',
            },
            status=Order.Status.PAID,
            paid_at=timezone.now(),
            expires_at=timezone.now() + timedelta(hours=24),
        )
        BusinessEarning.objects.create(
            business=business,
            order=order,
            gross_amount=1000,
            platform_fee_amount=50,
            net_amount=950,
            currency='TRY',
            eligible_at=timezone.now(),
            status=BusinessEarning.Status.PENDING,
        )

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command('verify_financial_integrity', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)

        self.assertEqual(ctx.exception.code, 2)
        self.assertIn('ORDER_PRICING_SNAPSHOT_MISMATCH', stdout.getvalue())

    def test_report_financial_anomalies_flags_earning_order_accounting_mismatch(self):
        business = create_business(name='Anomaly Earning Drift Biz')
        category = create_category(business=business, name='Main')
        menu_item = create_menu_item(business=business, category=category, price_amount=1000)
        customer = create_user(username='anomaly-earning-customer')
        order = Order.objects.create(
            user=customer,
            business=business,
            menu=menu_item,
            amount=1100,
            subtotal_amount=1000,
            customer_fee_amount=100,
            business_fee_amount=50,
            total_charged_amount=1100,
            business_net_amount=950,
            item_count=1,
            pricing_snapshot={
                'subtotal_amount': 1000,
                'customer_fee_amount': 100,
                'business_fee_amount': 50,
                'total_payable_amount': 1100,
                'business_net_amount': 950,
                'platform_total_fee_amount': 150,
                'currency': 'TRY',
            },
            status=Order.Status.PAID,
            paid_at=timezone.now(),
            expires_at=timezone.now() + timedelta(hours=24),
        )
        BusinessEarning.objects.create(
            business=business,
            order=order,
            gross_amount=999,
            platform_fee_amount=50,
            net_amount=949,
            currency='TRY',
            eligible_at=timezone.now(),
            status=BusinessEarning.Status.PENDING,
        )

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command('report_financial_anomalies', '--worker', 'test-suite', '--lock-ttl', '5', stdout=stdout)
        self.assertEqual(ctx.exception.code, 1)
        self.assertIn('EARNING_ORDER_ACCOUNTING_MISMATCH', stdout.getvalue())
