from django.test import TestCase

from accounts.models import User
from wallets.models import PendingWalletTransaction, Wallet, WalletTransaction
from payments.models import PaymentIntent
from payments.services import settle_intent_from_provider
from wallets.services import WalletService

class SettlementServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u1", password="pass", role=User.Role.CUSTOMER)
        Wallet.objects.get_or_create(user=self.user)

    def test_settlement_moves_pending_to_available_idempotently(self):
        intent = PaymentIntent.objects.create(
            user=self.user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=1000,
            status=PaymentIntent.Status.PAID,
            is_processed=True,
            provider_payment_id="P123",
        )

        # paid -> pending (normalde webhook yapar; testte direkt basıyoruz)
        WalletService.topup_pending(
            user=self.user,
            amount=1000,
            description="seed pending",
            provider_event_id="evt_paid_1",
            payment_intent_id=intent.pk,
        )

        w = Wallet.objects.get(user=self.user)
        w.refresh_from_db()
        self.assertEqual(w.pending_balance, 1000)
        self.assertEqual(w.balance, 0)

        # settlement
        res = settle_intent_from_provider(
            provider="iyzico",
            provider_event_id="iyzico:settlement:SR1",
            intent_id=intent.pk,
            provider_payment_id="P123",
            settlement_reference_code="SR1",
            amount=1000,
            raw_row={"paymentId": "P123", "settlementReferenceCode": "SR1"},
        )
        self.assertEqual(res.status, "settled")

        w.refresh_from_db()
        self.assertEqual(w.pending_balance, 0)
        self.assertEqual(w.balance, 1000)

        intent.refresh_from_db()
        self.assertTrue(intent.is_settled)
        self.assertIsNotNone(intent.settled_at)
        self.assertEqual(intent.settlement_reference_code, "SR1")

        # idempotent: aynı settlement tekrar gelirse değişiklik yok
        res2 = settle_intent_from_provider(
            provider="iyzico",
            provider_event_id="iyzico:settlement:SR1",
            intent_id=intent.pk,
            provider_payment_id="P123",
            settlement_reference_code="SR1",
            amount=1000,
            raw_row={"paymentId": "P123", "settlementReferenceCode": "SR1"},
        )
        self.assertIn(res2.status, {"duplicate", "already_settled"})
        w.refresh_from_db()
        self.assertEqual(w.balance, 1000)
        self.assertEqual(w.pending_balance, 0)
        self.assertEqual(
            PendingWalletTransaction.objects.filter(
                payment_intent=intent,
                transaction_type=PendingWalletTransaction.Type.SETTLEMENT_OUT,
            ).count(),
            1,
        )
        self.assertEqual(
            WalletTransaction.objects.filter(
                payment_intent=intent,
                transaction_type=WalletTransaction.Type.TOP_UP,
            ).count(),
            1,
        )
