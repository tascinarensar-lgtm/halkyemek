from django.test import TestCase
from unittest.mock import patch

from accounts.models import User
from payments.models import PaymentIntent
from payments.services import settle_intent_from_provider


class PaymentSettlementNotificationTests(TestCase):
    @patch("payments.services.NotificationService.enqueue")
    @patch("payments.services.WalletService.settle_pending_to_available")
    def test_settle_intent_enqueues_customer_notification(self, settle_mock, enqueue_mock):
        user = User.objects.create_user(username="payer", password="pass", role=User.Role.CUSTOMER)
        intent = PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            provider=PaymentIntent.Provider.IYZICO,
            amount=500,
            status=PaymentIntent.Status.PAID,
            is_processed=True,
        )

        result = settle_intent_from_provider(
            provider="IYZICO",
            provider_event_id="evt-1",
            intent_id=intent.id,
            amount=500,
            raw_row={"paymentId": "pay-1"},
        )

        self.assertEqual(result.status, "settled")
        enqueue_mock.assert_called_once()
        self.assertEqual(enqueue_mock.call_args.kwargs["user"], user)
        self.assertEqual(enqueue_mock.call_args.kwargs["dedupe_key"], f"payment_settled:{intent.id}")
