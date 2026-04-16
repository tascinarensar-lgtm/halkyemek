from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django_ratelimit.decorators import ratelimit
from rest_framework import status as http_status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from common.network import ip_in_allowlist
from logs.utils import get_client_ip
from orders.models import Order
from payments.models import ProviderEvent
from payments.services_reversals import PaymentReversalService
from payments.providers.iyzico import (
    normalize_iyzico_status,
    parse_webhook_payload,
    verify_signature_v3,
)
from payments.services import apply_topup_terminal_event, resolve_payment_intent_for_webhook
from .utils import verify_webhook_signature


def _clean_str(value) -> str:
    return str(value or "").strip()


def _extract_reversal_amount(payload: dict, *, fallback: int | None = None) -> int | None:
    candidates = [
        payload.get("amount"),
        payload.get("amount_minor"),
        payload.get("amountMinor"),
        (payload.get("data") or {}).get("amount"),
        (payload.get("data") or {}).get("amount_minor"),
        (payload.get("data") or {}).get("amountMinor"),
        fallback,
    ]
    for candidate in candidates:
        if candidate in (None, ""):
            continue
        try:
            return int(candidate)
        except (TypeError, ValueError):
            continue
    return None


def _extract_order_id(payload: dict) -> int | None:
    candidates = [
        payload.get("order_id"),
        payload.get("orderId"),
        (payload.get("data") or {}).get("order_id"),
        (payload.get("data") or {}).get("orderId"),
    ]
    for candidate in candidates:
        if candidate in (None, ""):
            continue
        try:
            return int(candidate)
        except (TypeError, ValueError):
            continue
    return None


def _apply_mock_reversal_event(*, provider_event: ProviderEvent, payload: dict):
    event_type = _clean_str(provider_event.event_type).lower()
    data = payload.get("data") or {}
    amount = _extract_reversal_amount(payload)
    if amount is None:
        raise ValidationError("webhook.reversal_amount_missing")

    if event_type == "payment.order_refund":
        order_id = _extract_order_id(payload)
        if order_id is None:
            raise ValidationError("webhook.order_id_missing")
        order = Order.objects.get(id=order_id)
        result = PaymentReversalService.apply_order_refund(
            order=order,
            amount=amount,
            reason_code=_clean_str(data.get("reason_code") or payload.get("reason_code") or "PROVIDER_REFUND"),
            note=_clean_str(data.get("note") or payload.get("note") or f"Provider refund event {provider_event.event_id}"),
            idempotency_key=f"provider:{provider_event.provider}:{provider_event.event_id}:order_refund:{order.id}",
        )
        provider_event.processed_at = timezone.now()
        provider_event.save(update_fields=["processed_at"])
        return "order_refund_applied", result

    if event_type == "payment.order_chargeback":
        order_id = _extract_order_id(payload)
        if order_id is None:
            raise ValidationError("webhook.order_id_missing")
        order = Order.objects.get(id=order_id)
        result = PaymentReversalService.apply_order_chargeback(
            order=order,
            amount=amount,
            note=_clean_str(data.get("note") or payload.get("note") or f"Provider chargeback event {provider_event.event_id}"),
            provider_event=provider_event,
        )
        provider_event.processed_at = timezone.now()
        provider_event.save(update_fields=["processed_at"])
        return "order_chargeback_applied", result

    if event_type in {"payment.reversal", "payment.chargeback"}:
        intent = resolve_payment_intent_for_webhook(
            intent_id=data.get("intent_id") or payload.get("intent_id"),
            provider_payment_id=data.get("provider_payment_id") or payload.get("provider_payment_id"),
            conversation_id=data.get("payment_conversation_id") or payload.get("payment_conversation_id"),
        )
        if intent is None:
            raise ValidationError("webhook.intent_not_found")
        if event_type == "payment.reversal":
            result = PaymentReversalService.apply_topup_reversal(
                payment_intent=intent,
                amount=amount,
                reason_code=_clean_str(data.get("reason_code") or payload.get("reason_code") or "PROVIDER_TOPUP_REVERSAL"),
                note=_clean_str(data.get("note") or payload.get("note") or f"Provider reversal event {provider_event.event_id}"),
                provider_event=provider_event,
            )
            status_code = "topup_reversal_applied"
        else:
            result = PaymentReversalService.apply_chargeback(
                payment_intent=intent,
                amount=amount,
                note=_clean_str(data.get("note") or payload.get("note") or f"Provider chargeback event {provider_event.event_id}"),
                provider_event=provider_event,
            )
            status_code = "chargeback_applied"
        provider_event.processed_at = timezone.now()
        provider_event.save(update_fields=["processed_at"])
        return status_code, result

    return None, None


