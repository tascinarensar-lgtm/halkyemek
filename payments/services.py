from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from businesses.models import BusinessProfile
from payments.marketplace import calculate_split
from payments.models import PaymentIntent, ProviderEvent
from payments.providers.iyzico import (
    IyzicoCheckoutFormClient,
    IyzicoRequestError,
    normalize_iyzico_status,
    parse_payment_intent_id_from_conversation_id,
)
from notifications.models import Notification
from notifications.services import NotificationService
from payments.providers.iyzico_marketplace import build_marketplace_payment_payload
from payments.references import payment_conversation_id
from wallets.services import WalletService


@dataclass(frozen=True)
class SettlementResult:
    status: str
    intent_id: Optional[int] = None
    provider_event_id: Optional[str] = None


def normalize_provider_name(provider: str) -> str:
    value = str(provider or "").strip().upper()
    return value or ProviderEvent.Provider.MOCK


def _resolve_unique_payment_intent(qs) -> PaymentIntent | None:
    ids = list(qs.values_list("id", flat=True)[:2])
    if len(ids) != 1:
        return None
    return qs.filter(id=int(ids[0])).first()


@transaction.atomic
def create_topup_payment_intent(*, user, amount: int, callback_url: str | None = None) -> PaymentIntent:
    if amount <= 0:
        raise ValidationError("payment.amount_must_be_positive")

    intent = PaymentIntent.objects.create(
        user=user,
        purpose=PaymentIntent.Purpose.TOPUP,
        amount=int(amount),
        gross_price=int(amount),
        provider=PaymentIntent.Provider.IYZICO,
        status=PaymentIntent.Status.INITIATED,
    )
    intent.marketplace_conversation_id = payment_conversation_id(intent.pk)
    intent.save(update_fields=["marketplace_conversation_id", "updated_at"])

    if callback_url:
        try:
            init = IyzicoCheckoutFormClient().initialize_topup(intent=intent, callback_url=callback_url)
        except IyzicoRequestError as exc:
            raise ValidationError(f"{exc.code}:{exc.message}") from exc
        intent.provider_session_token = init.token
        intent.provider_page_url = init.payment_page_url
        intent.provider_raw_init = init.raw
        intent.save(update_fields=["provider_session_token", "provider_page_url", "provider_raw_init", "updated_at"])

    return intent


@transaction.atomic
def resolve_payment_intent_for_webhook(
    *,
    intent_id: Optional[int] = None,
    provider_payment_id: Optional[str] = None,
    conversation_id: Optional[str] = None,
) -> PaymentIntent | None:
    qs = PaymentIntent.objects.select_for_update()

    if intent_id is not None:
        intent = qs.filter(id=int(intent_id)).first()
        if intent is not None:
            return intent

    if conversation_id:
        conversation_id = str(conversation_id).strip()
        intent = _resolve_unique_payment_intent(qs.filter(marketplace_conversation_id=conversation_id))
        if intent is not None:
            return intent

        parsed_id = parse_payment_intent_id_from_conversation_id(conversation_id)
        if parsed_id is not None:
            intent = qs.filter(id=parsed_id).first()
            if intent is not None:
                return intent

    if provider_payment_id:
        return _resolve_unique_payment_intent(qs.filter(provider_payment_id=str(provider_payment_id)))

    return None


@transaction.atomic
def mark_intent_terminal(
    *,
    intent: PaymentIntent,
    terminal_status: str,
    normalized_status: str,
    provider_payment_id: Optional[str] = None,
    processing_error: str = "",
) -> PaymentIntent:
    updates = ["status", "normalized_status", "processing_error", "updated_at"]
    intent.status = terminal_status
    intent.normalized_status = normalized_status
    intent.processing_error = processing_error or ""

    if provider_payment_id:
        existing = PaymentIntent.objects.filter(provider_payment_id=str(provider_payment_id)).exclude(pk=intent.pk).first()
        if existing is not None:
            raise ValidationError("payment.provider_payment_id_conflict")
        if intent.provider_payment_id != str(provider_payment_id):
            intent.provider_payment_id = str(provider_payment_id)
            updates.append("provider_payment_id")

    if terminal_status == PaymentIntent.Status.PAID:
        intent.is_processed = True
        intent.processed_at = timezone.now()
        updates.extend(["is_processed", "processed_at"])
    else:
        if intent.is_processed:
            intent.is_processed = False
            updates.append("is_processed")
        if intent.processed_at is not None:
            intent.processed_at = None
            updates.append("processed_at")

    intent.save(update_fields=updates)
    return intent


