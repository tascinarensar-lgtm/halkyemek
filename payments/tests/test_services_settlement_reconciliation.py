from datetime import timedelta

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from orders.models import Order
from payments.models import PaymentIntent, SettlementRecord
from payments.services import create_topup_payment_intent
from payments.services_settlement import import_settlement_rows, process_settlement_record, record_settlement_row
from payouts.models import BusinessEarning, Payout, PayoutBatch, PayoutItem
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


class SettlementReconciliationTests(TestCase):
    def setUp(self):
        self.user = create_user(username='u1')
        seed_wallet(user=self.user, amount=0)
        self.business = create_business(name='Biz')
        self.category = create_category(business=self.business, name='Main')
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=900)

    def test_import_rows_settles_topup_intent(self):
        intent = create_topup_payment_intent(user=self.user, amount=1500)
        intent.status = PaymentIntent.Status.PAID
        intent.is_processed = True
        intent.provider_payment_id = 'PAY-1'
        intent.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1500, payment_intent_id=intent.pk)

        summary = import_settlement_rows(
            provider='iyzico',
            rows=[{
                'external_settlement_id': 'SET-1',
                'external_transaction_id': 'PAY-1',
                'amount': 1500,
                'currency': 'TRY',
                'paymentId': 'PAY-1',
                'settlementReferenceCode': 'SET-1',
            }],
        )

        self.assertEqual(summary.processed, 1)
        intent.refresh_from_db()
        self.assertTrue(intent.is_settled)
        self.assertEqual(intent.settlement_reference_code, 'SET-1')

        record = SettlementRecord.objects.get(external_settlement_id='SET-1')
        self.assertEqual(record.match_type, SettlementRecord.MatchType.PAYMENT_INTENT)
        self.assertEqual(getattr(record, 'payment_intent_id', None), intent.pk)
        self.assertTrue(record.is_processed)

    def test_import_rows_confirms_sent_payout(self):
        order = Order.objects.create(user=self.user, business=self.business, menu=self.menu_item, amount=900, status=Order.Status.CREATED)
        earning = BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=900,
            platform_fee_amount=0,
            net_amount=900,
            currency='TRY',
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.ELIGIBLE,
        )
        batch = PayoutBatch.objects.create(business=self.business, provider='manual', status=PayoutBatch.Status.DISPATCHED)
        payout = Payout.objects.create(
            batch=batch,
            business=self.business,
            amount=900,
            currency='TRY',
            status='SENT',
            idempotency_key='k-1',
            provider_reference='HY-PAYOUT-9',
            provider_payout_id='MANUAL-9',
            sent_at=timezone.now(),
        )
        PayoutItem.objects.create(payout=payout, earning=earning, amount=900)

        summary = import_settlement_rows(
            provider='iyzico',
            rows=[{
                'external_settlement_id': 'SET-P-1',
                'external_transaction_id': 'HY-PAYOUT-9',
                'amount': 900,
                'currency': 'TRY',
                'merchantReference': 'HY-PAYOUT-9',
            }],
        )

        self.assertEqual(summary.processed, 1)
        payout.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(payout.status, 'CONFIRMED')
        self.assertEqual(earning.status, BusinessEarning.Status.PAID)

        record = SettlementRecord.objects.get(external_settlement_id='SET-P-1')
        self.assertEqual(record.match_type, SettlementRecord.MatchType.PAYOUT)
        self.assertEqual(getattr(record, 'payout_id', None), payout.pk)
        self.assertEqual(getattr(record, 'business_id', None), self.business.pk)

    def test_import_rows_marks_error_when_no_match(self):
        summary = import_settlement_rows(
            provider='iyzico',
            rows=[{
                'external_settlement_id': 'SET-X',
                'external_transaction_id': 'UNKNOWN',
                'amount': 500,
                'currency': 'TRY',
            }],
        )
        self.assertEqual(summary.errors, 1)
        record = SettlementRecord.objects.get(external_settlement_id='SET-X')
        self.assertEqual(record.is_processed, False)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.UNMATCHED)
        self.assertEqual(record.processing_error, 'MATCHING_ENTITY_NOT_FOUND: Matching local entity not found.')

    def test_record_settlement_row_rejects_conflicting_duplicate_amount(self):
        record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-DUP',
            external_transaction_id='PAY-9',
            amount=1000,
            currency='TRY',
            raw_payload={'paymentId': 'PAY-9'},
        )

        with self.assertRaises(ValidationError):
            record_settlement_row(
                provider='iyzico',
                external_settlement_id='SET-DUP',
                external_transaction_id='PAY-9',
                amount=1200,
                currency='TRY',
                raw_payload={'paymentId': 'PAY-9'},
            )

    def test_record_settlement_row_rejects_identifier_drift_even_when_unprocessed(self):
        record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-DRIFT-UNPROCESSED-1',
            external_transaction_id='PAY-DRIFT-1',
            amount=1000,
            currency='TRY',
            raw_payload={'paymentId': 'PAY-DRIFT-1', 'merchantReference': 'REF-DRIFT-1'},
        )

        with self.assertRaises(ValidationError):
            record_settlement_row(
                provider='iyzico',
                external_settlement_id='SET-DRIFT-UNPROCESSED-1',
                external_transaction_id='PAY-DRIFT-2',
                amount=1000,
                currency='TRY',
                raw_payload={'paymentId': 'PAY-DRIFT-2', 'merchantReference': 'REF-DRIFT-1'},
            )

    def test_process_settlement_record_keeps_manual_review_state_on_amount_mismatch(self):
        intent = create_topup_payment_intent(user=self.user, amount=1500)
        intent.status = PaymentIntent.Status.PAID
        intent.is_processed = True
        intent.provider_payment_id = 'PAY-MIS'
        intent.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1500, payment_intent_id=intent.pk)

        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-MIS',
            external_transaction_id='PAY-MIS',
            amount=1600,
            currency='TRY',
            raw_payload={'paymentId': 'PAY-MIS'},
        )

        with self.assertRaises(Exception):
            process_settlement_record(record)

        record.refresh_from_db()
        self.assertFalse(record.is_processed)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.PAYMENT_INTENT)
        self.assertEqual(record.processing_error, 'PAYMENT_INTENT_AMOUNT_MISMATCH: Matching payment intent amount mismatch.')

    def test_process_settlement_record_marks_manual_review_when_payment_intent_not_ready(self):
        intent = create_topup_payment_intent(user=self.user, amount=1100)
        intent.provider_payment_id = 'PAY-NOT-READY-1'
        intent.status = PaymentIntent.Status.INITIATED
        intent.is_processed = False
        intent.save(update_fields=['provider_payment_id', 'status', 'is_processed', 'updated_at'])

        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-NOT-READY-1',
            external_transaction_id='PAY-NOT-READY-1',
            amount=1100,
            currency='TRY',
            raw_payload={'paymentId': 'PAY-NOT-READY-1'},
        )

        with self.assertRaises(Exception):
            process_settlement_record(record)

        record.refresh_from_db()
        self.assertFalse(record.is_processed)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.PAYMENT_INTENT)
        self.assertIn('PAYMENT_INTENT_NOT_READY', record.processing_error)

    def test_import_rows_matches_payout_by_provider_item_reference_code(self):
        order = Order.objects.create(user=self.user, business=self.business, menu=self.menu_item, amount=900, status=Order.Status.CREATED)
        earning = BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=900,
            platform_fee_amount=0,
            net_amount=900,
            currency='TRY',
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.ELIGIBLE,
        )
        batch = PayoutBatch.objects.create(business=self.business, provider='manual', status=PayoutBatch.Status.DISPATCHED)
        payout = Payout.objects.create(
            batch=batch,
            business=self.business,
            amount=900,
            currency='TRY',
            status='SENT',
            idempotency_key='k-item-1',
            provider_reference='HY-PAYOUT-ITEM-BASE',
            provider_item_reference_code='IYZ-ITEM-900',
            provider_payout_id='REQ-900',
            sent_at=timezone.now(),
        )
        PayoutItem.objects.create(payout=payout, earning=earning, amount=900)

        summary = import_settlement_rows(
            provider='iyzico',
            rows=[{
                'external_settlement_id': 'SET-ITEM-1',
                'external_transaction_id': 'IYZ-ITEM-900',
                'amount': 900,
                'currency': 'TRY',
                'merchantReference': 'IYZ-ITEM-900',
            }],
        )

        self.assertEqual(summary.processed, 1)
        payout.refresh_from_db()
        self.assertEqual(payout.status, 'CONFIRMED')

        record = SettlementRecord.objects.get(external_settlement_id='SET-ITEM-1')
        self.assertEqual(record.match_type, SettlementRecord.MatchType.PAYOUT)
        self.assertEqual(getattr(record, 'payout_id', None), payout.pk)

    def test_import_rows_recovers_failed_payout_when_late_settlement_arrives(self):
        order = Order.objects.create(user=self.user, business=self.business, menu=self.menu_item, amount=700, status=Order.Status.CREATED)
        earning = BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=700,
            platform_fee_amount=0,
            net_amount=700,
            currency='TRY',
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.ELIGIBLE,
        )
        batch = PayoutBatch.objects.create(business=self.business, provider='manual', status=PayoutBatch.Status.DISPATCHED)
        payout = Payout.objects.create(
            batch=batch,
            business=self.business,
            amount=700,
            currency='TRY',
            status='FAILED',
            idempotency_key='k-late-1',
            provider_reference='HY-PAYOUT-LATE-1',
            provider_payout_id='REQ-LATE-1',
            sent_at=timezone.now(),
        )
        PayoutItem.objects.create(payout=payout, earning=earning, amount=700)

        summary = import_settlement_rows(
            provider='iyzico',
            rows=[{
                'external_settlement_id': 'SET-LATE-1',
                'external_transaction_id': 'REQ-LATE-1',
                'amount': 700,
                'currency': 'TRY',
                'merchantReference': 'REQ-LATE-1',
            }],
        )

        self.assertEqual(summary.processed, 1)
        payout.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(payout.status, 'CONFIRMED')
        self.assertEqual(earning.status, BusinessEarning.Status.PAID)

    def test_import_rows_marks_manual_review_when_late_settlement_matches_failed_payout_without_items(self):
        batch = PayoutBatch.objects.create(business=self.business, provider='manual', status=PayoutBatch.Status.DISPATCHED)
        payout = Payout.objects.create(
            batch=batch,
            business=self.business,
            amount=700,
            currency='TRY',
            status='FAILED',
            idempotency_key='k-late-no-items-1',
            provider_reference='HY-PAYOUT-LATE-NO-ITEMS-1',
            provider_payout_id='REQ-LATE-NO-ITEMS-1',
            sent_at=timezone.now(),
        )

        summary = import_settlement_rows(
            provider='iyzico',
            rows=[{
                'external_settlement_id': 'SET-LATE-NO-ITEMS-1',
                'external_transaction_id': 'REQ-LATE-NO-ITEMS-1',
                'amount': 700,
                'currency': 'TRY',
                'merchantReference': 'REQ-LATE-NO-ITEMS-1',
            }],
        )

        self.assertEqual(summary.errors, 1)
        payout.refresh_from_db()
        self.assertEqual(payout.status, 'FAILED')
        record = SettlementRecord.objects.get(external_settlement_id='SET-LATE-NO-ITEMS-1')
        self.assertFalse(record.is_processed)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.PAYOUT)
        self.assertIn('PAYOUT_MATCH_ERROR', record.processing_error)

    def test_process_settlement_record_does_not_treat_numeric_external_id_as_local_intent_id(self):
        local_intent = create_topup_payment_intent(user=self.user, amount=1000)
        local_intent.status = PaymentIntent.Status.PAID
        local_intent.is_processed = True
        local_intent.save(update_fields=['status', 'is_processed', 'updated_at'])

        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-NUM-1',
            external_transaction_id=str(local_intent.pk),
            amount=1000,
            currency='TRY',
            raw_payload={'paymentId': str(local_intent.pk)},
        )

        with self.assertRaises(Exception):
            process_settlement_record(record)

        record.refresh_from_db()
        self.assertFalse(record.is_processed)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.UNMATCHED)
        self.assertIn('MATCHING_ENTITY_NOT_FOUND', record.processing_error)

    def test_process_settlement_record_marks_partial_provider_response_for_payout(self):
        order = Order.objects.create(user=self.user, business=self.business, menu=self.menu_item, amount=900, status=Order.Status.CREATED)
        earning = BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=900,
            platform_fee_amount=0,
            net_amount=900,
            currency='TRY',
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.ELIGIBLE,
        )
        batch = PayoutBatch.objects.create(business=self.business, provider='manual', status=PayoutBatch.Status.DISPATCHED)
        payout = Payout.objects.create(
            batch=batch,
            business=self.business,
            amount=900,
            currency='TRY',
            status='SENT',
            idempotency_key='k-partial-1',
            provider_reference='HY-PAYOUT-PARTIAL-1',
            provider_payout_id='REQ-PARTIAL-1',
            sent_at=timezone.now(),
        )
        PayoutItem.objects.create(payout=payout, earning=earning, amount=900)

        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-PARTIAL-1',
            external_transaction_id='REQ-PARTIAL-1',
            amount=300,
            currency='TRY',
            raw_payload={'merchantReference': 'REQ-PARTIAL-1'},
        )

        with self.assertRaises(Exception):
            process_settlement_record(record)

        record.refresh_from_db()
        payout.refresh_from_db()
        self.assertFalse(record.is_processed)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.PAYOUT)
        self.assertEqual(getattr(record, 'payout_id', None), payout.pk)
        self.assertIn('PARTIAL_PROVIDER_RESPONSE', record.processing_error)
        self.assertEqual(payout.status, 'SENT')

    def test_record_settlement_row_rejects_identifier_drift_for_processed_record(self):
        intent = create_topup_payment_intent(user=self.user, amount=1500)
        intent.status = PaymentIntent.Status.PAID
        intent.is_processed = True
        intent.provider_payment_id = 'PAY-IMM-1'
        intent.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1500, payment_intent_id=intent.pk)

        summary = import_settlement_rows(
            provider='iyzico',
            rows=[{
                'external_settlement_id': 'SET-IMM-1',
                'external_transaction_id': 'PAY-IMM-1',
                'amount': 1500,
                'currency': 'TRY',
                'paymentId': 'PAY-IMM-1',
                'merchantReference': 'REF-IMM-ORIG',
            }],
        )
        self.assertEqual(summary.processed, 1)

        with self.assertRaises(ValidationError):
            record_settlement_row(
                provider='iyzico',
                external_settlement_id='SET-IMM-1',
                external_transaction_id='PAY-IMM-1',
                amount=1500,
                currency='TRY',
                raw_payload={
                    'paymentId': 'PAY-IMM-1',
                    'merchantReference': 'REF-IMM-CHANGED',
                },
            )

    def test_process_settlement_record_does_not_use_legacy_snake_case_reference_aliases(self):
        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-LEGACY-ALIAS-1',
            external_transaction_id='',
            amount=500,
            currency='TRY',
            raw_payload={
                'provider_reference': 'LEGACY-REF-1',
                'settlement_reference_code': 'LEGACY-SET-1',
                'payment_conversation_id': 'LEGACY-CONV-1',
                'sub_merchant_key': 'LEGACY-SUB-1',
            },
        )

        with self.assertRaises(Exception):
            process_settlement_record(record)

        record.refresh_from_db()
        self.assertFalse(record.is_processed)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.UNMATCHED)
        self.assertEqual(record.provider_reference, '')
        self.assertEqual(record.conversation_id, '')
        self.assertEqual(record.submerchant_key, '')
        self.assertIn('MATCHING_ENTITY_NOT_FOUND', record.processing_error)

    def test_process_settlement_record_marks_manual_review_for_ambiguous_payment_intent_match(self):
        intent_a = create_topup_payment_intent(user=self.user, amount=1000)
        intent_a.status = PaymentIntent.Status.PAID
        intent_a.is_processed = True
        intent_a.provider_payment_id = 'PAY-AMB-1'
        intent_a.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1000, payment_intent_id=intent_a.pk)

        intent_b = create_topup_payment_intent(user=self.user, amount=1000)
        intent_b.status = PaymentIntent.Status.PAID
        intent_b.is_processed = True
        intent_b.provider_payment_id = 'PAY-AMB-1'
        intent_b.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1000, payment_intent_id=intent_b.pk)

        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-AMB-1',
            external_transaction_id='PAY-AMB-1',
            amount=1000,
            currency='TRY',
            raw_payload={'paymentId': 'PAY-AMB-1'},
        )

        with self.assertRaises(Exception):
            process_settlement_record(record)

        record.refresh_from_db()
        self.assertFalse(record.is_processed)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.UNMATCHED)
        self.assertIn('AMBIGUOUS_PAYMENT_INTENT_MATCH', record.processing_error)

    def test_process_settlement_record_marks_manual_review_for_duplicate_payout_settlement_match(self):
        order = Order.objects.create(user=self.user, business=self.business, menu=self.menu_item, amount=900, status=Order.Status.CREATED)
        earning = BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=900,
            platform_fee_amount=0,
            net_amount=900,
            currency='TRY',
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.PAID,
            paid_at=timezone.now(),
        )
        batch = PayoutBatch.objects.create(business=self.business, provider='manual', status=PayoutBatch.Status.CONFIRMED)
        payout = Payout.objects.create(
            batch=batch,
            business=self.business,
            amount=900,
            currency='TRY',
            status='CONFIRMED',
            idempotency_key='k-dup-settle-1',
            provider_reference='HY-PAYOUT-DUP-1',
            provider_payout_id='REQ-DUP-1',
            sent_at=timezone.now(),
            confirmed_at=timezone.now(),
        )
        PayoutItem.objects.create(payout=payout, earning=earning, amount=900)
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-DUP-EXISTING-1',
            external_transaction_id='REQ-DUP-1',
            amount=900,
            currency='TRY',
            provider_reference='REQ-DUP-1',
            business=self.business,
            payout=payout,
            match_type=SettlementRecord.MatchType.PAYOUT,
            is_processed=True,
            processed_at=timezone.now(),
        )

        duplicate_record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-DUP-NEW-1',
            external_transaction_id='REQ-DUP-1',
            amount=900,
            currency='TRY',
            raw_payload={'merchantReference': 'REQ-DUP-1'},
        )

        with self.assertRaises(Exception):
            process_settlement_record(duplicate_record)

        duplicate_record.refresh_from_db()
        self.assertFalse(duplicate_record.is_processed)
        self.assertEqual(duplicate_record.match_type, SettlementRecord.MatchType.PAYOUT)
        self.assertIn('DUPLICATE_SETTLEMENT_MATCH', duplicate_record.processing_error)


    def test_process_settlement_record_links_business_from_submerchant_key_on_payment_intent_path(self):
        self.business.iyzico_submerchant_key = 'SUB-SETTLE-PI-1'
        self.business.save(update_fields=['iyzico_submerchant_key'])

        intent = create_topup_payment_intent(user=self.user, amount=1100)
        intent.status = PaymentIntent.Status.PAID
        intent.is_processed = True
        intent.provider_payment_id = 'PAY-SUB-PI-1'
        intent.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1100, payment_intent_id=intent.pk)

        summary = import_settlement_rows(
            provider='iyzico',
            rows=[{
                'external_settlement_id': 'SET-SUB-PI-1',
                'external_transaction_id': 'PAY-SUB-PI-1',
                'amount': 1100,
                'currency': 'TRY',
                'paymentId': 'PAY-SUB-PI-1',
                'subMerchantKey': 'SUB-SETTLE-PI-1',
            }],
        )

        self.assertEqual(summary.processed, 1)
        record = SettlementRecord.objects.get(external_settlement_id='SET-SUB-PI-1')
        self.assertEqual(record.business_id, self.business.id)
        self.assertEqual(record.payment_intent_id, intent.id)

    def test_process_settlement_record_matches_payment_intent_by_settlement_reference_code(self):
        intent = create_topup_payment_intent(user=self.user, amount=1300)
        intent.status = PaymentIntent.Status.PAID
        intent.is_processed = True
        intent.provider_payment_id = 'PAY-SETTLE-REF-1'
        intent.settlement_reference_code = 'SETTLE-REF-PI-1'
        intent.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'settlement_reference_code', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1300, payment_intent_id=intent.pk)

        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SETTLE-REF-PI-1',
            external_transaction_id='',
            amount=1300,
            currency='TRY',
            raw_payload={'settlementReferenceCode': 'SETTLE-REF-PI-1'},
        )

        processed = process_settlement_record(record)
        self.assertTrue(processed)
        record.refresh_from_db()
        self.assertTrue(record.is_processed)
        self.assertEqual(record.payment_intent_id, intent.id)



    def test_process_settlement_record_marks_manual_review_on_submerchant_key_mismatch(self):
        self.business.iyzico_submerchant_key = 'SUB-BIZ-1'
        self.business.save(update_fields=['iyzico_submerchant_key'])
        other_business = create_business(name='Other Biz')
        other_business.iyzico_submerchant_key = 'SUB-BIZ-2'
        other_business.save(update_fields=['iyzico_submerchant_key'])

        intent = create_topup_payment_intent(user=self.user, amount=1200)
        intent.status = PaymentIntent.Status.PAID
        intent.is_processed = True
        intent.provider_payment_id = 'PAY-SUBMIS-1'
        intent.submerchant_key = 'SUB-BIZ-1'
        intent.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'submerchant_key', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1200, payment_intent_id=intent.pk)

        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-SUBMIS-1',
            external_transaction_id='PAY-SUBMIS-1',
            amount=1200,
            currency='TRY',
            raw_payload={'paymentId': 'PAY-SUBMIS-1', 'subMerchantKey': 'SUB-BIZ-2'},
        )

        with self.assertRaises(Exception):
            process_settlement_record(record)

        record.refresh_from_db()
        self.assertFalse(record.is_processed)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.PAYMENT_INTENT)
        self.assertIn('SUBMERCHANT_KEY_MISMATCH', record.processing_error)

    def test_process_settlement_record_marks_manual_review_on_cross_entity_match_conflict(self):
        intent = create_topup_payment_intent(user=self.user, amount=900)
        intent.status = PaymentIntent.Status.PAID
        intent.is_processed = True
        intent.provider_payment_id = 'PAY-CROSS-1'
        intent.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=900, payment_intent_id=intent.pk)

        order = Order.objects.create(user=self.user, business=self.business, menu=self.menu_item, amount=900, status=Order.Status.CREATED)
        earning = BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=900,
            platform_fee_amount=0,
            net_amount=900,
            currency='TRY',
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.ELIGIBLE,
        )
        batch = PayoutBatch.objects.create(business=self.business, provider='manual', status=PayoutBatch.Status.DISPATCHED)
        payout = Payout.objects.create(
            batch=batch,
            business=self.business,
            amount=900,
            currency='TRY',
            status='SENT',
            idempotency_key='k-cross-1',
            provider_reference='PAY-CROSS-1',
            sent_at=timezone.now(),
        )
        PayoutItem.objects.create(payout=payout, earning=earning, amount=900)

        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-CROSS-1',
            external_transaction_id='PAY-CROSS-1',
            amount=900,
            currency='TRY',
            raw_payload={'paymentId': 'PAY-CROSS-1', 'merchantReference': 'PAY-CROSS-1'},
        )

        with self.assertRaises(Exception):
            process_settlement_record(record)

        record.refresh_from_db()
        self.assertFalse(record.is_processed)
        self.assertIn('CROSS_ENTITY_MATCH_CONFLICT', record.processing_error)
        self.assertEqual(record.payment_intent_id, intent.pk)
        self.assertEqual(record.payout_id, payout.pk)

    def test_settlement_retryability_marks_missing_reference_and_partial_provider_as_permanent(self):
        from payments.services_settlement import is_retryable_settlement_error

        self.assertFalse(is_retryable_settlement_error('MISSING_REFERENCE_DATA: Provider row does not include matchable identifiers.'))
        self.assertFalse(is_retryable_settlement_error('PARTIAL_PROVIDER_RESPONSE: Settlement amount=100 payout amount=200'))
        self.assertFalse(is_retryable_settlement_error('PAYOUT_MATCH_ERROR: Payout match is ambiguous across multiple candidates.'))

    def test_settlement_record_evidence_for_payout_ignores_processed_payment_intent_record(self):
        from payments.settlement_proof import has_settlement_record_evidence_for_payout, normalized_references

        intent = create_topup_payment_intent(user=self.user, amount=900)
        intent.status = PaymentIntent.Status.PAID
        intent.is_processed = True
        intent.provider_payment_id = 'SHARED-REF-1'
        intent.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])

        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-SHARED-INTENT-1',
            external_transaction_id='SHARED-REF-1',
            amount=900,
            currency='TRY',
            provider_reference='SHARED-REF-1',
            payment_intent=intent,
            match_type=SettlementRecord.MatchType.PAYMENT_INTENT,
            is_processed=True,
            processed_at=timezone.now(),
        )

        batch = PayoutBatch.objects.create(business=self.business, provider='manual', status=PayoutBatch.Status.DISPATCHED)
        payout = Payout.objects.create(
            batch=batch,
            business=self.business,
            amount=900,
            currency='TRY',
            status='FAILED',
            idempotency_key='shared-proof-1',
            provider_reference='SHARED-REF-1',
        )

        self.assertFalse(
            has_settlement_record_evidence_for_payout(
                payout=payout,
                references=normalized_references(payout.provider_reference),
            )
        )


    def test_process_settlement_record_marks_manual_review_for_conflicting_payment_intent_identifiers(self):
        intent_a = create_topup_payment_intent(user=self.user, amount=1000)
        intent_a.status = PaymentIntent.Status.PAID
        intent_a.is_processed = True
        intent_a.provider_payment_id = 'PAY-CONFLICT-PI-1'
        intent_a.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1000, payment_intent_id=intent_a.pk)

        intent_b = create_topup_payment_intent(user=self.user, amount=1000)
        intent_b.status = PaymentIntent.Status.PAID
        intent_b.is_processed = True
        intent_b.marketplace_conversation_id = 'HY-PI-CONFLICT-1'
        intent_b.save(update_fields=['status', 'is_processed', 'marketplace_conversation_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1000, payment_intent_id=intent_b.pk)

        record, _ = record_settlement_row(
            provider='iyzico',
            external_settlement_id='SET-CONFLICT-PI-1',
            external_transaction_id='PAY-CONFLICT-PI-1',
            amount=1000,
            currency='TRY',
            raw_payload={
                'paymentId': 'PAY-CONFLICT-PI-1',
                'conversationId': 'HY-PI-CONFLICT-1',
            },
        )

        with self.assertRaises(Exception):
            process_settlement_record(record)

        record.refresh_from_db()
        self.assertFalse(record.is_processed)
        self.assertEqual(record.match_type, SettlementRecord.MatchType.UNMATCHED)
        self.assertIn('AMBIGUOUS_PAYMENT_INTENT_MATCH', record.processing_error)

    def test_process_settlement_record_clears_retry_state_after_successful_reprocess(self):
        intent = create_topup_payment_intent(user=self.user, amount=1250)
        intent.status = PaymentIntent.Status.PAID
        intent.is_processed = True
        intent.provider_payment_id = 'PAY-RETRY-CLEAR-1'
        intent.save(update_fields=['status', 'is_processed', 'provider_payment_id', 'updated_at'])
        WalletService.topup_pending(user=self.user, amount=1250, payment_intent_id=intent.pk)

        record = SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-RETRY-CLEAR-1',
            external_transaction_id='PAY-RETRY-CLEAR-1',
            amount=1250,
            currency='TRY',
            provider_reference='PAY-RETRY-CLEAR-1',
            retry_count=4,
            next_retry_at=timezone.now() + timedelta(hours=1),
            processing_error='MATCHING_ENTITY_NOT_FOUND: Matching local entity not found.',
            raw_payload={'paymentId': 'PAY-RETRY-CLEAR-1'},
        )

        processed = process_settlement_record(record)
        self.assertTrue(processed)
        record.refresh_from_db()
        self.assertTrue(record.is_processed)
        self.assertEqual(record.retry_count, 0)
        self.assertIsNone(record.next_retry_at)
