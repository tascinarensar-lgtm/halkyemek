from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from businesses.models import BusinessProfile
from payments.models import PaymentIntent, ProviderEvent, SettlementImport, SettlementRecord
from payments.services import normalize_provider_name, resolve_payment_intent_for_webhook, settle_intent_from_provider
from payouts.models import Payout, PayoutItem
from payouts.services import PayoutService


class SettlementProcessingError(Exception):
    pass


@dataclass
class SettlementImportSummary:
    total: int = 0
    created: int = 0
    duplicates: int = 0
    processed: int = 0
    errors: int = 0


ERROR_UNSUPPORTED_PURPOSE = 'UNSUPPORTED_PURPOSE'
ERROR_PAYMENT_INTENT_AMOUNT_MISMATCH = 'PAYMENT_INTENT_AMOUNT_MISMATCH'
ERROR_PAYOUT_MATCH_ERROR = 'PAYOUT_MATCH_ERROR'
ERROR_PAYOUT_STATUS_NOT_CONFIRMABLE = 'PAYOUT_STATUS_NOT_CONFIRMABLE'
ERROR_MATCHING_ENTITY_NOT_FOUND = 'MATCHING_ENTITY_NOT_FOUND'
ERROR_MISSING_REFERENCE_DATA = 'MISSING_REFERENCE_DATA'
ERROR_PAYOUT_AMOUNT_MISMATCH = 'PAYOUT_AMOUNT_MISMATCH'
ERROR_PAYOUT_CURRENCY_MISMATCH = 'PAYOUT_CURRENCY_MISMATCH'
ERROR_PARTIAL_PROVIDER_RESPONSE = 'PARTIAL_PROVIDER_RESPONSE'
ERROR_AMBIGUOUS_PAYMENT_INTENT_MATCH = 'AMBIGUOUS_PAYMENT_INTENT_MATCH'
ERROR_DUPLICATE_SETTLEMENT_MATCH = 'DUPLICATE_SETTLEMENT_MATCH'
ERROR_PAYMENT_INTENT_NOT_READY = 'PAYMENT_INTENT_NOT_READY'
ERROR_CROSS_ENTITY_MATCH_CONFLICT = 'CROSS_ENTITY_MATCH_CONFLICT'
ERROR_SUBMERCHANT_KEY_MISMATCH = 'SUBMERCHANT_KEY_MISMATCH'

_NON_RETRYABLE_SETTLEMENT_ERROR_CODES = {
    ERROR_UNSUPPORTED_PURPOSE,
    ERROR_PAYMENT_INTENT_AMOUNT_MISMATCH,
    ERROR_PAYOUT_MATCH_ERROR,
    ERROR_PAYOUT_AMOUNT_MISMATCH,
    ERROR_PAYOUT_CURRENCY_MISMATCH,
    ERROR_PARTIAL_PROVIDER_RESPONSE,
    ERROR_AMBIGUOUS_PAYMENT_INTENT_MATCH,
    ERROR_DUPLICATE_SETTLEMENT_MATCH,
    ERROR_MISSING_REFERENCE_DATA,
    ERROR_SUBMERCHANT_KEY_MISMATCH,
    ERROR_CROSS_ENTITY_MATCH_CONFLICT,
}


def _normalize_str(value: Any) -> str:
    return str(value or '').strip()


def format_settlement_error(code: str, detail: str) -> str:
    return f'{code}: {detail}'


def extract_settlement_error_code(message: str | None) -> str:
    raw = _normalize_str(message)
    if not raw:
        return ''
    prefix, _, _ = raw.partition(':')
    return _normalize_str(prefix).upper()


def is_retryable_settlement_error(message: str | None) -> bool:
    code = extract_settlement_error_code(message)
    if not code:
        return True
    return code not in _NON_RETRYABLE_SETTLEMENT_ERROR_CODES


