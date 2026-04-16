from __future__ import annotations

from datetime import timedelta
from typing import Optional

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Count, Sum
from django.utils import timezone

from businesses.models import BusinessProfile
from common.locks import build_job_lock_token, job_lock
from health.services import JobHeartbeatService
from orders.accounting import collect_business_earning_mismatches, collect_order_accounting_mismatches
from payments.models import PaymentIntent, PaymentReversal, SettlementRecord
from payments.services_settlement import is_retryable_settlement_error
from payments.settlement_proof import (
    has_settlement_line_amount_proof,
    has_settlement_record_evidence_for_intent,
    has_settlement_record_evidence_for_payout,
    normalized_references,
)
from payouts.models import BusinessEarning, Payout, PayoutAdjustment, PayoutItem
from wallets.models import Wallet
from wallets.models import PendingWalletTransaction, Wallet, WalletTransaction


def _norm_currency(value: Optional[str]) -> str:
    return str(value or '').strip().upper()


class Command(BaseCommand):
    help = "Verify financial invariants across wallets, payments, settlement, payouts. Exits non-zero if issues found."

    def add_arguments(self, parser):
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=7200)

    def handle(self, *args, **opts):
        lock_token = build_job_lock_token(worker=opts["worker"])
        with job_lock(name="verify_financial_integrity", token=lock_token, ttl_seconds=opts["lock_ttl"]) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: verify_financial_integrity lock is already held."))
                return

            issues = []
            now = timezone.now()
            late_settlement_cutoff = now - timedelta(hours=24)
            stale_manual_review_cutoff = now - timedelta(hours=max(int(getattr(settings, 'SETTLEMENT_MANUAL_REVIEW_STALE_HOURS', 12)), 1))

            for wallet in Wallet.objects.all().iterator():
                last = WalletTransaction.objects.filter(wallet=wallet).order_by("-id").first()
                if last and int(last.after_balance) != int(wallet.balance):
                    issues.append((
                        "CUSTOMER_LEDGER_DRIFT",
                        {"wallet_id": wallet.pk, "wallet_balance": int(wallet.balance), "last_after": int(last.after_balance)},
                    ))

            for wallet in Wallet.objects.all().iterator():
                lastp = PendingWalletTransaction.objects.filter(wallet=wallet).order_by("-id").first()
                if lastp and int(lastp.after_pending) != int(wallet.pending_balance):
                    issues.append((
                        "CUSTOMER_PENDING_DRIFT",
                        {"wallet_id": wallet.pk, "pending": int(wallet.pending_balance), "last_after": int(lastp.after_pending)},
                    ))

            settled_intents = PaymentIntent.objects.filter(is_settled=True).only("id")
            for payment_intent in settled_intents.iterator():
                has_settlement = PendingWalletTransaction.objects.filter(
                    payment_intent_id=payment_intent.pk,
                    transaction_type="SETTLEMENT_OUT",
                ).exists()
                if not has_settlement:
                    issues.append(("SETTLED_INTENT_NO_SETTLEMENT_TX", {"payment_intent_id": payment_intent.pk}))

            for earning in BusinessEarning.objects.select_related("order").all().iterator():
                order = earning.order
                if order is None:
                    continue
                total_reversed = int(order.refunded_amount or 0) + int(order.chargeback_amount or 0)
                if total_reversed > int(order.amount):
                    issues.append((
                        "ORDER_REVERSED_OVER_AMOUNT",
                        {"order_id": order.pk, "total_reversed": total_reversed, "order_amount": int(order.amount)},
                    ))
                if int(earning.reversed_amount or 0) > int(earning.net_amount):
                    issues.append((
                        "EARNING_REVERSED_OVER_NET",
                        {"earning_id": earning.pk, "reversed_amount": int(earning.reversed_amount), "net_amount": int(earning.net_amount)},
                    ))
                for mismatch in collect_order_accounting_mismatches(order=order):
                    issue_type = str(mismatch.pop("type"))
                    issues.append((issue_type, mismatch))
                for mismatch in collect_business_earning_mismatches(earning=earning):
                    issue_type = str(mismatch.pop("type"))
                    issues.append((issue_type, mismatch))

            for reversal in PaymentReversal.objects.all().iterator():
                wallet_effect_expected = reversal.reversal_type in {
                    PaymentReversal.Type.ORDER_REFUND,
                    PaymentReversal.Type.TOPUP_REVERSAL,
                } or (
                    reversal.reversal_type == PaymentReversal.Type.CHARGEBACK
                    and getattr(reversal, "payment_intent_id", None) is not None
                )
                if reversal.status == PaymentReversal.Status.APPLIED and wallet_effect_expected and not reversal.wallet_effect_applied:
                    issues.append((
                        "REVERSAL_WALLET_EFFECT_MISSING",
                        {"reversal_id": reversal.pk, "reversal_type": reversal.reversal_type},
                    ))
                if reversal.status == PaymentReversal.Status.REQUESTED and reversal.failure_reason:
                    issues.append((
                        "REVERSAL_MANUAL_REVIEW_REQUIRED",
                        {
                            "reversal_id": reversal.pk,
                            "failure_reason": reversal.failure_reason[:255],
                            "outstanding_exposure_amount": int(reversal.outstanding_exposure_amount or 0),
                            "blocked_wallet": bool(reversal.blocked_wallet),
                        },
                    ))
                partial_total = int(reversal.pending_reversed_amount or 0) + int(reversal.available_reversed_amount or 0)
                if partial_total + int(reversal.outstanding_exposure_amount or 0) > int(reversal.amount):
                    issues.append((
                        "REVERSAL_PARTIAL_TOTAL_INVALID",
                        {"reversal_id": reversal.pk, "partial_total": partial_total, "outstanding_exposure_amount": int(reversal.outstanding_exposure_amount or 0), "amount": int(reversal.amount)},
                    ))
                if reversal.review_status == PaymentReversal.ReviewStatus.OPEN and int(reversal.outstanding_exposure_amount or 0) <= 0:
                    issues.append((
                        "REVERSAL_OPEN_WITHOUT_OUTSTANDING_EXPOSURE",
                        {"reversal_id": reversal.pk},
                    ))
                if reversal.blocked_wallet:
                    wallet = Wallet.objects.filter(user_id=reversal.user_id).only("is_active", "restriction_reason").first()
                    if wallet is None or wallet.is_active:
                        issues.append((
                            "REVERSAL_BLOCK_FLAG_WALLET_NOT_RESTRICTED",
                            {"reversal_id": reversal.pk, "user_id": reversal.user_id},
                        ))
                if reversal.reversal_type == PaymentReversal.Type.ORDER_REFUND:
                    if getattr(reversal, "order_id", None) is None:
                        issues.append(("ORDER_REVERSAL_ORDER_MISSING", {"reversal_id": reversal.pk}))
                    if reversal.status == PaymentReversal.Status.APPLIED and not reversal.business_effect_applied:
                        issues.append(("ORDER_REVERSAL_BUSINESS_EFFECT_MISSING", {"reversal_id": reversal.pk, "order_id": getattr(reversal, "order_id", None)}))
                if reversal.reversal_type == PaymentReversal.Type.TOPUP_REVERSAL and getattr(reversal, "payment_intent_id", None) is None:
                    issues.append(("TOPUP_REVERSAL_INTENT_MISSING", {"reversal_id": reversal.pk}))
                if (
                    reversal.reversal_type == PaymentReversal.Type.CHARGEBACK
                    and getattr(reversal, "payment_intent_id", None) is None
                    and getattr(reversal, "order_id", None) is None
                ):
                    issues.append(("CHARGEBACK_SOURCE_MISSING", {"reversal_id": reversal.pk}))

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
                    issues.append((
                        "TOPUP_REVERSED_OVER_AMOUNT",
                        {"payment_intent_id": intent.pk, "reversed_total": reversed_total, "intent_amount": int(intent.amount)},
                    ))

            for adjustment in PayoutAdjustment.objects.all().iterator():
                if adjustment.status == PayoutAdjustment.Status.APPLIED and getattr(adjustment, "payout_id", None) is None:
                    issues.append((
                        "APPLIED_ADJUSTMENT_WITHOUT_PAYOUT",
                        {"adjustment_id": adjustment.pk, "business_id": getattr(adjustment, "business_id", None)},
                    ))

            duplicate_adjustment_reversal_ids = (
                PayoutAdjustment.objects.exclude(payment_reversal__isnull=True)
                .values_list("payment_reversal_id", flat=True)
            )
            seen_adjustments: set[int] = set()
            duplicate_adjustments: set[int] = set()
            for reversal_id in duplicate_adjustment_reversal_ids:
                if reversal_id in seen_adjustments:
                    duplicate_adjustments.add(int(reversal_id))
                else:
                    seen_adjustments.add(int(reversal_id))
            for reversal_id in sorted(duplicate_adjustments):
                issues.append((
                    "DUPLICATE_ADJUSTMENT_FOR_REVERSAL",
                    {"payment_reversal_id": reversal_id},
                ))

            for payout in Payout.objects.all().iterator():
                items_sum = PayoutItem.objects.filter(payout=payout).aggregate(total=Sum("amount"))["total"] or 0
                if int(items_sum) != int(payout.amount):
                    issues.append((
                        "PAYOUT_ITEM_SUM_MISMATCH",
                        {"payout_id": payout.id, "payout_amount": int(payout.amount), "items_sum": int(items_sum)},
                    ))

            mutable_payout_statuses = ["CREATED", "FAILED", "CANCELLED"]
            for item in PayoutItem.objects.select_related("payout", "earning").filter(payout__status__in=mutable_payout_statuses).iterator():
                earning_outstanding = max(int(item.earning.net_amount) - int(item.earning.reversed_amount or 0), 0)
                if int(item.amount) > earning_outstanding:
                    issues.append((
                        "MUTABLE_PAYOUT_ITEM_EXCEEDS_EARNING_OUTSTANDING",
                        {
                            "payout_id": item.payout.pk,
                            "earning_id": item.earning.pk,
                            "item_amount": int(item.amount),
                            "earning_outstanding": earning_outstanding,
                            "payout_status": item.payout.status,
                        },
                    ))

            for payout in Payout.objects.filter(status__in=["SENT", "CONFIRMED"]).iterator():
                bad = PayoutItem.objects.select_related("earning").filter(payout_id=payout.id).exclude(earning__status="PAID")
                if payout.status == "CONFIRMED" and bad.exists():
                    issues.append(("CONFIRMED_PAYOUT_EARNING_NOT_PAID", {"payout_id": payout.id, "count": bad.count()}))

                references = normalized_references(
                    payout.provider_reference,
                    payout.provider_payout_id,
                    payout.provider_item_reference_code,
                )
                has_settlement_line = has_settlement_line_amount_proof(
                    provider='IYZICO',
                    references=references,
                    amount=int(payout.amount),
                    submerchant_key=payout.business.iyzico_submerchant_key,
                )

                has_proof = SettlementRecord.objects.filter(
                    payout=payout,
                    is_processed=True,
                ).exists() or has_settlement_line
                if not has_proof:
                    issues.append((
                        "PAYOUT_PROOF_MISSING",
                        {"payout_id": payout.id, "provider_reference": payout.provider_reference, "amount": int(payout.amount)},
                    ))

            for payment_intent in PaymentIntent.objects.all().iterator():
                if payment_intent.submerchant_price or payment_intent.platform_fee or payment_intent.gross_price:
                    if payment_intent.submerchant_price + payment_intent.platform_fee != payment_intent.gross_price:
                        issues.append((
                            "MARKETPLACE_SPLIT_INVALID",
                            {
                                "payment_intent_id": payment_intent.pk,
                                "gross": int(payment_intent.gross_price),
                                "submerchant": int(payment_intent.submerchant_price),
                                "fee": int(payment_intent.platform_fee),
                            },
                        ))
                    if payment_intent.marketplace_conversation_id and not payment_intent.marketplace_conversation_id.startswith("HY-PI-"):
                        issues.append((
                            "MARKETPLACE_REF_INVALID",
                            {
                                "payment_intent_id": payment_intent.pk,
                                "conversation_id": payment_intent.marketplace_conversation_id,
                            },
                        ))

            for business in BusinessProfile.objects.filter(is_approved=True).iterator():
                if business.iyzico_submerchant_status == BusinessProfile.IyziSubmerchantStatus.ACTIVE and not business.iyzico_submerchant_key:
                    issues.append(("SUBMERCHANT_KEY_MISSING", {"business_id": business.pk}))

            for record in SettlementRecord.objects.filter(is_processed=True, settled_at__isnull=True).iterator():
                issues.append((
                    "PROCESSED_SETTLEMENT_MISSING_SETTLED_AT",
                    {"settlement_record_id": record.pk, "match_type": record.match_type},
                ))

            for record in SettlementRecord.objects.filter(is_processed=False, created_at__lte=stale_manual_review_cutoff).iterator():
                if is_retryable_settlement_error(record.processing_error) and record.next_retry_at and record.next_retry_at > now:
                    continue
                issues.append((
                    "SETTLEMENT_MANUAL_REVIEW_STALE",
                    {"settlement_record_id": record.pk, "processing_error": record.processing_error},
                ))

            for record in SettlementRecord.objects.filter(is_processed=True).select_related("payment_intent", "payout").iterator():
                if record.match_type == SettlementRecord.MatchType.PAYMENT_INTENT:
                    payment_intent_id = getattr(record, "payment_intent_id", None)
                    if payment_intent_id is None:
                        issues.append(("SETTLEMENT_RECORD_INTENT_LINK_MISSING", {"settlement_record_id": record.pk}))
                    elif int(record.amount) != int(record.payment_intent.amount):
                        issues.append((
                            "SETTLEMENT_RECORD_INTENT_AMOUNT_MISMATCH",
                            {
                                "settlement_record_id": record.pk,
                                "payment_intent_id": payment_intent_id,
                                "record_amount": int(record.amount),
                                "intent_amount": int(record.payment_intent.amount),
                            },
                        ))
                    if record.business_id is not None and record.submerchant_key and record.business.iyzico_submerchant_key != record.submerchant_key:
                        issues.append((
                            "SETTLEMENT_RECORD_INTENT_BUSINESS_SUBMERCHANT_MISMATCH",
                            {
                                "settlement_record_id": record.pk,
                                "business_id": record.business_id,
                                "submerchant_key": record.submerchant_key,
                            },
                        ))
                elif record.match_type == SettlementRecord.MatchType.PAYOUT:
                    payout_id = getattr(record, "payout_id", None)
                    if payout_id is None:
                        issues.append(("SETTLEMENT_RECORD_PAYOUT_LINK_MISSING", {"settlement_record_id": record.pk}))
                    else:
                        if int(record.amount) != int(record.payout.amount):
                            issues.append((
                                "SETTLEMENT_RECORD_PAYOUT_AMOUNT_MISMATCH",
                                {
                                    "settlement_record_id": record.pk,
                                    "payout_id": payout_id,
                                    "record_amount": int(record.amount),
                                    "payout_amount": int(record.payout.amount),
                                },
                            ))
                        if _norm_currency(record.currency) and _norm_currency(record.payout.currency) and _norm_currency(record.currency) != _norm_currency(record.payout.currency):
                            issues.append((
                                "SETTLEMENT_RECORD_PAYOUT_CURRENCY_MISMATCH",
                                {
                                    "settlement_record_id": record.pk,
                                    "payout_id": payout_id,
                                    "record_currency": str(record.currency),
                                    "payout_currency": str(record.payout.currency),
                                },
                            ))
                        if record.business_id is not None and record.business_id != record.payout.business_id:
                            issues.append((
                                "SETTLEMENT_RECORD_PAYOUT_BUSINESS_MISMATCH",
                                {
                                    "settlement_record_id": record.pk,
                                    "payout_id": payout_id,
                                    "record_business_id": record.business_id,
                                    "payout_business_id": record.payout.business_id,
                                },
                            ))
                        if record.submerchant_key and record.payout.business.iyzico_submerchant_key and record.submerchant_key != record.payout.business.iyzico_submerchant_key:
                            issues.append((
                                "SETTLEMENT_RECORD_PAYOUT_SUBMERCHANT_MISMATCH",
                                {
                                    "settlement_record_id": record.pk,
                                    "payout_id": payout_id,
                                    "record_submerchant_key": record.submerchant_key,
                                    "payout_submerchant_key": record.payout.business.iyzico_submerchant_key,
                                },
                            ))
                        if record.payout.status != "CONFIRMED":
                            issues.append((
                                "SETTLEMENT_RECORD_PAYOUT_STATUS_INVALID",
                                {
                                    "settlement_record_id": record.pk,
                                    "payout_id": payout_id,
                                    "payout_status": record.payout.status,
                                },
                            ))

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
                issues.append((
                    "DUPLICATE_SETTLEMENT_INTENT_MATCH",
                    {
                        "payment_intent_id": row['payment_intent_id'],
                        "count": int(row['total']),
                    },
                ))

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
                issues.append((
                    "DUPLICATE_SETTLEMENT_PAYOUT_MATCH",
                    {
                        "payout_id": row['payout_id'],
                        "count": int(row['total']),
                    },
                ))

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
                    issues.append((
                        "FAILED_PAYOUT_HAS_SETTLEMENT_PROOF",
                        {
                            "payout_id": payout.id,
                            "provider_reference": payout.provider_reference,
                            "provider_payout_id": payout.provider_payout_id,
                        },
                    ))

            for pi in PaymentIntent.objects.filter(
                purpose=PaymentIntent.Purpose.TOPUP,
                status=PaymentIntent.Status.PAID,
                is_settled=False,
                processed_at__isnull=False,
                processed_at__lte=late_settlement_cutoff,
            ).iterator():
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
                if not has_processed_record and not has_raw_proof:
                    issues.append((
                        "LATE_SETTLEMENT",
                        {"payment_intent_id": pi.pk, "processed_at": pi.processed_at.isoformat()},
                    ))

            if issues:
                JobHeartbeatService.failure("verify_financial_integrity", f"issues={len(issues)}", issues=issues[:25], worker=opts["worker"])
                self.stdout.write(self.style.ERROR(f"FAILED: issues={len(issues)}"))
                for issue_type, meta in issues[:200]:
                    self.stdout.write(f"- {issue_type}: {meta}")
                raise SystemExit(2)

            JobHeartbeatService.success("verify_financial_integrity", worker=opts["worker"])
            self.stdout.write(self.style.SUCCESS("OK: no issues found"))
