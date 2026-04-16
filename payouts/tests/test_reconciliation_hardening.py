from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from orders.models import Order
from payments.models import SettlementLine, SettlementRecord
from payouts.models import BusinessEarning, Payout
from payouts.reconciliation import reconcile_business
from payouts.services import PayoutService
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


class ReconciliationHardeningTests(TestCase):
    def setUp(self):
        self.customer = create_user(username='customer-recon')
        self.business = create_business(name='Biz Recon')
        self.category = create_category(business=self.business, name='Main')
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=100)
        seed_wallet(user=self.customer, amount=1000)

    def test_reconcile_business_accepts_settlement_proof_from_provider_payout_id_reference(self):
        order = Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=100,
            status=Order.Status.CREATED,
        )
        WalletService.purchase(user=self.customer, amount=100, description='buy', order=order)
        order.mark_paid(ttl_hours=24)
        order.save(update_fields=['status', 'paid_at', 'expires_at', 'qr_token'])
        earning = BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=100,
            platform_fee_amount=0,
            net_amount=100,
            currency='TRY',
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.PENDING,
        )
        PayoutService.run_eligibility_sweep()
        batch = PayoutService.create_batch_for_eligible()
        payout = Payout.objects.get(batch=batch, business=self.business)
        PayoutService.mark_payout_sent(payout_id=payout.id, provider_payout_id='REQ-RC-1')

        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-RC-1',
            external_transaction_id='REQ-RC-1',
            amount=int(payout.amount),
            currency='TRY',
            provider_reference='REQ-RC-1',
            business=self.business,
            payout=payout,
            match_type=SettlementRecord.MatchType.PAYOUT,
            is_processed=True,
            processed_at=timezone.now(),
        )

        report = reconcile_business(self.business)
        issue_types = {item['type'] for item in report.issues}
        self.assertNotIn('PAYOUT_SETTLEMENT_PROOF_MISSING', issue_types)
        earning.refresh_from_db()
        self.assertEqual(earning.status, BusinessEarning.Status.IN_PAYOUT)

    def test_reconcile_business_accepts_raw_settlement_line_as_proof(self):
        order = Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=100,
            status=Order.Status.CREATED,
        )
        WalletService.purchase(user=self.customer, amount=100, description='buy', order=order)
        order.mark_paid(ttl_hours=24)
        order.save(update_fields=['status', 'paid_at', 'expires_at', 'qr_token'])
        BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=100,
            platform_fee_amount=0,
            net_amount=100,
            currency='TRY',
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.PENDING,
        )
        PayoutService.run_eligibility_sweep()
        batch = PayoutService.create_batch_for_eligible()
        payout = Payout.objects.get(batch=batch, business=self.business)
        PayoutService.mark_payout_sent(payout_id=payout.id, provider_payout_id='REQ-RC-LINE-1')

        SettlementLine.objects.create(
            provider='IYZICO',
            line_hash='line-proof-1',
            provider_reference='REQ-RC-LINE-1',
            submerchant_key=self.business.iyzico_submerchant_key,
            amount=int(payout.amount),
        )

        report = reconcile_business(self.business)
        issue_types = {item['type'] for item in report.issues}
        self.assertNotIn('PAYOUT_SETTLEMENT_PROOF_MISSING', issue_types)


    def test_reconcile_business_groups_manual_review_codes(self):
        self.business.iyzico_submerchant_key = 'SUB-RC-MANUAL-1'
        self.business.save(update_fields=['iyzico_submerchant_key'])
        SettlementRecord.objects.create(
            provider='IYZICO',
            external_settlement_id='SET-RC-MANUAL-1',
            amount=100,
            currency='TRY',
            submerchant_key='SUB-RC-MANUAL-1',
            business=self.business,
            is_processed=False,
            processing_error='MATCHING_ENTITY_NOT_FOUND: Matching local entity not found.',
        )

        report = reconcile_business(self.business)
        self.assertEqual(report.summary['manual_review_codes']['MATCHING_ENTITY_NOT_FOUND'], 1)
        self.assertIn('processing_error_code', report.issues[-1])

    def test_reconcile_business_reports_order_accounting_drift(self):
        order = Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=110,
            subtotal_amount=100,
            customer_fee_amount=10,
            business_fee_amount=5,
            total_charged_amount=110,
            business_net_amount=95,
            item_count=1,
            pricing_snapshot={
                'subtotal_amount': 90,
                'customer_fee_amount': 10,
                'business_fee_amount': 5,
                'total_payable_amount': 100,
                'business_net_amount': 85,
                'platform_total_fee_amount': 15,
                'currency': 'TRY',
            },
            status=Order.Status.PAID,
            paid_at=timezone.now(),
            expires_at=timezone.now() + timedelta(hours=24),
        )
        BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=100,
            platform_fee_amount=5,
            net_amount=95,
            currency='TRY',
            eligible_at=timezone.now(),
            status=BusinessEarning.Status.PENDING,
        )

        report = reconcile_business(self.business)
        issue_types = {item['type'] for item in report.issues}
        self.assertIn('ORDER_PRICING_SNAPSHOT_MISMATCH', issue_types)