def _extract_candidate_values(record: SettlementRecord) -> dict[str, str]:
    payload = record.raw_payload or {}
    settlement_reference_code = _normalize_str(
        payload.get('settlementReferenceCode')
        or record.settlement_reference_code
        or record.external_settlement_id
    )
    provider_reference = _normalize_str(
        payload.get('merchantReference')
        or record.provider_reference
        or record.external_transaction_id
    )
    conversation_id = _normalize_str(
        payload.get('paymentConversationId')
        or payload.get('conversationId')
        or record.conversation_id
    )
    payment_id = _normalize_str(
        payload.get('paymentId')
        or record.external_transaction_id
    )
    submerchant_key = _normalize_str(
        payload.get('subMerchantKey')
        or record.submerchant_key
    )
    return {
        'external_transaction_id': _normalize_str(record.external_transaction_id),
        'payment_id': payment_id,
        'conversation_id': conversation_id,
        'settlement_reference_code': settlement_reference_code,
        'provider_reference': provider_reference,
        'submerchant_key': submerchant_key,
    }




def _validated_singleton_candidate_id(*, field_matches: dict[str, set[int]], entity_name: str) -> int | None:
    singleton_fields: dict[str, int] = {}
    for field_name, ids in field_matches.items():
        if not ids:
            continue
        normalized_ids = {int(item) for item in ids}
        if len(normalized_ids) > 1:
            raise SettlementProcessingError(
                f'Ambiguous {entity_name} match via {field_name} candidates={sorted(normalized_ids)}'
            )
        singleton_fields[field_name] = next(iter(normalized_ids))
    if not singleton_fields:
        return None
    unique_ids = sorted(set(singleton_fields.values()))
    if len(unique_ids) > 1:
        raise SettlementProcessingError(
            f'Conflicting {entity_name} identifiers {singleton_fields}'
        )
    return int(unique_ids[0])


def _best_scored_candidate(*, scored: list[tuple[int, int]], entity_name: str) -> int | None:
    if not scored:
        return None
    scored = sorted(scored, key=lambda item: (-item[0], item[1]))
    best_score, best_id = scored[0]
    if best_score <= 0:
        return None
    tied = [candidate_id for score, candidate_id in scored if score == best_score]
    if len(tied) > 1:
        raise SettlementProcessingError(f'Ambiguous {entity_name} match candidates={sorted(tied)} score={best_score}')
    return int(best_id)


def _resolve_payment_intent(record: SettlementRecord) -> PaymentIntent | None:
    values = _extract_candidate_values(record)
    base_q = PaymentIntent.objects.select_for_update()
    conversation_id = values['conversation_id']
    provider_payment_ids = {
        values['payment_id'],
        values['external_transaction_id'],
        values['provider_reference'],
    }
    provider_payment_ids = {item for item in provider_payment_ids if item}
    settlement_reference_code = values['settlement_reference_code']

    candidate_filter = Q()
    if conversation_id:
        candidate_filter |= Q(marketplace_conversation_id=conversation_id)
    if provider_payment_ids:
        candidate_filter |= Q(provider_payment_id__in=provider_payment_ids)
    if settlement_reference_code:
        candidate_filter |= Q(settlement_reference_code=settlement_reference_code)

    if candidate_filter:
        candidates = list(base_q.filter(candidate_filter).order_by('pk')[:25])
        field_matches = {
            'conversation_id': {int(candidate.pk) for candidate in candidates if conversation_id and candidate.marketplace_conversation_id == conversation_id},
            'provider_payment_id': {int(candidate.pk) for candidate in candidates if provider_payment_ids and _normalize_str(candidate.provider_payment_id) in provider_payment_ids},
            'settlement_reference_code': {int(candidate.pk) for candidate in candidates if settlement_reference_code and _normalize_str(candidate.settlement_reference_code) == settlement_reference_code},
        }
        singleton_id = _validated_singleton_candidate_id(field_matches=field_matches, entity_name='payment intent')
        if singleton_id is not None:
            return next((candidate for candidate in candidates if int(candidate.pk) == singleton_id), None)

        scored: list[tuple[int, int]] = []
        for candidate in candidates:
            score = 0
            if conversation_id and candidate.marketplace_conversation_id == conversation_id:
                score += 4
            if provider_payment_ids and _normalize_str(candidate.provider_payment_id) in provider_payment_ids:
                score += 3
            if settlement_reference_code and _normalize_str(candidate.settlement_reference_code) == settlement_reference_code:
                score += 2
            if score > 0:
                scored.append((score, int(candidate.pk)))
        best_id = _best_scored_candidate(scored=scored, entity_name='payment intent')
        if best_id is not None:
            return next((candidate for candidate in candidates if int(candidate.pk) == best_id), None)

    return resolve_payment_intent_for_webhook(
        intent_id=None,
        provider_payment_id=values['payment_id'] or values['external_transaction_id'] or values['provider_reference'] or None,
        conversation_id=values['conversation_id'] or None,
    )