def _mark_provider_event_processed(provider_event: ProviderEvent) -> None:
    provider_event.processed_at = timezone.now()
    provider_event.save(update_fields=["processed_at"])


@transaction.atomic
def apply_topup_terminal_event(
    *,
    intent: PaymentIntent,
    provider_event: ProviderEvent,
    normalized_status: str,
    provider_payment_id: Optional[str] = None,
    provider_payload: Dict[str, Any] | None = None,
    success_description: str = "Topup paid -> pending",
    failure_reason: str = "provider reported terminal failure",
    cancellation_reason: str = "provider reported cancellation",
) -> str:
    if provider_payload is not None:
        intent.provider_raw_result = provider_payload
        intent.save(update_fields=["provider_raw_result", "updated_at"])

    terminal_status = normalize_iyzico_status(normalized_status)

    if terminal_status == "SUCCESS":
        if intent.is_processed:
            _mark_provider_event_processed(provider_event)
            return "already_processed"

        WalletService.topup_pending(
            user=intent.user,
            amount=int(intent.amount),
            description=success_description,
            provider_event=provider_event,
            payment_intent=intent,
        )
        mark_intent_terminal(
            intent=intent,
            terminal_status=PaymentIntent.Status.PAID,
            normalized_status=terminal_status,
            provider_payment_id=provider_payment_id,
        )
        _mark_provider_event_processed(provider_event)
        return "paid"

    if terminal_status in {"FAILURE", "FAILED"}:
        mark_intent_terminal(
            intent=intent,
            terminal_status=PaymentIntent.Status.FAILED,
            normalized_status=terminal_status,
            provider_payment_id=provider_payment_id,
            processing_error=failure_reason,
        )
        _mark_provider_event_processed(provider_event)
        return "failed"

    if terminal_status in {"CANCELLED", "CANCELED"}:
        mark_intent_terminal(
            intent=intent,
            terminal_status=PaymentIntent.Status.CANCELLED,
            normalized_status="CANCELLED",
            provider_payment_id=provider_payment_id,
            processing_error=cancellation_reason,
        )
        _mark_provider_event_processed(provider_event)
        return "cancelled"

    _mark_provider_event_processed(provider_event)
    return f"ignored_{(terminal_status or 'UNKNOWN').lower()}"


@transaction.atomic
def finalize_topup_from_retrieval(*, token: str) -> tuple[PaymentIntent | None, str]:
    intent = (
        PaymentIntent.objects.select_for_update()
        .filter(provider_session_token=str(token))
        .first()
    )
    if intent is None:
        return None, "intent_not_found"

    try:
        result = IyzicoCheckoutFormClient().retrieve(
            token=str(token),
            conversation_id=intent.marketplace_conversation_id,
        )
    except IyzicoRequestError as exc:
        intent.provider_raw_result = {
            "error": exc.message,
            "error_code": exc.code,
            "http_status": exc.http_status,
            "retryable": exc.retryable,
            "provider_raw": exc.raw,
        }
        intent.processing_error = exc.message[:2000]
        intent.save(update_fields=["provider_raw_result", "processing_error", "updated_at"])
        return intent, "provider_error"
    except ValidationError as exc:
        message = str(exc)
        intent.provider_raw_result = {
            "error": message,
            "error_code": "PROVIDER_CONFIG_ERROR",
            "http_status": 0,
            "retryable": False,
            "provider_raw": {"stage": "retrieve", "token": str(token)},
        }
        intent.processing_error = message[:2000]
        intent.save(update_fields=["provider_raw_result", "processing_error", "updated_at"])
        return intent, "provider_error"

    callback_event_id = f"callback:{intent.marketplace_conversation_id}:{result.token}"
    pe, created = ProviderEvent.objects.get_or_create(
        provider=ProviderEvent.Provider.IYZICO,
        event_id=callback_event_id,
        defaults={
            "event_type": "iyzico.callback.retrieve",
            "payload": result.raw,
            "signature_ok": True,
        },
    )
    if not created and pe.processed_at:
        return intent, "duplicate"

    status_code = apply_topup_terminal_event(
        intent=intent,
        provider_event=pe,
        normalized_status=result.payment_status,
        provider_payment_id=result.payment_id or None,
        provider_payload=result.raw,
        success_description="iyzico callback SUCCESS -> pending",
        failure_reason="iyzico retrieve reported failure",
        cancellation_reason="iyzico retrieve reported cancellation",
    )
    return intent, status_code


