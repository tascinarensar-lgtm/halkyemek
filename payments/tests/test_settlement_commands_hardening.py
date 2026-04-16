import csv
import os
import tempfile

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from payments.models import SettlementLine, SettlementRecord


class SettlementCommandsHardeningTests(TestCase):
    def _write_csv(self, rows):
        fd, path = tempfile.mkstemp(suffix='.csv')
        os.close(fd)
        with open(path, 'w', encoding='utf-8', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=['status', 'amount', 'currency'])
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
        return path

    def test_import_command_uses_stable_derived_external_id_for_rows_without_refs(self):
        csv_path = self._write_csv([
            {'status': 'SUCCESS', 'amount': '12.50', 'currency': 'TRY'},
        ])
        try:
            call_command('import_iyzico_settlement', csv_path)
            with self.assertRaises(CommandError):
                call_command('import_iyzico_settlement', csv_path)
        finally:
            os.remove(csv_path)

        records = SettlementRecord.objects.filter(provider='IYZICO')
        self.assertEqual(records.count(), 1)
        record = SettlementRecord.objects.get(provider='IYZICO')
        self.assertTrue(str(record.external_settlement_id).startswith('derived-'))

    def test_import_command_uses_derived_id_when_settlement_reference_missing_even_with_payment_id(self):
        fd, path = tempfile.mkstemp(suffix='.csv')
        os.close(fd)
        with open(path, 'w', encoding='utf-8', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=['status', 'amount', 'currency', 'paymentId'])
            writer.writeheader()
            writer.writerow({'status': 'SUCCESS', 'amount': '10.00', 'currency': 'TRY', 'paymentId': 'PAY-42'})
            writer.writerow({'status': 'SUCCESS', 'amount': '11.00', 'currency': 'TRY', 'paymentId': 'PAY-42'})

        try:
            call_command('import_iyzico_settlement', path)
        finally:
            os.remove(path)

        records = list(SettlementRecord.objects.order_by('id'))
        self.assertEqual(len(records), 2)
        self.assertNotEqual(records[0].external_settlement_id, records[1].external_settlement_id)
        self.assertTrue(str(records[0].external_settlement_id).startswith('derived-'))
        self.assertTrue(str(records[1].external_settlement_id).startswith('derived-'))

    def test_reprocess_command_skips_non_retryable_records(self):
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-PERM-1',
            amount=100,
            currency='TRY',
            match_type=SettlementRecord.MatchType.PAYMENT_INTENT,
            is_processed=False,
            processing_error='PAYMENT_INTENT_AMOUNT_MISMATCH: Matching payment intent amount mismatch.',
        )

        call_command('reprocess_unmatched_settlement_records', '--limit', '10')

        record = SettlementRecord.objects.get(external_settlement_id='SET-PERM-1')
        self.assertFalse(record.is_processed)
        self.assertEqual(record.processing_error, 'PAYMENT_INTENT_AMOUNT_MISMATCH: Matching payment intent amount mismatch.')

    def test_reprocess_command_retries_not_confirmable_records(self):
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-RETRY-1',
            amount=100,
            currency='TRY',
            match_type=SettlementRecord.MatchType.PAYOUT,
            is_processed=False,
            processing_error='PAYOUT_STATUS_NOT_CONFIRMABLE: Payout not confirmable from status=CREATED',
        )

        call_command('reprocess_unmatched_settlement_records', '--limit', '10')

        record = SettlementRecord.objects.get(external_settlement_id='SET-RETRY-1')
        self.assertFalse(record.is_processed)
        self.assertNotEqual(record.processing_error, 'PAYOUT_STATUS_NOT_CONFIRMABLE: Payout not confirmable from status=CREATED')
        self.assertIn('MATCHING_ENTITY_NOT_FOUND', record.processing_error)

    def test_import_command_dry_run_does_not_persist_settlement_lines(self):
        fd, path = tempfile.mkstemp(suffix='.csv')
        os.close(fd)
        with open(path, 'w', encoding='utf-8', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=['status', 'amount', 'currency', 'merchantReference'])
            writer.writeheader()
            writer.writerow({'status': 'SUCCESS', 'amount': '10.00', 'currency': 'TRY', 'merchantReference': 'REF-DRY-1'})

        try:
            call_command('import_iyzico_settlement', path, '--dry-run')
        finally:
            os.remove(path)

        self.assertFalse(SettlementRecord.objects.exists())
        self.assertFalse(SettlementLine.objects.exists())

    def test_reprocess_command_limit_applies_to_retryable_rows_not_permanent_head(self):
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-PERM-HEAD',
            amount=100,
            currency='TRY',
            is_processed=False,
            processing_error='PAYMENT_INTENT_AMOUNT_MISMATCH: Matching payment intent amount mismatch.',
        )
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-RETRY-NEXT',
            amount=100,
            currency='TRY',
            is_processed=False,
            processing_error='PAYOUT_STATUS_NOT_CONFIRMABLE: Payout not confirmable from status=CREATED',
        )

        call_command('reprocess_unmatched_settlement_records', '--limit', '1')

        permanent = SettlementRecord.objects.get(external_settlement_id='SET-PERM-HEAD')
        retryable = SettlementRecord.objects.get(external_settlement_id='SET-RETRY-NEXT')
        self.assertEqual(permanent.processing_error, 'PAYMENT_INTENT_AMOUNT_MISMATCH: Matching payment intent amount mismatch.')
        self.assertNotEqual(retryable.processing_error, 'PAYOUT_STATUS_NOT_CONFIRMABLE: Payout not confirmable from status=CREATED')

    def test_reprocess_command_tracks_retry_budget_and_next_retry_window(self):
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-RETRY-BUDGET-1',
            amount=100,
            currency='TRY',
            is_processed=False,
            processing_error='MATCHING_ENTITY_NOT_FOUND: Matching local entity not found.',
        )

        call_command('reprocess_unmatched_settlement_records', '--limit', '10')

        record = SettlementRecord.objects.get(external_settlement_id='SET-RETRY-BUDGET-1')
        self.assertEqual(int(record.retry_count), 1)
        self.assertIsNotNone(record.last_retry_at)
        self.assertIsNotNone(record.next_retry_at)
        self.assertGreater(record.next_retry_at, timezone.now())


    def test_import_command_accepts_decimal_comma_amounts(self):
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.csv', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=['amount', 'merchantReference', 'status'])
            writer.writeheader()
            writer.writerow({'amount': '10,50', 'merchantReference': 'REF-DEC-COMMA-1', 'status': 'SUCCESS'})
            path = handle.name

        try:
            call_command('import_iyzico_settlement', path)
        finally:
            os.unlink(path)

        record = SettlementRecord.objects.get(external_transaction_id='REF-DEC-COMMA-1')
        self.assertEqual(int(record.amount), 1050)