def _has_duplicate_processed_record(
    *,
    record: SettlementRecord,
    payment_intent: PaymentIntent | None = None,
    payout: Payout | None = None,
) -> bool:
    qs = SettlementRecord.objects.filter(is_processed=True).exclude(pk=record.pk)
    if payment_intent is not None:
        return qs.filter(
            payment_intent=payment_intent,
            match_type=SettlementRecord.MatchType.PAYMENT_INTENT,
        ).exists()
    if payout is not None:
        return qs.filter(
            payout=payout,
            match_type=SettlementRecord.MatchType.PAYOUT,
        ).exists()
    return False


def _resolve_payout(record: SettlementRecord) -> Payout | None:
    values = _extract_candidate_values(record)
    references = {
        values['provider_reference'],
        values['settlement_reference_code'],
        values['payment_id'],
        values['external_transaction_id'],
    }
    references = {ref for ref in references if ref}
    if not references:
        return None

    qs = Payout.objects.select_for_update().select_related('business').filter(
        Q(provider_reference__in=references)
        | Q(provider_payout_id__in=references)
        | Q(provider_item_reference_code__in=references)
    )
    submerchant_key = values['submerchant_key']
    if submerchant_key:
        qs = qs.filter(business__iyzico_submerchant_key=submerchant_key)

    candidates = list(qs.order_by('-id')[:25])
    if not candidates:
        return None

    normalized_currency = _normalize_str(record.currency).upper()
    field_matches = {
        'provider_reference': {int(candidate.pk) for candidate in candidates if _normalize_str(candidate.provider_reference) in references},
        'provider_payout_id': {int(candidate.pk) for candidate in candidates if _normalize_str(candidate.provider_payout_id) in references},
        'provider_item_reference_code': {int(candidate.pk) for candidate in candidates if _normalize_str(candidate.provider_item_reference_code) in references},
    }
    singleton_id = _validated_singleton_candidate_id(field_matches=field_matches, entity_name='payout')
    if singleton_id is not None:
        return next((candidate for candidate in candidates if int(candidate.pk) == singleton_id), None)

    scored: list[tuple[int, int]] = []
    for candidate in candidates:
        score = 0
        if _normalize_str(candidate.provider_reference) in references:
            score += 5
        if _normalize_str(candidate.provider_payout_id) in references:
            score += 4
        if _normalize_str(candidate.provider_item_reference_code) in references:
            score += 3
        if int(candidate.amount) == int(record.amount):
            score += 2
        if normalized_currency and _normalize_str(candidate.currency).upper() == normalized_currency:
            score += 1
        if score > 0:
            scored.append((score, int(candidate.pk)))

    best_id = _best_scored_candidate(scored=scored, entity_name='payout')
    if best_id is None:
        return None
    return next((candidate for candidate in candidates if int(candidate.pk) == best_id), None)


def _apply_record_metadata(record: SettlementRecord) -> dict[str, str]:
    values = _extract_candidate_values(record)
    record.settlement_reference_code = values['settlement_reference_code']
    record.provider_reference = values['provider_reference']
    record.conversation_id = values['conversation_id']
    record.submerchant_key = values['submerchant_key']
    return values