def _apply_iyzico_reversal_event(*, provider_event: ProviderEvent, payload: dict, intent: PaymentIntent):
    event_type = _clean_str(payload.get("iyziEventType") or provider_event.event_type).upper()
    amount = _extract_reversal_amount(payload, fallback=int(intent.amount))
    if amount is None:
        raise ValidationError("webhook.reversal_amount_missing")

    if event_type in {"PAYMENT_REVERSAL", "TOPUP_REVERSAL", "REFUND"}:
        result = PaymentReversalService.apply_topup_reversal(
            payment_intent=intent,
            amount=amount,
            reason_code=event_type,
            note=f"iyzico reversal event {provider_event.event_id}",
            provider_event=provider_event,
        )
        provider_event.processed_at = timezone.now()
        provider_event.save(update_fields=["processed_at"])
        return "topup_reversal_applied", result

    if event_type in {"PAYMENT_CHARGEBACK", "CHARGEBACK"}:
        order_id = _extract_order_id(payload)
        if order_id is not None:
            order = Order.objects.get(id=order_id)
            result = PaymentReversalService.apply_order_chargeback(
                order=order,
                amount=amount,
                note=f"iyzico order chargeback event {provider_event.event_id}",
                provider_event=provider_event,
            )
            provider_event.processed_at = timezone.now()
            provider_event.save(update_fields=["processed_at"])
            return "order_chargeback_applied", result

        result = PaymentReversalService.apply_chargeback(
            payment_intent=intent,
            amount=amount,
            note=f"iyzico chargeback event {provider_event.event_id}",
            provider_event=provider_event,
        )
        provider_event.processed_at = timezone.now()
        provider_event.save(update_fields=["processed_at"])
        return "chargeback_applied", result

    return None, None


