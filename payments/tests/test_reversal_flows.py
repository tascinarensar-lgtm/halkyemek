from datetime import timedelta

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from orders.models import Order
from payments.models import PaymentIntent, PaymentReversal, ProviderEvent
from payments.services_reversals import PaymentReversalService
from payouts.models import BusinessEarning, Payout, PayoutAdjustment, PayoutItem
from payouts.services import PayoutService
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet
from wallets.models import PendingWalletTransaction, WalletTransaction
from wallets.services import WalletService


class ReversalFlowsTests(TestCase):
    def setUp(self):
        self.customer = create_user(username="customer")
        self.business = create_business(name="Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, name="Menu", slug="menu", price_amount=100)
        seed_wallet(user=self.customer, amount=1000)

    def _order_and_earning(self, status=BusinessEarning.Status.ELIGIBLE):
        order = Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=100,
            status=Order.Status.CREATED,
        )
        WalletService.purchase(user=self.customer, amount=100, description="buy", order=order)
        order.mark_paid(ttl_hours=24)
        order.save(update_fields=["status", "paid_at", "expires_at", "qr_token"])
        earning = BusinessEarning.objects.create(
            business=self.business,
            order=order,
            gross_amount=100,
            platform_fee_amount=0,
            net_amount=100,
            currency="TRY",
            eligible_at=timezone.now() - timedelta(days=1),
            status=status,
        )
        return order, earning

    def test_order_refund_before_payout_reverses_earning_in_place(self):
        order, earning = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        result = PaymentReversalService.apply_order_refund(order=order, amount=100)

        earning.refresh_from_db()
        order.refresh_from_db()
        self.assertEqual(result.reversal.status, PaymentReversal.Status.APPLIED)
        self.assertEqual(result.business_mode, "pre_payout_reversed")
        self.assertEqual(order.refund_status, Order.RefundStatus.FULL)
        self.assertEqual(earning.status, BusinessEarning.Status.REVERSED)
        self.assertEqual(earning.reversed_amount, 100)
        self.assertEqual(WalletTransaction.objects.filter(order=order, transaction_type=WalletTransaction.Type.REFUND).count(), 1)
        self.assertEqual(PayoutAdjustment.objects.count(), 0)

    def test_order_refund_rejects_unpaid_order(self):
        order = Order.objects.create(
            user=self.customer,
            business=self.business,
            menu=self.menu_item,
            amount=100,
            status=Order.Status.CREATED,
        )

        with self.assertRaisesMessage(Exception, "requires paid or used order"):
            PaymentReversalService.apply_order_refund(order=order, amount=10)

    def test_topup_reversal_rejects_unpaid_intent(self):
        risk_user = create_user(username="reversal-risk-user")
        intent = PaymentIntent.objects.create(
            user=risk_user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=100,
            status=PaymentIntent.Status.INITIATED,
        )

        with self.assertRaisesMessage(Exception, "requires paid payment intent"):
            PaymentReversalService.apply_topup_reversal(payment_intent=intent, amount=50)

    def test_order_refund_after_payout_creates_next_cycle_adjustment(self):
        order, earning = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        batch = PayoutService.create_batch_for_eligible()
        payout = Payout.objects.get(batch=batch)
        PayoutService.mark_payout_sent(payout_id=payout.id, provider_payout_id="prov-1")
        PayoutService.confirm_payout(payout_id=payout.id)

        result = PaymentReversalService.apply_order_refund(order=order, amount=100)

        self.assertEqual(result.business_mode, "next_cycle_adjustment")
        self.assertEqual(PayoutAdjustment.objects.filter(order=order, status=PayoutAdjustment.Status.PENDING, amount=-100).count(), 1)
        earning.refresh_from_db()
        self.assertEqual(earning.status, BusinessEarning.Status.REVERSED)

    def test_order_refund_before_dispatch_reduces_existing_payout_amount(self):
        order, earning = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        batch = PayoutService.create_batch_for_eligible()
        payout = Payout.objects.get(batch=batch)

        result = PaymentReversalService.apply_order_refund(order=order, amount=40)

        payout.refresh_from_db()
        batch.refresh_from_db()
        earning.refresh_from_db()
        payout_item = PayoutItem.objects.get(payout=payout, earning=earning)

        self.assertEqual(result.business_mode, "pre_payout_reversed")
        self.assertEqual(int(payout.amount), 60)
        self.assertEqual(int(batch.total_amount), 60)
        self.assertEqual(int(payout_item.amount), 60)
        self.assertEqual(int(earning.reversed_amount), 40)
        self.assertEqual(PayoutAdjustment.objects.filter(order=order).count(), 0)

    def test_full_order_refund_before_dispatch_cancels_zeroed_payout(self):
        order, earning = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        batch = PayoutService.create_batch_for_eligible()
        payout = Payout.objects.get(batch=batch)

        PaymentReversalService.apply_order_refund(order=order, amount=100)

        payout.refresh_from_db()
        batch.refresh_from_db()
        earning.refresh_from_db()

        self.assertEqual(payout.status, "CANCELLED")
        self.assertEqual(int(payout.amount), 0)
        self.assertEqual(int(batch.total_amount), 0)
        self.assertEqual(int(batch.earning_count), 0)
        self.assertEqual(earning.status, BusinessEarning.Status.REVERSED)
        self.assertFalse(PayoutItem.objects.filter(payout=payout).exists())


    def test_topup_reversal_insufficient_balance_blocks_wallet_and_tracks_exposure(self):
        risk_user = create_user(username="chargeback-risk-user")
        intent = PaymentIntent.objects.create(
            user=risk_user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=risk_user, amount=100, payment_intent=intent)
        WalletService.topup(user=risk_user, amount=50, payment_intent=intent, description="available")

        result = PaymentReversalService.apply_topup_reversal(payment_intent=intent, amount=300)

        risk_user.wallet.refresh_from_db()
        self.assertEqual(result.reversal.status, PaymentReversal.Status.REQUESTED)
        self.assertEqual(result.reversal.review_status, PaymentReversal.ReviewStatus.OPEN)
        self.assertEqual(int(result.reversal.pending_reversed_amount), 100)
        self.assertEqual(int(result.reversal.available_reversed_amount), 50)
        self.assertEqual(int(result.reversal.outstanding_exposure_amount), 150)
        self.assertTrue(result.reversal.blocked_wallet)
        self.assertFalse(risk_user.wallet.is_active)

    def test_manual_review_resolution_unblocks_wallet_once_exposure_recovered(self):
        risk_user = create_user(username="chargeback-risk-user")
        intent = PaymentIntent.objects.create(
            user=risk_user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=risk_user, amount=100, payment_intent=intent)
        WalletService.topup(user=risk_user, amount=50, payment_intent=intent, description="available")

        first = PaymentReversalService.apply_chargeback(payment_intent=intent, amount=300)
        risk_user.wallet.refresh_from_db()
        self.assertFalse(risk_user.wallet.is_active)
        WalletService.topup(user=risk_user, amount=150, payment_intent=intent, description="recovery funds")

        resolved = PaymentReversalService.resolve_manual_review(reversal=first.reversal)

        risk_user.wallet.refresh_from_db()
        self.assertEqual(resolved.reversal.status, PaymentReversal.Status.APPLIED)
        self.assertEqual(resolved.reversal.review_status, PaymentReversal.ReviewStatus.RESOLVED)
        self.assertEqual(int(resolved.reversal.outstanding_exposure_amount), 0)
        self.assertTrue(risk_user.wallet.is_active)

    def test_topup_reversal_consumes_pending_then_available(self):
        intent = PaymentIntent.objects.create(
            user=self.customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=self.customer, amount=100, payment_intent=intent)
        WalletService.topup(user=self.customer, amount=200, payment_intent=intent, description="manual available")

        result = PaymentReversalService.apply_topup_reversal(payment_intent=intent, amount=250)

        self.assertEqual(result.reversal.status, PaymentReversal.Status.APPLIED)
        self.assertEqual(PendingWalletTransaction.objects.filter(payment_intent=intent, transaction_type=PendingWalletTransaction.Type.REVERSAL_OUT).count(), 1)
        self.assertEqual(WalletTransaction.objects.filter(payment_intent=intent, transaction_type=WalletTransaction.Type.REVERSAL).count(), 1)


    def test_order_refund_cannot_exceed_combined_reversal_capacity(self):
        order, _ = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        order.register_chargeback(amount=40)
        order.save(update_fields=["refund_status", "chargeback_amount", "chargeback_at"])

        with self.assertRaisesMessage(Exception, "outstanding reversible amount"):
            PaymentReversalService.apply_order_refund(order=order, amount=70)

    def test_topup_reversal_cannot_exceed_cumulative_reversed_total(self):
        intent = PaymentIntent.objects.create(
            user=self.customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup(user=self.customer, amount=300, payment_intent=intent, description="available")
        PaymentReversalService.apply_topup_reversal(payment_intent=intent, amount=200)

        with self.assertRaisesMessage(Exception, "invalid topup reversal amount"):
            PaymentReversalService.apply_topup_reversal(payment_intent=intent, amount=150)

    def test_idempotency_key_returns_existing_reversal(self):
        order, _ = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        key = "same-key"
        first = PaymentReversalService.apply_order_refund(order=order, amount=30, idempotency_key=key)
        second = PaymentReversalService.apply_order_refund(order=order, amount=30, idempotency_key=key)

        self.assertEqual(first.reversal.pk, second.reversal.pk)
        self.assertEqual(PaymentReversal.objects.filter(idempotency_key=key).count(), 1)

    def test_chargeback_is_idempotent_for_same_provider_event(self):
        intent = PaymentIntent.objects.create(
            user=self.customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup(user=self.customer, amount=300, payment_intent=intent, description="available")
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-chargeback-1",
            event_type="payment.chargeback",
            payload={},
            signature_ok=True,
        )

        first = PaymentReversalService.apply_chargeback(payment_intent=intent, amount=120, provider_event=provider_event)
        second = PaymentReversalService.apply_chargeback(payment_intent=intent, amount=120, provider_event=provider_event)

        self.assertEqual(first.reversal.pk, second.reversal.pk)
        self.assertEqual(PaymentReversal.objects.filter(payment_intent=intent, reversal_type=PaymentReversal.Type.CHARGEBACK).count(), 1)
        self.assertEqual(WalletTransaction.objects.filter(payment_intent=intent, transaction_type=WalletTransaction.Type.CHARGEBACK).count(), 1)

    def test_chargeback_rejects_amount_mismatch_for_same_provider_event(self):
        intent = PaymentIntent.objects.create(
            user=self.customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup(user=self.customer, amount=300, payment_intent=intent, description="available")
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-chargeback-mismatch-1",
            event_type="payment.chargeback",
            payload={},
            signature_ok=True,
        )

        PaymentReversalService.apply_chargeback(payment_intent=intent, amount=120, provider_event=provider_event)
        with self.assertRaisesMessage(Exception, "amount conflicts"):
            PaymentReversalService.apply_chargeback(payment_intent=intent, amount=110, provider_event=provider_event)

    def test_order_chargeback_after_payout_creates_adjustment_without_wallet_refund(self):
        order, earning = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        batch = PayoutService.create_batch_for_eligible()
        payout = Payout.objects.get(batch=batch)
        PayoutService.mark_payout_sent(payout_id=payout.id, provider_payout_id="prov-order-cb-1")
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-order-cb-1",
            event_type="payment.order_chargeback",
            payload={},
            signature_ok=True,
        )

        result = PaymentReversalService.apply_order_chargeback(
            order=order,
            amount=100,
            provider_event=provider_event,
            note="order chargeback",
        )

        order.refresh_from_db()
        earning.refresh_from_db()
        self.assertEqual(result.reversal.reversal_type, PaymentReversal.Type.CHARGEBACK)
        self.assertEqual(result.reversal.status, PaymentReversal.Status.APPLIED)
        self.assertFalse(result.reversal.wallet_effect_applied)
        self.assertTrue(result.reversal.business_effect_applied)
        self.assertEqual(order.refund_status, Order.RefundStatus.CHARGEBACK)
        self.assertEqual(int(order.chargeback_amount), 100)
        self.assertEqual(earning.status, BusinessEarning.Status.REVERSED)
        self.assertEqual(int(earning.reversed_amount), 100)
        self.assertEqual(
            WalletTransaction.objects.filter(order=order, transaction_type=WalletTransaction.Type.REFUND).count(),
            0,
        )
        self.assertEqual(
            PayoutAdjustment.objects.filter(order=order, status=PayoutAdjustment.Status.PENDING, amount=-100).count(),
            1,
        )

    def test_order_chargeback_is_idempotent_for_same_provider_event(self):
        order, _ = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-order-cb-idem-1",
            event_type="payment.order_chargeback",
            payload={},
            signature_ok=True,
        )

        first = PaymentReversalService.apply_order_chargeback(order=order, amount=50, provider_event=provider_event)
        second = PaymentReversalService.apply_order_chargeback(order=order, amount=50, provider_event=provider_event)

        self.assertEqual(first.reversal.pk, second.reversal.pk)
        self.assertEqual(
            PaymentReversal.objects.filter(order=order, reversal_type=PaymentReversal.Type.CHARGEBACK).count(),
            1,
        )

    def test_order_chargeback_rejects_amount_mismatch_for_same_provider_event(self):
        order, _ = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-order-cb-mismatch-1",
            event_type="payment.order_chargeback",
            payload={},
            signature_ok=True,
        )

        PaymentReversalService.apply_order_chargeback(order=order, amount=50, provider_event=provider_event)
        with self.assertRaisesMessage(Exception, "amount conflicts"):
            PaymentReversalService.apply_order_chargeback(order=order, amount=40, provider_event=provider_event)

    def test_order_chargeback_provider_event_idempotency_is_order_scoped(self):
        first_order, _ = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        second_order, _ = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-order-cb-shared-event-1",
            event_type="payment.order_chargeback",
            payload={},
            signature_ok=True,
        )

        first = PaymentReversalService.apply_order_chargeback(order=first_order, amount=50, provider_event=provider_event)
        second = PaymentReversalService.apply_order_chargeback(order=second_order, amount=60, provider_event=provider_event)

        self.assertNotEqual(first.reversal.pk, second.reversal.pk)
        self.assertEqual(
            PaymentReversal.objects.filter(
                provider_event=provider_event,
                reversal_type=PaymentReversal.Type.CHARGEBACK,
            ).count(),
            2,
        )

    def test_payment_reversal_unique_per_provider_event_intent_and_type(self):
        intent = PaymentIntent.objects.create(
            user=self.customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-unique-1",
            event_type="payment.reversal",
            payload={},
            signature_ok=True,
        )
        PaymentReversal.objects.create(
            user=self.customer,
            payment_intent=intent,
            provider_event=provider_event,
            reversal_type=PaymentReversal.Type.TOPUP_REVERSAL,
            status=PaymentReversal.Status.REQUESTED,
            amount=50,
            idempotency_key="payrev-unique-1",
        )

        with self.assertRaises(ValidationError):
            PaymentReversal.objects.create(
                user=self.customer,
                payment_intent=intent,
                provider_event=provider_event,
                reversal_type=PaymentReversal.Type.TOPUP_REVERSAL,
                status=PaymentReversal.Status.REQUESTED,
                amount=50,
                idempotency_key="payrev-unique-2",
            )

    def test_long_provider_event_ids_do_not_collide_in_idempotency(self):
        intent = PaymentIntent.objects.create(
            user=self.customer,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup(user=self.customer, amount=300, payment_intent=intent, description="available")
        first_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-" + ("a" * 180),
            event_type="payment.chargeback",
            payload={},
            signature_ok=True,
        )
        second_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-" + ("a" * 179) + "b",
            event_type="payment.chargeback",
            payload={},
            signature_ok=True,
        )

        first = PaymentReversalService.apply_chargeback(payment_intent=intent, amount=100, provider_event=first_event)
        second = PaymentReversalService.apply_chargeback(payment_intent=intent, amount=100, provider_event=second_event)

        self.assertNotEqual(first.reversal.pk, second.reversal.pk)
        self.assertEqual(PaymentReversal.objects.filter(payment_intent=intent, reversal_type=PaymentReversal.Type.CHARGEBACK).count(), 2)

    def test_payment_reversal_unique_per_provider_event_order_and_type(self):
        order, _ = self._order_and_earning(status=BusinessEarning.Status.ELIGIBLE)
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-order-unique-1",
            event_type="payment.order_chargeback",
            payload={},
            signature_ok=True,
        )
        PaymentReversal.objects.create(
            user=self.customer,
            order=order,
            provider_event=provider_event,
            reversal_type=PaymentReversal.Type.CHARGEBACK,
            status=PaymentReversal.Status.REQUESTED,
            amount=30,
            idempotency_key="payrev-order-unique-1",
        )

        with self.assertRaises(ValidationError):
            PaymentReversal.objects.create(
                user=self.customer,
                order=order,
                provider_event=provider_event,
                reversal_type=PaymentReversal.Type.CHARGEBACK,
                status=PaymentReversal.Status.REQUESTED,
                amount=30,
                idempotency_key="payrev-order-unique-2",
            )