def _resolve_business_from_submerchant_key(record: SettlementRecord) -> BusinessProfile | None:
    submerchant_key = _normalize_str(record.submerchant_key)
    if not submerchant_key:
        return None

    business_ids = list(
        BusinessProfile.objects.filter(iyzico_submerchant_key=submerchant_key).values_list('pk', flat=True)[:2]
    )
    if len(business_ids) != 1:
        return None
    return BusinessProfile.objects.filter(pk=int(business_ids[0])).first()




def _resolve_business_for_payment_intent(*, record: SettlementRecord, payment_intent: PaymentIntent) -> BusinessProfile | None:
    record_submerchant_key = _normalize_str(record.submerchant_key)
    intent_submerchant_key = _normalize_str(payment_intent.submerchant_key)
    if record_submerchant_key and intent_submerchant_key and record_submerchant_key != intent_submerchant_key:
        raise SettlementProcessingError(
            format_settlement_error(
                ERROR_SUBMERCHANT_KEY_MISMATCH,
                f'Settlement submerchant_key={record_submerchant_key} does not match payment intent submerchant_key={intent_submerchant_key}.',
            )
        )
    effective_submerchant_key = record_submerchant_key or intent_submerchant_key
    if not effective_submerchant_key:
        return None

    business = BusinessProfile.objects.filter(iyzico_submerchant_key=effective_submerchant_key).first()
    if business is None:
        raise SettlementProcessingError(
            format_settlement_error(
                ERROR_MATCHING_ENTITY_NOT_FOUND,
                f'No business found for submerchant_key={effective_submerchant_key}.',
            )
        )
    return business


def _check_cross_entity_match_conflict(*, record: SettlementRecord, payment_intent: PaymentIntent | None, payout: Payout | None) -> None:
    if payment_intent is None or payout is None:
        return

    values = _extract_candidate_values(record)
    conflicting_fields: list[str] = []
    if values['provider_reference'] and _normalize_str(payout.provider_reference) == values['provider_reference']:
        conflicting_fields.append('provider_reference')
    if values['payment_id'] and _normalize_str(payout.provider_payout_id) == values['payment_id']:
        conflicting_fields.append('provider_payout_id')
    if values['external_transaction_id'] and _normalize_str(payout.provider_payout_id) == values['external_transaction_id']:
        conflicting_fields.append('external_transaction_id')
    if values['settlement_reference_code'] and _normalize_str(payout.provider_item_reference_code) == values['settlement_reference_code']:
        conflicting_fields.append('provider_item_reference_code')

    if conflicting_fields:
        raise SettlementProcessingError(
            format_settlement_error(
                ERROR_CROSS_ENTITY_MATCH_CONFLICT,
                f'Settlement row matches both payment_intent={payment_intent.pk} and payout={payout.pk} via {", ".join(conflicting_fields)}.',
            )
        )


def _mark_manual_review(
    *,
    record: SettlementRecord,
    match_type: str,
    error_message: str,
    payment_intent: PaymentIntent | None = None,
    payout: Payout | None = None,
) -> None:
    record.match_type = match_type
    record.payment_intent = payment_intent
    record.payout = payout
    derived_business = payout.business if payout is not None else _resolve_business_from_submerchant_key(record)
    record.business = derived_business
    record.order = None
    record.provider_event = None
    record.is_processed = False
    record.processed_at = None
    record.settled_at = None
    record.processing_error = error_message
    record.unmatched_reason_code = extract_settlement_error_code(error_message)
    record.review_status = SettlementRecord.ReviewStatus.OPEN
    now = timezone.now()
    record.last_reviewed_at = now
    if record.unmatched_opened_at is None:
        record.unmatched_opened_at = now
    record.unmatched_resolved_at = None
    record.save()