@extend_schema(exclude=True)
class ProviderWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        raw_body: bytes = request.body or b""
        sig = request.headers.get("X-Provider-Signature")
        event_id = request.headers.get("X-Provider-Event-Id")
        signature_ok = verify_webhook_signature(raw_body=raw_body, signature=sig)
        payload = request.data if isinstance(request.data, dict) else {}
        event_type = str(payload.get("type") or "unknown")

        if not event_id:
            return Response(
                {"ok": False, "error": {"code": "webhook.missing_event_id", "message": "Missing event id"}},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        try:
            with transaction.atomic():
                pe, created = ProviderEvent.objects.get_or_create(
                    provider=ProviderEvent.Provider.MOCK,
                    event_id=str(event_id),
                    defaults={
                        "event_type": event_type,
                        "payload": payload,
                        "headers": dict(request.headers),
                        "signature_ok": signature_ok,
                    },
                )
                if not created:
                    return Response({"ok": True, "data": {"status": "duplicate_ignored"}}, status=200)
                if not signature_ok:
                    pe.processed_at = timezone.now()
                    pe.save(update_fields=["processed_at"])
                    return Response(
                        {"ok": False, "error": {"code": "webhook.bad_signature", "message": "Invalid signature"}},
                        status=http_status.HTTP_400_BAD_REQUEST,
                    )

                if event_type != "payment.paid":
                    reversal_status, reversal_result = _apply_mock_reversal_event(provider_event=pe, payload=payload)
                    if reversal_status is not None:
                        return Response(
                            {
                                "ok": True,
                                "data": {
                                    "status": reversal_status,
                                    "reversal_id": getattr(getattr(reversal_result, "reversal", None), "id", None),
                                    "reversal_status": getattr(getattr(reversal_result, "reversal", None), "status", None),
                                },
                            },
                            status=200,
                        )
                    pe.processed_at = timezone.now()
                    pe.save(update_fields=["processed_at"])
                    return Response({"ok": True, "data": {"status": "accepted"}}, status=200)

                data = payload.get("data") or {}
                intent = resolve_payment_intent_for_webhook(
                    intent_id=data.get("intent_id"),
                    provider_payment_id=data.get("provider_payment_id"),
                    conversation_id=data.get("payment_conversation_id"),
                )
                if intent is None:
                    pe.processed_at = timezone.now()
                    pe.save(update_fields=["processed_at"])
                    return Response(
                        {"ok": False, "error": {"code": "webhook.intent_not_found", "message": "Intent not found"}},
                        status=http_status.HTTP_404_NOT_FOUND,
                    )

                status_code = apply_topup_terminal_event(
                    intent=intent,
                    provider_event=pe,
                    normalized_status="SUCCESS",
                    provider_payment_id=data.get("provider_payment_id"),
                    provider_payload=payload,
                    success_description="Topup paid -> pending",
                    failure_reason="provider webhook reported failure",
                    cancellation_reason="provider webhook reported cancellation",
                )
                return Response({"ok": True, "data": {"status": status_code}}, status=200)
        except ValidationError as exc:
            return Response(
                {"ok": False, "error": {"code": "webhook.validation_error", "message": str(exc)}},
                status=http_status.HTTP_400_BAD_REQUEST,
            )


@method_decorator(ratelimit(key="ip", rate="60/m", block=True), name="dispatch")
@extend_schema(exclude=True)
class IyzicoWebhookView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        payload = request.data if isinstance(request.data, dict) else {}
        allow = getattr(settings, "IYZICO_WEBHOOK_IP_ALLOWLIST", []) or []
        if allow:
            ip = get_client_ip(request)
            if not ip_in_allowlist(ip, allow):
                return Response({"ok": False, "error": {"code": "webhook.ip_not_allowed"}}, status=http_status.HTTP_403_FORBIDDEN)

        try:
            verify_signature_v3(payload, request.headers)
            w = parse_webhook_payload(payload)
        except Exception:
            ProviderEvent.objects.create(
                provider=ProviderEvent.Provider.IYZICO,
                event_id=str(payload.get("iyziReferenceCode") or f"invalidsig:{timezone.now().timestamp()}"),
                event_type="iyzico.invalid_signature",
                payload=payload,
                headers=dict(request.headers),
                signature_ok=False,
                processed_at=timezone.now(),
            )
            return Response({"ok": False, "error": {"code": "webhook.invalid_signature"}}, status=http_status.HTTP_400_BAD_REQUEST)

        pe, created = ProviderEvent.objects.get_or_create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id=w.iyzi_reference_code,
            defaults={
                "event_type": str(w.iyzi_event_type or "iyzico.webhook"),
                "payload": payload,
                "headers": dict(request.headers),
                "signature_ok": True,
            },
        )
        if not created:
            return Response({"ok": True, "data": {"status": "duplicate"}}, status=200)

        intent = resolve_payment_intent_for_webhook(
            conversation_id=w.payment_conversation_id,
            provider_payment_id=w.payment_id or w.iyzi_payment_id,
        )
        if intent is None:
            pe.processed_at = timezone.now()
            pe.save(update_fields=["processed_at"])
            return Response({"ok": False, "error": {"code": "webhook.intent_not_found"}}, status=http_status.HTTP_400_BAD_REQUEST)

        normalized_status = normalize_iyzico_status(w.status)
        provider_payment_id = w.payment_id or w.iyzi_payment_id

        reversal_status, reversal_result = _apply_iyzico_reversal_event(provider_event=pe, payload=payload, intent=intent)
        if reversal_status is not None:
            return Response(
                {
                    "ok": True,
                    "data": {
                        "status": reversal_status,
                        "reversal_id": getattr(getattr(reversal_result, "reversal", None), "id", None),
                        "reversal_status": getattr(getattr(reversal_result, "reversal", None), "status", None),
                    },
                },
                status=200,
            )

        status_code = apply_topup_terminal_event(
            intent=intent,
            provider_event=pe,
            normalized_status=normalized_status,
            provider_payment_id=provider_payment_id,
            provider_payload=payload,
            success_description="iyzico SUCCESS -> pending",
            failure_reason="iyzico reported terminal failure",
            cancellation_reason="iyzico reported cancellation",
        )
        if status_code.startswith("ignored_"):
            return Response({"ok": True, "data": {"status": "ignored_nonterminal", "iyzico_status": normalized_status}}, status=200)
        return Response({"ok": True, "data": {"status": status_code}}, status=200)
