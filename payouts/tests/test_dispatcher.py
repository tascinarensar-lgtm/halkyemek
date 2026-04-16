from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from orders.models import Order
from payments.models import ProviderEvent, SettlementRecord
from payments.services_reversals import PaymentReversalService
from payouts.models import BusinessEarning, Payout, PayoutItem
from payouts.models import PayoutAdjustment
from payouts.providers.iyzico_marketplace_payout import PayoutStatusResult
from payouts.services import PayoutService
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.services import WalletService


class DispatcherTests(TestCase):
    def setUp(self):
        self.customer = create_user(username="customer")
        self.business = create_business(name="Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=100)
        seed_wallet(user=self.customer, amount=1000)
        order = Order.objects.create(user=self.customer, business=self.business, menu=self.menu_item, amount=100, status=Order.Status.CREATED)
        WalletService.purchase(user=self.customer, amount=100, description="buy", order=order)
        order.mark_paid(ttl_hours=24)
        order.save(update_fields=["status", "paid_at", "expires_at", "qr_token"])
        BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=100,
            platform_fee_amount=0,
            net_amount=100,
            currency="TRY",
            eligible_at=timezone.now() - timedelta(days=1),
            status=BusinessEarning.Status.ELIGIBLE,
        )
        self.batch = PayoutService.create_batch_for_eligible()
        self.payout = Payout.objects.get(batch=self.batch)

    def test_dispatch_due_payouts_marks_sent(self):
        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")
        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")

    def test_stale_dispatch_lock_exhaustion_releases_earning(self):
        self.payout.status = "DISPATCHING"
        self.payout.locked_at = timezone.now() - timedelta(hours=2)
        self.payout.attempt_count = 8
        self.payout.save(update_fields=["status", "locked_at", "attempt_count"])

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 0)
        self.payout.refresh_from_db()
        earning_id = PayoutItem.objects.filter(payout=self.payout).values_list("earning_id", flat=True).get()
        earning = BusinessEarning.objects.get(pk=earning_id)
        self.assertEqual(self.payout.status, "FAILED")
        self.assertIsNone(self.payout.next_retry_at)
        self.assertEqual(earning.status, BusinessEarning.Status.ELIGIBLE)

    def test_stale_dispatch_lock_with_provider_id_moves_to_sent_for_sync(self):
        self.payout.status = "DISPATCHING"
        self.payout.locked_at = timezone.now() - timedelta(hours=2)
        self.payout.provider_payout_id = "req-123"
        self.payout.save(update_fields=["status", "locked_at", "provider_payout_id"])

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 0)
        self.payout.refresh_from_db()
        earning_id = PayoutItem.objects.filter(payout=self.payout).values_list("earning_id", flat=True).get()
        earning = BusinessEarning.objects.get(pk=earning_id)
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.last_error_code, "LOCK_STALE_RECOVERED")
        self.assertIsNotNone(self.payout.sent_at)
        self.assertIn("stale_lock_recovery", self.payout.provider_dispatch_payload)
        self.assertEqual(earning.status, BusinessEarning.Status.IN_PAYOUT)

    def test_stale_dispatch_lock_without_provider_id_consumes_retry_budget(self):
        self.payout.status = "DISPATCHING"
        self.payout.locked_at = timezone.now() - timedelta(hours=2)
        self.payout.attempt_count = 1
        self.payout.save(update_fields=["status", "locked_at", "attempt_count"])

        processed = PayoutService.dispatch_due_payouts(limit=10, worker_id="t1")

        self.assertEqual(processed, 0)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(self.payout.attempt_count, 2)
        self.assertIsNotNone(self.payout.next_retry_at)

    def test_non_retryable_status_sync_failure_releases_earning_and_fails_batch(self):
        self.payout.status = "SENT"
        self.payout.sent_at = timezone.now()
        self.payout.provider_payout_id = "manual-status-id"
        self.payout.save(update_fields=["status", "sent_at", "provider_payout_id"])

        with patch(
            "payouts.services._retrieve_provider_status",
            return_value=PayoutStatusResult(
                ok=False,
                payout_status="FAILED",
                item_status="FAILED",
                item_reference_code="",
                error_code="PROVIDER_REJECTED",
                error_message="provider rejected payout",
                retryable=False,
                raw={"status": "FAILED"},
            ),
        ):
            processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.batch.refresh_from_db()
        earning_id = PayoutItem.objects.filter(payout=self.payout).values_list("earning_id", flat=True).get()
        earning = BusinessEarning.objects.get(pk=earning_id)
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(self.batch.status, "FAILED")
        self.assertEqual(earning.status, BusinessEarning.Status.ELIGIBLE)

        new_batch = PayoutService.create_batch_for_eligible()
        new_payout = Payout.objects.get(batch=new_batch)
        self.assertNotEqual(new_payout.id, self.payout.id)
        self.assertEqual(PayoutItem.objects.filter(payout=new_payout).count(), 1)

    def test_status_sync_does_not_downgrade_concurrently_confirmed_payout(self):
        self.payout.status = "SENT"
        self.payout.sent_at = timezone.now()
        self.payout.provider_payout_id = "manual-status-race"
        self.payout.save(update_fields=["status", "sent_at", "provider_payout_id"])

        def _race_confirm_then_fail(*, payout):
            PayoutService.confirm_payout(payout_id=payout.id, actor=None, source="manual", note="race")
            return PayoutStatusResult(
                ok=False,
                payout_status="FAILED",
                item_status="FAILED",
                item_reference_code="",
                error_code="PROVIDER_REJECTED",
                error_message="provider rejected payout",
                retryable=False,
                raw={"status": "FAILED"},
            )

        with patch("payouts.services._retrieve_provider_status", side_effect=_race_confirm_then_fail):
            processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 0)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "CONFIRMED")

    def test_non_retryable_status_sync_failure_cancels_redundant_pending_adjustments(self):
        self.payout.status = "SENT"
        self.payout.sent_at = timezone.now()
        self.payout.provider_payout_id = "manual-status-id-cancel-adjustment"
        self.payout.save(update_fields=["status", "sent_at", "provider_payout_id"])

        earning_id = PayoutItem.objects.filter(payout=self.payout).values_list("earning_id", flat=True).get()
        earning = BusinessEarning.objects.get(pk=earning_id)
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-dispatcher-adjustment-cancel-1",
            event_type="payment.order_chargeback",
            payload={},
            signature_ok=True,
        )
        result = PaymentReversalService.apply_order_chargeback(
            order=earning.order,
            amount=30,
            provider_event=provider_event,
            note="post-sent order chargeback",
        )
        self.assertEqual(result.business_mode, "next_cycle_adjustment")
        pending_adjustment = PayoutAdjustment.objects.get(payment_reversal=result.reversal)
        self.assertEqual(pending_adjustment.status, PayoutAdjustment.Status.PENDING)

        with patch(
            "payouts.services._retrieve_provider_status",
            return_value=PayoutStatusResult(
                ok=False,
                payout_status="FAILED",
                item_status="FAILED",
                item_reference_code="",
                error_code="PROVIDER_REJECTED",
                error_message="provider rejected payout",
                retryable=False,
                raw={"status": "FAILED"},
            ),
        ):
            processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        pending_adjustment.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(self.payout.status, "FAILED")
        self.assertEqual(earning.status, BusinessEarning.Status.ELIGIBLE)
        self.assertEqual(pending_adjustment.status, PayoutAdjustment.Status.CANCELLED)

        new_batch = PayoutService.create_batch_for_eligible()
        new_payout = Payout.objects.get(batch=new_batch)
        self.assertEqual(int(new_payout.amount), int(earning.outstanding_amount))

    def test_confirm_payout_preserves_reversed_earning_after_post_sent_chargeback(self):
        self.payout.status = "SENT"
        self.payout.sent_at = timezone.now()
        self.payout.provider_payout_id = "manual-status-confirm-reversed-1"
        self.payout.save(update_fields=["status", "sent_at", "provider_payout_id"])

        earning_id = PayoutItem.objects.filter(payout=self.payout).values_list("earning_id", flat=True).get()
        earning = BusinessEarning.objects.get(pk=earning_id)
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-post-sent-full-chargeback-1",
            event_type="payment.order_chargeback",
            payload={},
            signature_ok=True,
        )

        result = PaymentReversalService.apply_order_chargeback(
            order=earning.order,
            amount=int(earning.net_amount),
            provider_event=provider_event,
            note="post-sent full chargeback",
        )
        self.assertEqual(result.business_mode, "next_cycle_adjustment")
        pending_adjustment = PayoutAdjustment.objects.get(payment_reversal=result.reversal)
        self.assertEqual(pending_adjustment.status, PayoutAdjustment.Status.PENDING)

        PayoutService.confirm_payout(payout_id=self.payout.id)

        self.payout.refresh_from_db()
        earning.refresh_from_db()
        pending_adjustment.refresh_from_db()
        self.assertEqual(self.payout.status, "CONFIRMED")
        self.assertEqual(earning.status, BusinessEarning.Status.REVERSED)
        self.assertEqual(int(earning.reversed_amount), int(earning.net_amount))
        self.assertEqual(pending_adjustment.status, PayoutAdjustment.Status.PENDING)

    def test_non_retryable_status_sync_failure_keeps_sent_when_settlement_proof_exists(self):
        self.payout.status = "SENT"
        self.payout.sent_at = timezone.now()
        self.payout.provider_payout_id = "manual-status-id-proof"
        self.payout.save(update_fields=["status", "sent_at", "provider_payout_id"])
        earning_id = PayoutItem.objects.filter(payout=self.payout).values_list("earning_id", flat=True).get()
        earning = BusinessEarning.objects.get(pk=earning_id)

        SettlementRecord.objects.create(
            provider="IYZICO",
            external_settlement_id="SET-DISPATCHER-PROOF-1",
            external_transaction_id="manual-status-id-proof",
            amount=int(self.payout.amount),
            currency="TRY",
            provider_reference="manual-status-id-proof",
            business=self.business,
            payout=self.payout,
            match_type=SettlementRecord.MatchType.PAYOUT,
            is_processed=True,
            processed_at=timezone.now(),
        )

        with patch(
            "payouts.services._retrieve_provider_status",
            return_value=PayoutStatusResult(
                ok=False,
                payout_status="FAILED",
                item_status="FAILED",
                item_reference_code="",
                error_code="PROVIDER_REJECTED",
                error_message="provider rejected payout",
                retryable=False,
                raw={"status": "FAILED"},
            ),
        ):
            processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.last_error_code, "STATUS_SYNC_PROVIDER_FAILED_BUT_SETTLED")
        self.assertTrue(self.payout.provider_status_payload.get("settlement_proof_present"))
        self.assertEqual(earning.status, BusinessEarning.Status.IN_PAYOUT)

    def test_status_sync_provider_inconsistency_keeps_sent_for_manual_review(self):
        self.payout.status = "SENT"
        self.payout.sent_at = timezone.now()
        self.payout.provider_payout_id = "manual-status-item-missing"
        self.payout.save(update_fields=["status", "sent_at", "provider_payout_id"])

        with patch(
            "payouts.services._retrieve_provider_status",
            return_value=PayoutStatusResult(
                ok=False,
                payout_status="COMPLETED",
                item_status="",
                item_reference_code="",
                error_code="ITEM_NOT_FOUND_FINAL_STATE",
                error_message="final state but item missing",
                retryable=False,
                raw={"status": "COMPLETED"},
            ),
        ):
            processed = PayoutService.sync_sent_payout_statuses(limit=10)

        self.assertEqual(processed, 1)
        self.payout.refresh_from_db()
        self.assertEqual(self.payout.status, "SENT")
        self.assertEqual(self.payout.last_error_code, "STATUS_SYNC_PROVIDER_INCONSISTENT")
        self.assertTrue(self.payout.provider_status_payload.get("manual_review_required"))
        self.assertTrue(self.payout.provider_status_payload.get("provider_inconsistency"))
