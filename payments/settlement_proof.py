from __future__ import annotations

from django.db.models import Q, Sum

from payments.models import PaymentIntent, SettlementLine, SettlementRecord
from payouts.models import Payout


def normalized_references(*values: str | None) -> list[str]:
    refs: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = str(value or '').strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        refs.append(normalized)
    return refs


def has_settlement_line_amount_proof(
    *,
    provider: str,
    references: list[str],
    amount: int,
    submerchant_key: str = '',
) -> bool:
    if not references:
        return False

    qs = SettlementLine.objects.filter(
        provider__iexact=str(provider or '').strip(),
        provider_reference__in=references,
    )
    if submerchant_key:
        qs = qs.filter(submerchant_key=str(submerchant_key).strip())

    if qs.filter(amount=int(amount)).exists():
        return True

    total = int(qs.aggregate(total=Sum('amount'))['total'] or 0)
    return total == int(amount)



def _record_reference_query(references: list[str]) -> Q:
    if not references:
        return Q(pk__in=[])
    return (
        Q(provider_reference__in=references, provider_reference__gt='')
        | Q(external_transaction_id__in=references, external_transaction_id__gt='')
        | Q(settlement_reference_code__in=references, settlement_reference_code__gt='')
        | Q(conversation_id__in=references, conversation_id__gt='')
    )


def has_settlement_record_evidence_for_payout(*, payout: Payout, references: list[str]) -> bool:
    reference_query = _record_reference_query(references)
    return SettlementRecord.objects.filter(
        is_processed=True,
        amount=int(payout.amount),
        currency__iexact=payout.currency,
    ).filter(
        Q(payout=payout)
        | (
            reference_query
            & Q(match_type__in=[SettlementRecord.MatchType.UNMATCHED, SettlementRecord.MatchType.PAYOUT])
            & Q(payment_intent__isnull=True)
        )
    ).exists()


def has_settlement_record_evidence_for_intent(*, payment_intent: PaymentIntent, references: list[str]) -> bool:
    reference_query = _record_reference_query(references)
    return SettlementRecord.objects.filter(
        is_processed=True,
        amount=int(payment_intent.amount),
    ).filter(
        Q(payment_intent=payment_intent)
        | (
            reference_query
            & Q(match_type__in=[SettlementRecord.MatchType.UNMATCHED, SettlementRecord.MatchType.PAYMENT_INTENT])
            & Q(payout__isnull=True)
        )
    ).exists()