def _validate_existing_record_identity(
    *,
    record: SettlementRecord,
    amount: int,
    currency: str,
) -> None:
    incoming_amount = int(amount)
    incoming_currency = (_normalize_str(currency) or 'TRY').upper()

    if int(record.amount) != incoming_amount:
        raise ValidationError(
            f"Settlement record conflict for external_settlement_id={record.external_settlement_id}: "
            f"existing_amount={int(record.amount)} incoming_amount={incoming_amount}"
        )
    if _normalize_str(record.currency).upper() != incoming_currency:
        raise ValidationError(
            f"Settlement record conflict for external_settlement_id={record.external_settlement_id}: "
            f"existing_currency={record.currency} incoming_currency={incoming_currency}"
        )


def record_settlement_row(
    *,
    provider: str,
    external_settlement_id: str,
    external_transaction_id: str = '',
    amount: int,
    currency: str = 'TRY',
    raw_payload: dict | None = None,
    settlement_import: SettlementImport | None = None,
    row_number: int | None = None,
    row_fingerprint: str = '',
):
    raw_payload = raw_payload or {}
    provider = normalize_provider_name(provider)

    values = {
        'external_transaction_id': _normalize_str(external_transaction_id),
        'settlement_reference_code': _normalize_str(
            raw_payload.get('settlementReferenceCode')
            or external_settlement_id
        ),
        'provider_reference': _normalize_str(
            raw_payload.get('merchantReference')
            or external_transaction_id
        ),
        'conversation_id': _normalize_str(
            raw_payload.get('paymentConversationId')
            or raw_payload.get('conversationId')
        ),
        'submerchant_key': _normalize_str(
            raw_payload.get('subMerchantKey')
        ),
    }

    record, created = SettlementRecord.objects.get_or_create(
        provider=provider,
        external_settlement_id=_normalize_str(external_settlement_id),
        defaults={
            'external_transaction_id': values['external_transaction_id'],
            'amount': int(amount),
            'currency': (_normalize_str(currency) or 'TRY').upper(),
            'raw_payload': raw_payload,
            'settlement_reference_code': values['settlement_reference_code'],
            'provider_reference': values['provider_reference'],
            'conversation_id': values['conversation_id'],
            'submerchant_key': values['submerchant_key'],
            'settlement_import': settlement_import,
            'row_number': row_number,
            'row_fingerprint': _normalize_str(row_fingerprint),
        },
    )

    if not created:
        _validate_existing_record_identity(record=record, amount=int(amount), currency=currency)
        changed = False
        if settlement_import is not None and record.settlement_import_id not in {None, settlement_import.pk}:
            raise ValidationError(
                f"Settlement record import drift: existing_import_id={record.settlement_import_id} incoming_import_id={settlement_import.pk}"
            )
        for field_name, value in {
            'external_transaction_id': values['external_transaction_id'],
            'currency': (_normalize_str(currency) or 'TRY').upper(),
            'settlement_reference_code': values['settlement_reference_code'],
            'provider_reference': values['provider_reference'],
            'conversation_id': values['conversation_id'],
            'submerchant_key': values['submerchant_key'],
            'row_fingerprint': _normalize_str(row_fingerprint),
        }.items():
            if not value:
                continue
            current = _normalize_str(getattr(record, field_name))
            if current == value:
                continue
            if current:
                raise ValidationError(
                    f"Settlement record identifier drift for field={field_name}: "
                    f"existing={current} incoming={value}"
                )
            setattr(record, field_name, value)
            changed = True
        if settlement_import is not None and record.settlement_import_id is None:
            record.settlement_import = settlement_import
            changed = True
        if row_number is not None and record.row_number in {None, row_number}:
            if record.row_number != row_number:
                record.row_number = row_number
                changed = True
        elif row_number is not None and record.row_number != row_number:
            raise ValidationError(
                f"Settlement record row drift: existing_row_number={record.row_number} incoming_row_number={row_number}"
            )
        if raw_payload and record.raw_payload != raw_payload:
            if record.is_processed and record.raw_payload:
                raise ValidationError(
                    f"Processed settlement record is immutable for raw_payload: "
                    f"external_settlement_id={record.external_settlement_id}"
                )
            record.raw_payload = raw_payload
            changed = True
        if changed:
            record.save()

    return record, created