@transaction.atomic
def settle_intent_from_provider(
    *,
    provider: str,
    provider_event_id: str,
    intent_id: Optional[int] = None,
    provider_payment_id: Optional[str] = None,
    settlement_reference_code: Optional[str] = None,
    amount: int,
    raw_row: Dict[str, Any] | None = None,
) -> SettlementResult:
    if amount <= 0:
        raise ValidationError("settlement.amount_must_be_positive")

    provider = normalize_provider_name(provider)

    pe, created = ProviderEvent.objects.get_or_create(
        provider=provider,
        event_id=str(provider_event_id),
        defaults={
            "event_type": "settlement.import",
            "payload": raw_row or {},
            "signature_ok": True,
        },
    )
    if not created and pe.processed_at:
        return SettlementResult(status="duplicate", provider_event_id=pe.event_id)

    intent = resolve_payment_intent_for_webhook(
        intent_id=intent_id,
        provider_payment_id=provider_payment_id,
    )

    if intent is None:
        pe.processed_at = timezone.now()
        pe.save(update_fields=["processed_at"])
        return SettlementResult(status="intent_not_found", provider_event_id=pe.event_id)

    if int(intent.amount) != int(amount):
        pe.processed_at = timezone.now()
        pe.save(update_fields=["processed_at"])
        return SettlementResult(status="amount_mismatch", intent_id=intent.pk, provider_event_id=pe.event_id)

    if intent.purpose != PaymentIntent.Purpose.TOPUP:
        pe.processed_at = timezone.now()
        pe.save(update_fields=["processed_at"])
        return SettlementResult(status="unsupported_purpose", intent_id=intent.pk, provider_event_id=pe.event_id)

    if intent.status != PaymentIntent.Status.PAID or not intent.is_processed:
        pe.processed_at = timezone.now()
        pe.save(update_fields=["processed_at"])
        return SettlementResult(status="intent_not_ready", intent_id=intent.pk, provider_event_id=pe.event_id)

    if getattr(intent, "is_settled", False):
        pe.processed_at = timezone.now()
        pe.save(update_fields=["processed_at"])
        return SettlementResult(status="already_settled", intent_id=intent.pk, provider_event_id=pe.event_id)

    WalletService.settle_pending_to_available(
        user=intent.user,
        amount=int(amount),
        description="iyzico settlement",
        provider_event_id=pe.event_id,
        payment_intent_id=intent.pk,
    )

    intent.is_settled = True
    intent.settled_at = timezone.now()
    if settlement_reference_code:
        intent.settlement_reference_code = str(settlement_reference_code)
    intent.save(update_fields=["is_settled", "settled_at", "settlement_reference_code", "updated_at"])

    NotificationService.enqueue(
        user=intent.user,
        type=Notification.Type.PAYMENT_SETTLED,
        title="Bakiyen kullanılabilir oldu",
        body="Cüzdan yüklemen settlement sonrası kullanılabilir bakiyeye geçti.",
        payload={
            "payment_intent_id": intent.pk,
            "provider_event_id": pe.event_id,
            "amount": int(amount),
        },
        dedupe_key=f"payment_settled:{intent.pk}",
    )

    pe.processed_at = timezone.now()
    pe.save(update_fields=["processed_at"])
    return SettlementResult(status="settled", intent_id=intent.pk, provider_event_id=pe.event_id)


@transaction.atomic
def create_marketplace_payment_intent(
    *,
    user,
    order,
    business,
    gross_amount: int,
    commission_bps: int,
):
    if (
        not business.iyzico_submerchant_key
        or business.iyzico_submerchant_status != BusinessProfile.IyziSubmerchantStatus.ACTIVE
        or business.payout_onboarding_status != BusinessProfile.PayoutOnboardingStatus.APPROVED
    ):
        raise ValidationError("business.submerchant_not_onboarded")

    split = calculate_split(gross_amount=gross_amount, commission_bps=commission_bps)
    if split["submerchant_price"] + split["platform_fee"] != split["gross_price"]:
        raise ValidationError("split.invariant_broken")

    payment_intent = PaymentIntent.objects.create(
        user=user,
        purpose=PaymentIntent.Purpose.CHECKOUT,
        amount=split["gross_price"],
        gross_price=split["gross_price"],
        platform_fee=split["platform_fee"],
        submerchant_price=split["submerchant_price"],
        submerchant_key=business.iyzico_submerchant_key,
        status=PaymentIntent.Status.INITIATED,
    )
    payment_intent.marketplace_conversation_id = payment_conversation_id(payment_intent.pk)
    payment_intent.save(update_fields=["marketplace_conversation_id", "updated_at"])

    payload = build_marketplace_payment_payload(
        payment_intent=payment_intent,
        order=order,
        business=business,
        gross_amount_minor=split["gross_price"],
        submerchant_amount_minor=split["submerchant_price"],
    )
    return payment_intent, payload
