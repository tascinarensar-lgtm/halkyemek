from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from payments.models import PaymentIntent, PaymentReversal
from test_support import create_user


class ReversalManualReviewIntegrityTests(TestCase):
    def test_verify_financial_integrity_flags_requested_reversal_manual_review(self):
        user = create_user(username="integrity-manual-review")
        intent = PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        PaymentReversal.objects.create(
            user=user,
            payment_intent=intent,
            reversal_type=PaymentReversal.Type.CHARGEBACK,
            status=PaymentReversal.Status.REQUESTED,
            amount=300,
            idempotency_key="integrity-manual-review-1",
            failure_reason="INSUFFICIENT_AVAILABLE_BALANCE_MANUAL_REVIEW",
        )

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command("verify_financial_integrity", "--worker", "test-suite", "--lock-ttl", "5", stdout=stdout)

        self.assertEqual(ctx.exception.code, 2)
        self.assertIn("REVERSAL_MANUAL_REVIEW_REQUIRED", stdout.getvalue())

    def test_report_financial_anomalies_flags_requested_reversal_manual_review(self):
        user = create_user(username="anomaly-manual-review")
        intent = PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        PaymentReversal.objects.create(
            user=user,
            payment_intent=intent,
            reversal_type=PaymentReversal.Type.CHARGEBACK,
            status=PaymentReversal.Status.REQUESTED,
            amount=300,
            idempotency_key="anomaly-manual-review-1",
            failure_reason="INSUFFICIENT_AVAILABLE_BALANCE_MANUAL_REVIEW",
        )

        stdout = StringIO()
        with self.assertRaises(SystemExit) as ctx:
            call_command("report_financial_anomalies", "--worker", "test-suite", "--lock-ttl", "5", stdout=stdout)

        self.assertEqual(ctx.exception.code, 1)
        self.assertIn("REVERSAL_MANUAL_REVIEW_REQUIRED", stdout.getvalue())
