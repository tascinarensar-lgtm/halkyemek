from datetime import timedelta
from typing import Optional

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Count
from django.utils import timezone

from common.locks import build_job_lock_token, job_lock
from orders.accounting import collect_business_earning_mismatches, collect_order_accounting_mismatches
from health.services import JobHeartbeatService
from notifications.models import DeliveryAttempt
from payments.models import PaymentIntent, PaymentReversal, SettlementRecord
from payments.settlement_proof import (
    has_settlement_line_amount_proof,
    has_settlement_record_evidence_for_intent,
    has_settlement_record_evidence_for_payout,
    normalized_references,
)
from payments.services_settlement import extract_settlement_error_code, is_retryable_settlement_error
from payouts.models import BusinessEarning, Payout, PayoutAdjustment, PayoutItem
from wallets.models import Wallet


def _norm_currency(value: Optional[str]) -> str:
    return str(value or '').strip().upper()


class Command(BaseCommand):
    help = "Report operational/financial anomalies"

    def add_arguments(self, parser):
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=1800)

    def handle(self, *args, **options):
        lock_token = build_job_lock_token(worker=options["worker"])
        with job_lock(name="report_financial_anomalies", token=lock_token, ttl_seconds=options["lock_ttl"]) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: report_financial_anomalies lock is already held."))
                return

            anomalies: list[str] = []
            now = timezone.now()
            late_settlement_cutoff = timezone.now() - timedelta(hours=24)
            deferred_retryables_count = 0
            deferred_retryables_oldest_created_at = None
            stale_manual_review_cutoff = now - timedelta(hours=max(int(getattr(settings, 'SETTLEMENT_MANUAL_REVIEW_STALE_HOURS', 12)), 1))

            for record in SettlementRecord.objects.filter(is_processed=False).iterator():
                error_code = extract_settlement_error_code(record.processing_error)
                retryable = is_retryable_settlement_error(record.processing_error)
                retry_exhausted = retryable and int(record.retry_count or 0) > 0 and record.next_retry_at is None
                stale_manual_review = (
                    record.created_at <= late_settlement_cutoff
                    and (record.next_retry_at is None or record.next_retry_at <= now)
                )
                if retryable and not retry_exhausted and not stale_manual_review:
                    deferred_retryables_count += 1
                    if deferred_retryables_oldest_created_at is None or record.created_at < deferred_retryables_oldest_created_at:
                        deferred_retryables_oldest_created_at = record.created_at
                    continue
                review_state = 'RETRYABLE_EXHAUSTED' if retry_exhausted else ('STALE_RETRYABLE' if (retryable and stale_manual_review) else ('RETRYABLE' if retryable else 'PERMANENT'))
                anomalies.append(
                    f"[SETTLEMENT_RECORD_UNPROCESSED] settlement_record_id={record.pk} "
                    f"external_settlement_id={record.external_settlement_id} error_code={error_code or '-'} "
                    f"review_state={review_state} "
                    f"retry_count={int(record.retry_count or 0)} next_retry_at={record.next_retry_at} "
                    f"error={record.processing_error}"
                )

            duplicate_intent_matches = (
                SettlementRecord.objects.filter(
                    is_processed=True,
                    match_type=SettlementRecord.MatchType.PAYMENT_INTENT,
                    payment_intent__isnull=False,
                )
                .values('payment_intent_id')
                .annotate(total=Count('id'))
                .filter(total__gt=1)
            )
            for row in duplicate_intent_matches.iterator():
                anomalies.append(
                    f"[DUPLICATE_SETTLEMENT_INTENT_MATCH] payment_intent_id={row['payment_intent_id']} count={int(row['total'])}"
                )

            duplicate_payout_matches = (
                SettlementRecord.objects.filter(
                    is_processed=True,
                    match_type=SettlementRecord.MatchType.PAYOUT,
                    payout__isnull=False,
                )
                .values('payout_id')
                .annotate(total=Count('id'))
                .filter(total__gt=1)
            )
            for row in duplicate_payout_matches.iterator():
                anomalies.append(
                    f"[DUPLICATE_SETTLEMENT_PAYOUT_MATCH] payout_id={row['payout_id']} count={int(row['total'])}"
                )

            for record in SettlementRecord.objects.filter(is_processed=True, match_type=SettlementRecord.MatchType.UNMATCHED).iterator():
                anomalies.append(
                    f"[SETTLEMENT_RECORD_MATCH_TYPE_INVALID] settlement_record_id={record.pk} external_settlement_id={record.external_settlement_id}"
                )

            for record in SettlementRecord.objects.filter(is_processed=True, match_type=SettlementRecord.MatchType.PAYMENT_INTENT, payment_intent__isnull=False).select_related("payment_intent", "business").iterator():
                if int(record.amount) != int(record.payment_intent.amount):
                    anomalies.append(
                        f"[SETTLEMENT_PAYMENT_AMOUNT_MISMATCH] settlement_record_id={record.pk} payment_intent_id={getattr(record, 'payment_intent_id', None)} record_amount={int(record.amount)} intent_amount={int(record.payment_intent.amount)}"
                    )
                if record.business_id is not None and record.submerchant_key and record.business.iyzico_submerchant_key != record.submerchant_key:
                    anomalies.append(
                        f"[SETTLEMENT_INTENT_SUBMERCHANT_MISMATCH] settlement_record_id={record.pk} business_id={record.business_id} submerchant_key={record.submerchant_key}"
                    )

            for record in SettlementRecord.objects.filter(is_processed=True, settled_at__isnull=True).iterator():
                anomalies.append(
                    f"[PROCESSED_SETTLEMENT_MISSING_SETTLED_AT] settlement_record_id={record.pk} match_type={record.match_type}"
                )

            for record in SettlementRecord.objects.filter(is_processed=False, created_at__lte=stale_manual_review_cutoff).iterator():
                if is_retryable_settlement_error(record.processing_error) and record.next_retry_at and record.next_retry_at > now:
                    continue
                anomalies.append(
                    f"[SETTLEMENT_MANUAL_REVIEW_STALE] settlement_record_id={record.pk} error={record.processing_error}"
                )

            for record in SettlementRecord.objects.filter(is_processed=True, match_type=SettlementRecord.MatchType.PAYOUT, payout__isnull=False).select_related("payout", "business", "payout__business").iterator():
                if int(record.amount) != int(record.payout.amount):
                    anomalies.append(
                        f"[SETTLEMENT_PAYOUT_AMOUNT_MISMATCH] settlement_record_id={record.pk} payout_id={getattr(record, 'payout_id', None)} record_amount={int(record.amount)} payout_amount={int(record.payout.amount)}"
                    )
                if _norm_currency(record.currency) and _norm_currency(record.payout.currency) and _norm_currency(record.currency) != _norm_currency(record.payout.currency):
                    anomalies.append(
                        f"[SETTLEMENT_PAYOUT_CURRENCY_MISMATCH] settlement_record_id={record.pk} payout_id={getattr(record, 'payout_id', None)} record_currency={record.currency} payout_currency={record.payout.currency}"
                    )
                if record.business_id is not None and record.business_id != record.payout.business_id:
                    anomalies.append(
                        f"[SETTLEMENT_PAYOUT_BUSINESS_MISMATCH] settlement_record_id={record.pk} payout_id={getattr(record, 'payout_id', None)} record_business_id={record.business_id} payout_business_id={record.payout.business_id}"
                    )
                if record.submerchant_key and record.payout.business.iyzico_submerchant_key and record.submerchant_key != record.payout.business.iyzico_submerchant_key:
                    anomalies.append(
                        f"[SETTLEMENT_PAYOUT_SUBMERCHANT_MISMATCH] settlement_record_id={record.pk} payout_id={getattr(record, 'payout_id', None)} record_submerchant_key={record.submerchant_key} payout_submerchant_key={record.payout.business.iyzico_submerchant_key}"
                    )

            for pi in PaymentIntent.objects.filter(purpose=PaymentIntent.Purpose.TOPUP, status=PaymentIntent.Status.PAID, is_settled=False).iterator():
                has_processed_record = has_settlement_record_evidence_for_intent(
                    payment_intent=pi,
                    references=normalized_references(
                        pi.provider_payment_id,
                        pi.marketplace_conversation_id,
                        pi.settlement_reference_code,
                    ),
                )
                has_raw_proof = has_settlement_line_amount_proof(
                    provider='IYZICO',
                    references=normalized_references(
                        pi.provider_payment_id,
                        pi.marketplace_conversation_id,
                        pi.settlement_reference_code,
                    ),
                    amount=int(pi.amount),
                )
                if has_processed_record or has_raw_proof:
                    anomalies.append(
                        f"[PAYMENT_SHOULD_BE_SETTLED] payment_intent_id={pi.pk} provider_payment_id={pi.provider_payment_id}"
                    )
                elif pi.processed_at and pi.processed_at <= late_settlement_cutoff:
                    anomalies.append(
                        f"[PAYMENT_LATE_SETTLEMENT] payment_intent_id={pi.pk} paid_at={pi.processed_at.isoformat()}"
                    )

            for reversal in PaymentReversal.objects.all().iterator():
                wallet_effect_expected = reversal.reversal_type in {
                    PaymentReversal.Type.ORDER_REFUND,
                    PaymentReversal.Type.TOPUP_REVERSAL,
                } or (
                    reversal.reversal_type == PaymentReversal.Type.CHARGEBACK
                    and getattr(reversal, "payment_intent_id", None) is not None
                )
                if wallet_effect_expected and reversal.wallet_effect_applied is False:
                    anomalies.append(
                        f"[REVERSAL_APPLIED_WITHOUT_WALLET_EFFECT] reversal_id={reversal.pk} type={reversal.reversal_type}"
                    )
                if reversal.status == PaymentReversal.Status.REQUESTED and reversal.failure_reason:
                    anomalies.append(
                        f"[REVERSAL_MANUAL_REVIEW_REQUIRED] reversal_id={reversal.pk} outstanding_exposure={int(reversal.outstanding_exposure_amount or 0)} blocked_wallet={int(bool(reversal.blocked_wallet))} reason={reversal.failure_reason[:120]}"
                    )
                partial_total = int(reversal.pending_reversed_amount or 0) + int(reversal.available_reversed_amount or 0)
                if partial_total + int(reversal.outstanding_exposure_amount or 0) > int(reversal.amount):
                    anomalies.append(
                        f"[REVERSAL_PARTIAL_TOTAL_INVALID] reversal_id={reversal.pk} partial_total={partial_total} outstanding_exposure={int(reversal.outstanding_exposure_amount or 0)} amount={int(reversal.amount)}"
                    )
                if reversal.review_status == PaymentReversal.ReviewStatus.OPEN and int(reversal.outstanding_exposure_amount or 0) <= 0:
                    anomalies.append(
                        f"[REVERSAL_OPEN_WITHOUT_OUTSTANDING_EXPOSURE] reversal_id={reversal.pk}"
                    )
                if reversal.blocked_wallet:
                    wallet = Wallet.objects.filter(user_id=reversal.user_id).only("is_active", "restriction_reason").first()
                    if wallet is None or wallet.is_active:
                        anomalies.append(
                            f"[REVERSAL_BLOCK_FLAG_WALLET_NOT_RESTRICTED] reversal_id={reversal.pk} user_id={reversal.user_id}"
                        )
                if reversal.reversal_type == PaymentReversal.Type.ORDER_REFUND and reversal.business_effect_applied is False:
                    anomalies.append(
                        f"[ORDER_REVERSAL_WITHOUT_BUSINESS_EFFECT] reversal_id={reversal.pk} order_id={getattr(reversal, 'order_id', None)}"
                    )

            for earning in BusinessEarning.objects.select_related("order").all().iterator():
                linked_order = earning.order
                if linked_order is None:
                    continue
                total_reversed = int(linked_order.refunded_amount or 0) + int(linked_order.chargeback_amount or 0)
                if total_reversed > int(linked_order.amount):
                    anomalies.append(
                        f"[ORDER_REVERSED_OVER_AMOUNT] order_id={linked_order.id} total_reversed={total_reversed} order_amount={int(linked_order.amount)}"
                    )
                for mismatch in collect_order_accounting_mismatches(order=linked_order):
                    field = mismatch.get("field", "-")
                    anomalies.append(
                        f"[{mismatch['type']}] order_id={linked_order.id} field={field} actual={mismatch.get('actual')} expected={mismatch.get('expected')}"
                    )
                for mismatch in collect_business_earning_mismatches(earning=earning):
                    field = mismatch.get("field", "-")
                    anomalies.append(
                        f"[{mismatch['type']}] earning_id={earning.id} order_id={linked_order.id} field={field} actual={mismatch.get('actual')} expected={mismatch.get('expected')}"
                    )

            for intent in PaymentIntent.objects.filter(purpose=PaymentIntent.Purpose.TOPUP).iterator():
                reversed_total = sum(
                    int(x)
                    for x in PaymentReversal.objects.filter(
                        payment_intent=intent,
                        reversal_type__in=[PaymentReversal.Type.TOPUP_REVERSAL, PaymentReversal.Type.CHARGEBACK],
                        status=PaymentReversal.Status.APPLIED,
                    ).values_list("amount", flat=True)
                )
                if reversed_total > int(intent.amount):
                    anomalies.append(
                        f"[TOPUP_REVERSED_OVER_AMOUNT] payment_intent_id={intent.pk} reversed_total={reversed_total} intent_amount={int(intent.amount)}"
                    )

            for adjustment in PayoutAdjustment.objects.filter(status=PayoutAdjustment.Status.APPLIED, payout__isnull=True).iterator():
                anomalies.append(
                    f"[APPLIED_ADJUSTMENT_WITHOUT_PAYOUT] adjustment_id={adjustment.pk} business_id={getattr(adjustment, 'business_id', None)}"
                )

            duplicate_adjustment_reversal_ids = (
                PayoutAdjustment.objects.exclude(payment_reversal__isnull=True)
                .values_list("payment_reversal_id", flat=True)
            )
            seen_adjustments: set[int] = set()
            duplicate_adjustments: set[int] = set()
            for reversal_id in duplicate_adjustment_reversal_ids:
                if int(reversal_id) in seen_adjustments:
                    duplicate_adjustments.add(int(reversal_id))
                else:
                    seen_adjustments.add(int(reversal_id))
            for reversal_id in sorted(duplicate_adjustments):
                anomalies.append(
                    f"[DUPLICATE_ADJUSTMENT_FOR_REVERSAL] payment_reversal_id={reversal_id}"
                )

            mutable_payout_statuses = ["CREATED", "FAILED", "CANCELLED"]
            for item in PayoutItem.objects.select_related("payout", "earning").filter(payout__status__in=mutable_payout_statuses).iterator():
                earning_outstanding = max(int(item.earning.net_amount) - int(item.earning.reversed_amount or 0), 0)
                if int(item.amount) > earning_outstanding:
                    anomalies.append(
                        f"[MUTABLE_PAYOUT_ITEM_EXCEEDS_EARNING_OUTSTANDING] payout_id={item.payout.pk} "
                        f"earning_id={item.earning.pk} item_amount={int(item.amount)} earning_outstanding={earning_outstanding} "
                        f"payout_status={item.payout.status}"
                    )

            for payout in Payout.objects.filter(status__in=["SENT", "CONFIRMED"]).iterator():
                has_processed_record = SettlementRecord.objects.filter(payout=payout, is_processed=True).exists()
                has_raw_proof = has_settlement_line_amount_proof(
                    provider='IYZICO',
                    references=normalized_references(
                        payout.provider_reference,
                        payout.provider_payout_id,
                        payout.provider_item_reference_code,
                    ),
                    amount=int(payout.amount),
                    submerchant_key=payout.business.iyzico_submerchant_key,
                )
                if not has_processed_record and not has_raw_proof:
                    anomalies.append(
                        f"[PAYOUT_PROOF_MISSING] payout_id={payout.id} ref={payout.provider_reference}"
                    )
                if payout.status == "CONFIRMED":
                    unpaid_count = PayoutItem.objects.select_related("earning").filter(payout=payout).exclude(earning__status=BusinessEarning.Status.PAID).count()
                    if unpaid_count:
                        anomalies.append(
                            f"[CONFIRMED_PAYOUT_EARNING_STATUS_INVALID] payout_id={payout.id} unpaid_count={unpaid_count}"
                        )

            for payout in Payout.objects.filter(status="FAILED").iterator():
                references = normalized_references(
                    payout.provider_reference,
                    payout.provider_payout_id,
                    payout.provider_item_reference_code,
                )
                has_late_settlement = has_settlement_record_evidence_for_payout(
                    payout=payout,
                    references=references,
                )
                if not has_late_settlement:
                    has_late_settlement = has_settlement_line_amount_proof(
                        provider='IYZICO',
                        references=references,
                        amount=int(payout.amount),
                        submerchant_key=payout.business.iyzico_submerchant_key,
                    )
                if has_late_settlement:
                    anomalies.append(
                        f"[FAILED_PAYOUT_HAS_SETTLEMENT_PROOF] payout_id={payout.id} ref={payout.provider_reference}"
                    )

            for attempt in DeliveryAttempt.objects.filter(status="FAILED", retry_count__gte=5).iterator():
                anomalies.append(
                    f"[NOTIFICATION_RETRY_HIGH] attempt_id={attempt.pk} notif_id={getattr(attempt, 'notification_id', None)} retry_count={attempt.retry_count}"
                )

            if anomalies:
                JobHeartbeatService.failure("report_financial_anomalies", f"anomalies={len(anomalies)}", sample=anomalies[:25], worker=options["worker"])
                for item in anomalies:
                    self.stdout.write(item)
                raise SystemExit(1)

            oldest_age_minutes = None
            if deferred_retryables_oldest_created_at is not None:
                oldest_age_minutes = int((now - deferred_retryables_oldest_created_at).total_seconds() // 60)
            JobHeartbeatService.success(
                "report_financial_anomalies",
                worker=options["worker"],
                deferred_retryables_count=int(deferred_retryables_count),
                deferred_retryables_oldest_age_minutes=oldest_age_minutes,
            )
            if deferred_retryables_count > 0:
                self.stdout.write(
                    self.style.WARNING(
                        f"Deferred retryable settlement records: count={int(deferred_retryables_count)} "
                        f"oldest_age_minutes={oldest_age_minutes if oldest_age_minutes is not None else 0}"
                    )
                )
            self.stdout.write(self.style.SUCCESS("No financial/operational anomalies detected."))