def process_settlement_record(record: SettlementRecord) -> bool:
    error_to_raise: SettlementProcessingError | None = None
    processed_now = False

    with transaction.atomic():
        record = SettlementRecord.objects.select_for_update().get(pk=record.pk)

        if record.is_processed:
            return False

        values = _apply_record_metadata(record)

        try:
            payment_intent = _resolve_payment_intent(record)
        except SettlementProcessingError as exc:
            message = format_settlement_error(
                ERROR_AMBIGUOUS_PAYMENT_INTENT_MATCH,
                str(exc),
            )
            _mark_manual_review(
                record=record,
                match_type=SettlementRecord.MatchType.UNMATCHED,
                error_message=message,
            )
            error_to_raise = SettlementProcessingError(message)
            payment_intent = None

        payout_candidate = None
        if error_to_raise is None:
            try:
                payout_candidate = _resolve_payout(record)
            except SettlementProcessingError as exc:
                if payment_intent is None:
                    message = format_settlement_error(ERROR_PAYOUT_MATCH_ERROR, str(exc))
                    _mark_manual_review(
                        record=record,
                        match_type=SettlementRecord.MatchType.PAYOUT,
                        error_message=message,
                    )
                    error_to_raise = SettlementProcessingError(message)
                else:
                    payout_candidate = None

        if error_to_raise is None:
            try:
                _check_cross_entity_match_conflict(record=record, payment_intent=payment_intent, payout=payout_candidate)
            except SettlementProcessingError as exc:
                _mark_manual_review(
                    record=record,
                    match_type=SettlementRecord.MatchType.UNMATCHED,
                    error_message=str(exc),
                    payment_intent=payment_intent,
                    payout=payout_candidate,
                )
                error_to_raise = exc

        if payment_intent is not None and error_to_raise is None:
            if _has_duplicate_processed_record(record=record, payment_intent=payment_intent):
                message = format_settlement_error(
                    ERROR_DUPLICATE_SETTLEMENT_MATCH,
                    f'Payment intent={payment_intent.pk} already has a processed settlement record.',
                )
                _mark_manual_review(
                    record=record,
                    match_type=SettlementRecord.MatchType.PAYMENT_INTENT,
                    error_message=message,
                    payment_intent=payment_intent,
                )
                error_to_raise = SettlementProcessingError(message)
            elif payment_intent.purpose != PaymentIntent.Purpose.TOPUP:
                message = format_settlement_error(
                    ERROR_UNSUPPORTED_PURPOSE,
                    f'Unsupported settlement for payment intent purpose={payment_intent.purpose}',
                )
                _mark_manual_review(
                    record=record,
                    match_type=SettlementRecord.MatchType.UNMATCHED,
                    error_message=message,
                    payment_intent=payment_intent,
                )
                error_to_raise = SettlementProcessingError(message)
            elif payment_intent.status != PaymentIntent.Status.PAID or not payment_intent.is_processed:
                message = format_settlement_error(
                    ERROR_PAYMENT_INTENT_NOT_READY,
                    (
                        f'Payment intent state is not ready for settlement '
                        f'(status={payment_intent.status}, is_processed={payment_intent.is_processed})'
                    ),
                )
                _mark_manual_review(
                    record=record,
                    match_type=SettlementRecord.MatchType.PAYMENT_INTENT,
                    error_message=message,
                    payment_intent=payment_intent,
                )
                error_to_raise = SettlementProcessingError(message)
            elif int(payment_intent.amount) != int(record.amount):
                message = format_settlement_error(
                    ERROR_PAYMENT_INTENT_AMOUNT_MISMATCH,
                    'Matching payment intent amount mismatch.',
                )
                _mark_manual_review(
                    record=record,
                    match_type=SettlementRecord.MatchType.PAYMENT_INTENT,
                    error_message=message,
                    payment_intent=payment_intent,
                )
                error_to_raise = SettlementProcessingError(message)
            else:
                result = settle_intent_from_provider(
                    provider=record.provider,
                    provider_event_id=f'settlement-record:{record.provider}:{record.external_settlement_id}',
                    intent_id=payment_intent.pk,
                    provider_payment_id=values['payment_id'] or payment_intent.provider_payment_id or None,
                    settlement_reference_code=values['settlement_reference_code'] or None,
                    amount=int(record.amount),
                    raw_row=record.raw_payload,
                )
                if result.status not in {'settled', 'already_settled', 'duplicate'}:
                    message = f'Payment settlement failed: {result.status}'
                    record.match_type = SettlementRecord.MatchType.PAYMENT_INTENT
                    record.payment_intent = payment_intent
                    record.processing_error = message
                    if result.provider_event_id:
                        record.provider_event = ProviderEvent.objects.filter(event_id=result.provider_event_id).first()
                    record.save()
                    error_to_raise = SettlementProcessingError(message)
                else:
                    payment_intent.refresh_from_db()
                    try:
                        record_business = _resolve_business_for_payment_intent(record=record, payment_intent=payment_intent)
                    except SettlementProcessingError as exc:
                        _mark_manual_review(
                            record=record,
                            match_type=SettlementRecord.MatchType.PAYMENT_INTENT,
                            error_message=str(exc),
                            payment_intent=payment_intent,
                        )
                        error_to_raise = exc
                    else:
                        record.match_type = SettlementRecord.MatchType.PAYMENT_INTENT
                        record.payment_intent = payment_intent
                        record.business = record_business
                        record.order = None
                        record.payout = None
                        if result.provider_event_id:
                            record.provider_event = ProviderEvent.objects.filter(event_id=result.provider_event_id).first()
                        record.settled_at = payment_intent.settled_at or timezone.now()
                        record.is_processed = True
                        record.processed_at = timezone.now()
                        record.processing_error = ''
                        record.unmatched_reason_code = ''
                        record.review_status = SettlementRecord.ReviewStatus.RESOLVED
                        record.last_reviewed_at = timezone.now()
                        record.unmatched_resolved_at = timezone.now()
                        record.retry_count = 0
                        record.next_retry_at = None
                        record.save()
                        processed_now = True

        if payment_intent is None and error_to_raise is None:
            payout = payout_candidate
            if payout is not None:
                if _has_duplicate_processed_record(record=record, payout=payout):
                    message = format_settlement_error(
                        ERROR_DUPLICATE_SETTLEMENT_MATCH,
                        f'Payout={payout.pk} already has a processed settlement record.',
                    )
                    _mark_manual_review(
                        record=record,
                        match_type=SettlementRecord.MatchType.PAYOUT,
                        error_message=message,
                        payout=payout,
                    )
                    error_to_raise = SettlementProcessingError(message)
                elif _normalize_str(record.currency) and _normalize_str(record.currency).upper() != _normalize_str(payout.currency).upper():
                    message = format_settlement_error(
                        ERROR_PAYOUT_CURRENCY_MISMATCH,
                        f'Settlement currency={record.currency} payout currency={payout.currency}',
                    )
                    _mark_manual_review(
                        record=record,
                        match_type=SettlementRecord.MatchType.PAYOUT,
                        error_message=message,
                        payout=payout,
                    )
                    error_to_raise = SettlementProcessingError(message)
                elif int(record.amount) != int(payout.amount):
                    code = ERROR_PARTIAL_PROVIDER_RESPONSE if int(record.amount) < int(payout.amount) else ERROR_PAYOUT_AMOUNT_MISMATCH
                    message = format_settlement_error(
                        code,
                        f'Settlement amount={int(record.amount)} payout amount={int(payout.amount)}',
                    )
                    _mark_manual_review(
                        record=record,
                        match_type=SettlementRecord.MatchType.PAYOUT,
                        error_message=message,
                        payout=payout,
                    )
                    error_to_raise = SettlementProcessingError(message)
                elif payout.status in {'SENT', 'FAILED'}:
                    if payout.status == 'FAILED':
                        if not PayoutItem.objects.filter(payout=payout).exists():
                            message = format_settlement_error(
                                ERROR_PAYOUT_MATCH_ERROR,
                                'Late settlement matched a failed payout that no longer owns payout items.',
                            )
                            _mark_manual_review(
                                record=record,
                                match_type=SettlementRecord.MatchType.PAYOUT,
                                error_message=message,
                                payout=payout,
                            )
                            error_to_raise = SettlementProcessingError(message)
                        else:
                            payout.status = 'SENT'
                            payout.save(update_fields=['status'])
                    if error_to_raise is None:
                        PayoutService.confirm_payout(
                            payout_id=payout.id,
                            actor=None,
                            source='settlement_import',
                            note=f'Auto-confirm from settlement record {record.external_settlement_id}',
                        )
                        payout.refresh_from_db()

                if error_to_raise is None and payout.status not in {'CONFIRMED', 'SENT'}:
                    message = format_settlement_error(
                        ERROR_PAYOUT_STATUS_NOT_CONFIRMABLE,
                        f'Payout not confirmable from status={payout.status}',
                    )
                    _mark_manual_review(
                        record=record,
                        match_type=SettlementRecord.MatchType.PAYOUT,
                        error_message=message,
                        payout=payout,
                    )
                    error_to_raise = SettlementProcessingError(message)
                elif error_to_raise is None:
                    record.match_type = SettlementRecord.MatchType.PAYOUT
                    record.payout = payout
                    record.business = payout.business
                    record.order = None
                    record.payment_intent = None
                    record.settled_at = payout.confirmed_at or payout.sent_at or timezone.now()
                    record.is_processed = True
                    record.processed_at = timezone.now()
                    record.processing_error = ''
                    record.unmatched_reason_code = ''
                    record.review_status = SettlementRecord.ReviewStatus.RESOLVED
                    record.last_reviewed_at = timezone.now()
                    record.unmatched_resolved_at = timezone.now()
                    record.retry_count = 0
                    record.next_retry_at = None
                    record.save()
                    processed_now = True
            else:
                references_present = any([
                    values['provider_reference'],
                    values['settlement_reference_code'],
                    values['payment_id'],
                    values['external_transaction_id'],
                    values['conversation_id'],
                ])
                if references_present:
                    message = format_settlement_error(ERROR_MATCHING_ENTITY_NOT_FOUND, 'Matching local entity not found.')
                else:
                    message = format_settlement_error(ERROR_MISSING_REFERENCE_DATA, 'Provider row does not include matchable identifiers.')
                _mark_manual_review(
                    record=record,
                    match_type=SettlementRecord.MatchType.UNMATCHED,
                    error_message=message,
                )
                error_to_raise = SettlementProcessingError(message)

    if error_to_raise is not None:
        raise error_to_raise
    return processed_now


def import_settlement_rows(*, provider: str, rows: list[dict]) -> SettlementImportSummary:
    summary = SettlementImportSummary(total=len(rows))

    for row in rows:
        try:
            record, created = record_settlement_row(
                provider=provider,
                external_settlement_id=row['external_settlement_id'],
                external_transaction_id=row.get('external_transaction_id', ''),
                amount=row['amount'],
                currency=row.get('currency', 'TRY'),
                raw_payload=row,
            )
        except Exception:
            summary.errors += 1
            continue
        if created:
            summary.created += 1
        else:
            summary.duplicates += 1

        try:
            processed_now = process_settlement_record(record)
            if processed_now:
                summary.processed += 1
        except Exception:
            summary.errors += 1

    return summary
