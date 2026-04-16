from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Dict, List

from django.conf import settings
from django.db.models import Sum
from django.utils import timezone

from businesses.models import BusinessProfile
from orders.accounting import collect_business_earning_mismatches, collect_order_accounting_mismatches
from payments.models import SettlementRecord
from payments.settlement_proof import (
    has_settlement_line_amount_proof,
    has_settlement_record_evidence_for_payout,
    normalized_references,
)
from payouts.models import BusinessEarning, Payout, PayoutAdjustment, PayoutItem
from payouts.services import get_earning_outstanding_amount


def _norm_currency(value: str) -> str:
    return str(value or '').strip().upper()


@dataclass(frozen=True)
class ReconciliationReport:
    summary: Dict[str, Any]
    issues: List[Dict[str, Any]]


def reconcile_business(business: BusinessProfile) -> ReconciliationReport:
    issues: List[Dict[str, Any]] = []

    recent_payouts = Payout.objects.filter(business=business).prefetch_related('items').order_by('-id')[:200]
    for payout in recent_payouts:
        items_sum = payout.items.aggregate(total=Sum('amount'))['total'] or 0
        if int(items_sum) != int(payout.amount):
            issues.append(
                {
                    'type': 'PAYOUT_ITEM_SUM_MISMATCH',
                    'payout_id': payout.id,
                    'payout_amount': int(payout.amount),
                    'items_sum': int(items_sum),
                }
            )

        references = normalized_references(
            payout.provider_reference,
            payout.provider_payout_id,
            payout.provider_item_reference_code,
        )
        has_processed_record = has_settlement_record_evidence_for_payout(
            payout=payout,
            references=references,
        )
        has_raw_proof = has_settlement_line_amount_proof(
            provider='IYZICO',
            references=references,
            amount=int(payout.amount),
            submerchant_key=business.iyzico_submerchant_key,
        )
        if payout.status in {'SENT', 'CONFIRMED'} and not has_processed_record and not has_raw_proof:
            issues.append(
                {
                    'type': 'PAYOUT_SETTLEMENT_PROOF_MISSING',
                    'payout_id': payout.id,
                    'payout_status': payout.status,
                    'provider_reference': payout.provider_reference,
                }
            )

        if payout.status == "SENT" and not payout.provider_payout_id:
            issues.append(
                {
                    'type': 'SENT_PAYOUT_PROVIDER_ID_MISSING',
                    'payout_id': payout.id,
                    'provider_reference': payout.provider_reference,
                }
            )

        if (
            payout.status == "SENT"
            and payout.next_retry_at is None
            and int(payout.status_sync_attempt_count or 0) >= 1
            and payout.provider_error
        ):
            issues.append(
                {
                    'type': 'SENT_PAYOUT_MANUAL_REVIEW_REQUIRED',
                    'payout_id': payout.id,
                    'provider_reference': payout.provider_reference,
                    'last_error_code': payout.last_error_code,
                    'status_sync_attempt_count': int(payout.status_sync_attempt_count or 0),
                }
            )

        if payout.status in {"SENT", "CONFIRMED"} and not payout.provider_dispatch_payload:
            issues.append(
                {
                    'type': 'PAYOUT_DISPATCH_PAYLOAD_MISSING',
                    'payout_id': payout.id,
                    'provider_reference': payout.provider_reference,
                }
            )

        if payout.status == "DISPATCHING" and payout.locked_at is None:
            issues.append(
                {
                    'type': 'DISPATCHING_PAYOUT_LOCK_MISSING',
                    'payout_id': payout.id,
                    'provider_reference': payout.provider_reference,
                }
            )


    for earning in BusinessEarning.objects.filter(business=business).select_related("order").order_by('-id')[:200]:
        order = earning.order
        if order is None:
            continue
        for mismatch in collect_order_accounting_mismatches(order=order):
            mismatch_issue = dict(mismatch)
            mismatch_issue.setdefault('business_id', business.pk)
            issues.append(mismatch_issue)
        for mismatch in collect_business_earning_mismatches(earning=earning):
            mismatch_issue = dict(mismatch)
            mismatch_issue.setdefault('business_id', business.pk)
            issues.append(mismatch_issue)

    for payout in Payout.objects.filter(business=business, status='CONFIRMED').order_by('-id')[:200]:
        for item in PayoutItem.objects.select_related('earning').filter(payout=payout):
            if item.earning.status != BusinessEarning.Status.PAID:
                issues.append(
                    {
                        'type': 'CONFIRMED_PAYOUT_EARNING_NOT_PAID',
                        'payout_id': payout.id,
                        'earning_id': item.earning.id,
                        'earning_status': item.earning.status,
                    }
                )

    orphan_records = SettlementRecord.objects.filter(business=business, is_processed=True, payout__isnull=True, payment_intent__isnull=True).order_by('-id')[:50]
    for record in orphan_records:
        issues.append(
            {
                'type': 'SETTLEMENT_RECORD_ORPHAN',
                'settlement_record_id': record.id,
                'external_settlement_id': record.external_settlement_id,
            }
        )

    stale_hours = max(int(getattr(settings, 'SETTLEMENT_MANUAL_REVIEW_STALE_HOURS', 12)), 1)
    stale_cutoff = timezone.now() - timedelta(hours=stale_hours)

    review_records = SettlementRecord.objects.filter(business=business, is_processed=False).order_by('-id')[:50]
    manual_review_codes: dict[str, int] = {}
    stale_manual_review_total = SettlementRecord.objects.filter(
        business=business,
        is_processed=False,
        created_at__lte=stale_cutoff,
    ).count()
    for record in review_records:
        error_code = str((record.processing_error or '').split(':', 1)[0]).strip().upper() or 'UNKNOWN'
        manual_review_codes[error_code] = int(manual_review_codes.get(error_code, 0)) + 1
        issue = {
            'type': 'SETTLEMENT_RECORD_MANUAL_REVIEW',
            'settlement_record_id': record.id,
            'external_settlement_id': record.external_settlement_id,
            'processing_error': record.processing_error,
            'processing_error_code': error_code,
            'provider_reference': record.provider_reference,
        }
        if record.created_at and record.created_at <= stale_cutoff:
            issue['stale_manual_review'] = True
        issues.append(issue)

    payout_records = SettlementRecord.objects.filter(business=business, payout__isnull=False, is_processed=True).select_related('payout').order_by('-id')[:100]
    for record in payout_records:
        if int(record.amount) != int(record.payout.amount):
            issues.append(
                {
                    'type': 'SETTLEMENT_PAYOUT_AMOUNT_MISMATCH',
                    'settlement_record_id': record.id,
                    'payout_id': record.payout_id,
                    'record_amount': int(record.amount),
                    'payout_amount': int(record.payout.amount),
                }
                )
        if _norm_currency(record.currency) and _norm_currency(record.payout.currency) and _norm_currency(record.currency) != _norm_currency(record.payout.currency):
            issues.append(
                {
                    'type': 'SETTLEMENT_PAYOUT_CURRENCY_MISMATCH',
                    'settlement_record_id': record.id,
                    'payout_id': record.payout_id,
                    'record_currency': str(record.currency),
                    'payout_currency': str(record.payout.currency),
                }
            )

    for adjustment in PayoutAdjustment.objects.filter(business=business).order_by('-id')[:500]:
        if adjustment.status == PayoutAdjustment.Status.APPLIED and adjustment.payout_id is None:
            issues.append(
                {
                    'type': 'APPLIED_ADJUSTMENT_WITHOUT_PAYOUT',
                    'adjustment_id': adjustment.id,
                    'order_id': adjustment.order_id,
                }
            )
        if adjustment.status == PayoutAdjustment.Status.PENDING and adjustment.payout_id is not None:
            issues.append(
                {
                    'type': 'PENDING_ADJUSTMENT_ALREADY_LINKED',
                    'adjustment_id': adjustment.id,
                    'payout_id': adjustment.payout_id,
                }
            )

    counts = {
        'PENDING': BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.PENDING).count(),
        'ELIGIBLE': BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.ELIGIBLE).count(),
        'IN_PAYOUT': BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.IN_PAYOUT).count(),
        'PAID': BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.PAID).count(),
        'FAILED': BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.FAILED).count(),
        'REVERSED': BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.REVERSED).count(),
    }

    pending_earnings = list(BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.PENDING).only('net_amount', 'reversed_amount'))
    eligible_earnings = list(BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.ELIGIBLE).only('net_amount', 'reversed_amount'))
    in_payout_earnings = list(BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.IN_PAYOUT).only('net_amount', 'reversed_amount'))
    paid_earnings = list(BusinessEarning.objects.filter(business=business, status=BusinessEarning.Status.PAID).only('net_amount', 'reversed_amount'))

    amounts = {
        'pending_outstanding_amount': sum(get_earning_outstanding_amount(earning=earning) for earning in pending_earnings),
        'eligible_outstanding_amount': sum(get_earning_outstanding_amount(earning=earning) for earning in eligible_earnings),
        'in_payout_outstanding_amount': sum(get_earning_outstanding_amount(earning=earning) for earning in in_payout_earnings),
        'paid_outstanding_amount': sum(get_earning_outstanding_amount(earning=earning) for earning in paid_earnings),
    }

    summary = {
        'business_id': business.pk,
        'stale_manual_review_settlement_records_total': int(stale_manual_review_total),
        'earnings_count': counts,
        'earning_amounts': amounts,
        'pending_adjustments_total': int(
            PayoutAdjustment.objects.filter(business=business, status=PayoutAdjustment.Status.PENDING).aggregate(total=Sum('amount'))['total']
            or 0
        ),
        'payouts_total': Payout.objects.filter(business=business).count(),
        'processed_settlement_records_total': SettlementRecord.objects.filter(business=business, is_processed=True).count(),
        'manual_review_settlement_records_total': SettlementRecord.objects.filter(business=business, is_processed=False).count(),
        'manual_review_codes': manual_review_codes,
        'issues_count': len(issues),
    }
    return ReconciliationReport(summary=summary, issues=issues)
