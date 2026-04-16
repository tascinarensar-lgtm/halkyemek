from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from orders.models import Order
from payments.models import PaymentIntent, PaymentReversal, ProviderEvent
from payouts.models import PayoutAdjustment
from payouts.services import BusinessReversalService
from wallets.services import WalletService


@dataclass(frozen=True)
class ReversalApplyResult:
    reversal: PaymentReversal
    business_mode: str | None = None
    payout_adjustment_id: int | None = None


def _new_idempotency_key() -> str:
    return secrets.token_urlsafe(24)


def _provider_event_idempotency_key(*, provider_event: ProviderEvent, tx_type: str, source_ref: str = "") -> str:
    digest = hashlib.sha256(
        f"{provider_event.provider}:{provider_event.event_id}:{tx_type}:{source_ref}".encode("utf-8")
    ).hexdigest()
    return f"provider-event:{digest}"


class PaymentReversalService:
    @staticmethod
    def _assert_existing_reversal_compatible(*, reversal: PaymentReversal, requested_amount: int) -> None:
        if int(reversal.amount) != int(requested_amount):
            raise ValidationError("existing reversal amount conflicts with requested amount")

    @staticmethod
    @transaction.atomic
    def _apply_order_reversal(
        *,
        order,
        amount: int,
        reversal_type: str,
        reason_code: str,
        note: str,
        idempotency_key: str | None,
        provider_event: ProviderEvent | None,
        apply_wallet_refund: bool,
    ) -> ReversalApplyResult:
        if provider_event is not None and not idempotency_key:
            idempotency_key = _provider_event_idempotency_key(
                provider_event=provider_event,
                tx_type=f"ORDER:{reversal_type}",
                source_ref=f"order:{order.pk}",
            )

        existing = PaymentReversalService._get_existing_by_idempotency(idempotency_key=idempotency_key)
        if existing is not None:
            PaymentReversalService._assert_existing_reversal_compatible(reversal=existing, requested_amount=amount)
            return PaymentReversalService._rebuild_existing_result(reversal=existing)

        order = type(order).objects.select_for_update().get(pk=order.pk)
        amount = int(amount)
        if order.status not in {Order.Status.PAID, Order.Status.USED}:
            raise ValidationError("order reversal requires paid or used order")
        if amount <= 0:
            raise ValidationError("reversal amount must be positive")
        if amount > PaymentReversalService._order_outstanding_reversible_amount(order=order):
            raise ValidationError("reversal amount exceeds order outstanding reversible amount")

        reversal_idempotency_key = idempotency_key or _new_idempotency_key()
        reversal, created = PaymentReversalService._create_reversal(
            reversal_type=reversal_type,
            idempotency_key=reversal_idempotency_key,
            create_kwargs={
                "user": order.user,
                "order": order,
                "provider_event": provider_event,
                "reversal_type": reversal_type,
                "status": PaymentReversal.Status.REQUESTED,
                "amount": amount,
                "reason_code": (reason_code or "")[:64],
                "note": (note or "")[:255],
                "idempotency_key": reversal_idempotency_key,
            },
        )
        if not created:
            PaymentReversalService._assert_existing_reversal_compatible(reversal=reversal, requested_amount=amount)
            return PaymentReversalService._rebuild_existing_result(reversal=reversal)

        wallet_effect_applied = False
        if apply_wallet_refund:
            WalletService.refund(
                user=order.user,
                amount=amount,
                description=f"Order refund #{order.id}",
                order=order,
                provider_event=provider_event,
            )
            wallet_effect_applied = True

        order.register_refund(amount=amount, is_chargeback=(reversal_type == PaymentReversal.Type.CHARGEBACK))
        order.save(update_fields=["refund_status", "refunded_amount", "refunded_at", "chargeback_amount", "chargeback_at"])

        business_result = BusinessReversalService.reverse_order_earning(
            order=order,
            amount=amount,
            reason_code=reason_code,
            payment_reversal=reversal,
            description=note or f"Order reversal #{order.id}",
        )

        reversal.status = PaymentReversal.Status.APPLIED
        reversal.wallet_effect_applied = wallet_effect_applied
        reversal.business_effect_applied = True
        reversal.applied_at = timezone.now()
        reversal.save(update_fields=[
            "status",
            "wallet_effect_applied",
            "business_effect_applied",
            "applied_at",
        ])
        return ReversalApplyResult(
            reversal=reversal,
            business_mode=business_result.mode,
            payout_adjustment_id=business_result.payout_adjustment_id,
        )

    @staticmethod
    def _create_reversal(
        *,
        payment_intent: PaymentIntent | None = None,
        provider_event: ProviderEvent | None = None,
        reversal_type: str,
        idempotency_key: str,
        create_kwargs: dict,
    ) -> tuple[PaymentReversal, bool]:
        try:
            return PaymentReversal.objects.create(**create_kwargs), True
        except IntegrityError:
            existing = PaymentReversalService._get_existing_by_idempotency(idempotency_key=idempotency_key)
            if existing is None and payment_intent is not None and provider_event is not None:
                existing = PaymentReversalService._get_existing_by_provider_event(
                    payment_intent=payment_intent,
                    provider_event=provider_event,
                    reversal_type=reversal_type,
                )
            if existing is not None:
                return existing, False
            raise

    @staticmethod
    def _rebuild_existing_result(*, reversal: PaymentReversal) -> ReversalApplyResult:
        adjustment = PayoutAdjustment.objects.filter(payment_reversal=reversal).order_by("id").first()
        business_mode = None
        payout_adjustment_id = None
        if getattr(reversal, "order", None) is not None:
            if adjustment is not None:
                business_mode = "next_cycle_adjustment"
                payout_adjustment_id = adjustment.pk
            elif reversal.business_effect_applied:
                business_mode = "pre_payout_reversed"
        return ReversalApplyResult(
            reversal=reversal,
            business_mode=business_mode,
            payout_adjustment_id=payout_adjustment_id,
        )

    @staticmethod
    def _get_existing_by_idempotency(*, idempotency_key: str | None) -> PaymentReversal | None:
        if not idempotency_key:
            return None
        return PaymentReversal.objects.filter(idempotency_key=idempotency_key).first()

    @staticmethod
    def _get_existing_by_provider_event(
        *,
        payment_intent: PaymentIntent,
        provider_event: ProviderEvent | None,
        reversal_type: str,
    ) -> PaymentReversal | None:
        if provider_event is None:
            return None
        return (
            PaymentReversal.objects.filter(
                payment_intent=payment_intent,
                provider_event=provider_event,
                reversal_type=reversal_type,
                status=PaymentReversal.Status.APPLIED,
            )
            .order_by("id")
            .first()
        )

    @staticmethod
    def _order_outstanding_reversible_amount(*, order) -> int:
        return max(int(order.amount) - int(order.total_reversed_amount), 0)

    @staticmethod
    def _topup_reversed_total(*, payment_intent: PaymentIntent) -> int:
        total = (
            PaymentReversal.objects.filter(
                payment_intent=payment_intent,
                reversal_type__in=[PaymentReversal.Type.TOPUP_REVERSAL, PaymentReversal.Type.CHARGEBACK],
                status=PaymentReversal.Status.APPLIED,
            )
            .exclude(pk=getattr(payment_intent, "_skip_reversal_pk", None))
            .values_list("amount", flat=True)
        )
        return int(sum(int(x) for x in total))

    @staticmethod
    @transaction.atomic
    def apply_order_refund(
        *,
        order,
        amount: int,
        reason_code: str = "ORDER_REFUND",
        note: str = "",
        idempotency_key: str | None = None,
    ) -> ReversalApplyResult:
        return PaymentReversalService._apply_order_reversal(
            order=order,
            amount=amount,
            reversal_type=PaymentReversal.Type.ORDER_REFUND,
            reason_code=reason_code,
            note=note,
            idempotency_key=idempotency_key,
            provider_event=None,
            apply_wallet_refund=True,
        )

    @staticmethod
    def apply_order_chargeback(
        *,
        order,
        amount: int,
        reason_code: str = "CHARGEBACK",
        note: str = "",
        provider_event: ProviderEvent | None = None,
        idempotency_key: str | None = None,
    ) -> ReversalApplyResult:
        return PaymentReversalService._apply_order_reversal(
            order=order,
            amount=amount,
            reversal_type=PaymentReversal.Type.CHARGEBACK,
            reason_code=reason_code,
            note=note or f"Order chargeback #{order.id}",
            idempotency_key=idempotency_key,
            provider_event=provider_event,
            apply_wallet_refund=False,
        )

    @staticmethod
    @transaction.atomic
    def apply_topup_reversal(
        *,
        payment_intent: PaymentIntent,
        amount: int,
        reason_code: str = "TOPUP_REVERSAL",
        note: str = "",
        tx_type: str | None = None,
        provider_event: ProviderEvent | None = None,
        idempotency_key: str | None = None,
    ) -> ReversalApplyResult:
        if provider_event is not None and not idempotency_key:
            idempotency_key = _provider_event_idempotency_key(
                provider_event=provider_event,
                tx_type=tx_type or PaymentReversal.Type.TOPUP_REVERSAL,
                source_ref=f"intent:{payment_intent.pk}",
            )

        existing = PaymentReversalService._get_existing_by_idempotency(idempotency_key=idempotency_key)
        if existing is not None:
            PaymentReversalService._assert_existing_reversal_compatible(reversal=existing, requested_amount=amount)
            return PaymentReversalService._rebuild_existing_result(reversal=existing)

        payment_intent = PaymentIntent.objects.select_for_update().get(pk=payment_intent.pk)
        amount = int(amount)
        if payment_intent.purpose != PaymentIntent.Purpose.TOPUP:
            raise ValidationError("topup reversal requires TOPUP payment intent")
        if payment_intent.status != PaymentIntent.Status.PAID:
            raise ValidationError("topup reversal requires paid payment intent")

        reversal_type = PaymentReversal.Type.CHARGEBACK if tx_type == "CHARGEBACK" else PaymentReversal.Type.TOPUP_REVERSAL
        existing_by_event = PaymentReversalService._get_existing_by_provider_event(
            payment_intent=payment_intent,
            provider_event=provider_event,
            reversal_type=reversal_type,
        )
        if existing_by_event is not None:
            PaymentReversalService._assert_existing_reversal_compatible(reversal=existing_by_event, requested_amount=amount)
            return PaymentReversalService._rebuild_existing_result(reversal=existing_by_event)

        already_reversed = PaymentReversalService._topup_reversed_total(payment_intent=payment_intent)
        if amount <= 0 or (already_reversed + amount) > int(payment_intent.amount):
            raise ValidationError("invalid topup reversal amount")

        wallet_tx_type = tx_type or "REVERSAL"
        reversal_idempotency_key = idempotency_key or _new_idempotency_key()
        reversal, created = PaymentReversalService._create_reversal(
            payment_intent=payment_intent,
            provider_event=provider_event,
            reversal_type=reversal_type,
            idempotency_key=reversal_idempotency_key,
            create_kwargs={
                "user": payment_intent.user,
                "payment_intent": payment_intent,
                "provider_event": provider_event,
                "reversal_type": reversal_type,
                "status": PaymentReversal.Status.REQUESTED,
                "amount": amount,
                "reason_code": (reason_code or "")[:64],
                "note": (note or "")[:255],
                "idempotency_key": reversal_idempotency_key,
            },
        )
        if not created:
            PaymentReversalService._assert_existing_reversal_compatible(reversal=reversal, requested_amount=amount)
            return PaymentReversalService._rebuild_existing_result(reversal=reversal)

        wallet_result = WalletService.reverse_topup_payment_intent(
            user=payment_intent.user,
            amount=amount,
            description=note or f"Topup reversal #{payment_intent.pk}",
            payment_intent=payment_intent,
            provider_event=provider_event,
            tx_type=wallet_tx_type,
        )

        reversal.pending_reversed_amount = int(wallet_result.get("pending_reversed") or 0)
        reversal.available_reversed_amount = int(wallet_result.get("available_reversed") or 0)
        reversal.outstanding_exposure_amount = int(wallet_result.get("outstanding_exposure") or 0)
        reversal.blocked_wallet = bool(wallet_result.get("wallet_blocked"))
        reversal.wallet_effect_applied = (reversal.pending_reversed_amount + reversal.available_reversed_amount) > 0

        if wallet_result.get("manual_review_required"):
            reversal.status = PaymentReversal.Status.REQUESTED
            reversal.manual_review_required = True
            reversal.review_status = PaymentReversal.ReviewStatus.OPEN
            reversal.failure_reason = (
                "INSUFFICIENT_AVAILABLE_BALANCE_MANUAL_REVIEW: "
                f"outstanding_exposure={reversal.outstanding_exposure_amount}. "
                "Wallet was blocked and ops must collect the remaining exposure manually."
            )
            reversal.applied_at = None
            reversal.resolved_at = None
            reversal.save(update_fields=[
                "status",
                "wallet_effect_applied",
                "pending_reversed_amount",
                "available_reversed_amount",
                "outstanding_exposure_amount",
                "blocked_wallet",
                "manual_review_required",
                "review_status",
                "failure_reason",
                "applied_at",
                "resolved_at",
            ])
            return ReversalApplyResult(reversal=reversal)

        reversal.status = PaymentReversal.Status.APPLIED
        reversal.manual_review_required = False
        reversal.review_status = PaymentReversal.ReviewStatus.RESOLVED
        reversal.failure_reason = ""
        reversal.applied_at = timezone.now()
        reversal.resolved_at = reversal.applied_at
        reversal.save(update_fields=[
            "status",
            "wallet_effect_applied",
            "pending_reversed_amount",
            "available_reversed_amount",
            "outstanding_exposure_amount",
            "blocked_wallet",
            "manual_review_required",
            "review_status",
            "failure_reason",
            "applied_at",
            "resolved_at",
        ])
        return ReversalApplyResult(reversal=reversal)

    @staticmethod
    @transaction.atomic
    def resolve_manual_review(*, reversal: PaymentReversal) -> ReversalApplyResult:
        reversal = PaymentReversal.objects.select_for_update().select_related("payment_intent", "user").get(pk=reversal.pk)
        if reversal.review_status != PaymentReversal.ReviewStatus.OPEN or int(reversal.outstanding_exposure_amount or 0) <= 0:
            raise ValidationError("reversal is not pending manual review")
        if reversal.payment_intent_id is None:
            raise ValidationError("manual review resolution requires payment_intent source")

        wallet_result = WalletService.reverse_topup_payment_intent(
            user=reversal.user,
            amount=int(reversal.outstanding_exposure_amount),
            description=f"Manual review resolution #{reversal.pk}",
            payment_intent=reversal.payment_intent,
            tx_type="CHARGEBACK" if reversal.reversal_type == PaymentReversal.Type.CHARGEBACK else "REVERSAL",
            allow_restricted_wallet=True,
        )
        reversal.pending_reversed_amount = int(reversal.pending_reversed_amount or 0) + int(wallet_result.get("pending_reversed") or 0)
        reversal.available_reversed_amount = int(reversal.available_reversed_amount or 0) + int(wallet_result.get("available_reversed") or 0)
        reversal.outstanding_exposure_amount = int(wallet_result.get("outstanding_exposure") or 0)
        reversal.blocked_wallet = bool(wallet_result.get("wallet_blocked"))
        reversal.wallet_effect_applied = (int(reversal.pending_reversed_amount) + int(reversal.available_reversed_amount)) > 0

        if reversal.outstanding_exposure_amount > 0:
            reversal.status = PaymentReversal.Status.REQUESTED
            reversal.manual_review_required = True
            reversal.review_status = PaymentReversal.ReviewStatus.OPEN
            reversal.failure_reason = (
                "INSUFFICIENT_AVAILABLE_BALANCE_MANUAL_REVIEW: "
                f"outstanding_exposure={reversal.outstanding_exposure_amount}. "
                "Wallet remains blocked until exposure is fully recovered."
            )
            reversal.save(update_fields=[
                "status", "wallet_effect_applied", "pending_reversed_amount", "available_reversed_amount",
                "outstanding_exposure_amount", "blocked_wallet", "manual_review_required", "review_status",
                "failure_reason",
            ])
            return ReversalApplyResult(reversal=reversal)

        reversal.status = PaymentReversal.Status.APPLIED
        reversal.manual_review_required = False
        reversal.review_status = PaymentReversal.ReviewStatus.RESOLVED
        reversal.failure_reason = ""
        reversal.applied_at = timezone.now()
        reversal.resolved_at = reversal.applied_at
        reversal.save(update_fields=[
            "status", "wallet_effect_applied", "pending_reversed_amount", "available_reversed_amount",
            "outstanding_exposure_amount", "blocked_wallet", "manual_review_required", "review_status",
            "failure_reason", "applied_at", "resolved_at",
        ])

        if reversal.payment_intent is not None and not PaymentReversal.objects.filter(
            user=reversal.user,
            manual_review_required=True,
            review_status=PaymentReversal.ReviewStatus.OPEN,
        ).exclude(pk=reversal.pk).exists():
            wallet = WalletService._get_wallet_for_update(user=reversal.user)
            WalletService.release_wallet_restriction(wallet=wallet, reason_prefix="REVERSAL_EXPOSURE")
        return ReversalApplyResult(reversal=reversal)

    @staticmethod
    def apply_chargeback(
        *,
        payment_intent: PaymentIntent,
        amount: int,
        note: str = "",
        provider_event: ProviderEvent | None = None,
        idempotency_key: str | None = None,
    ) -> ReversalApplyResult:
        return PaymentReversalService.apply_topup_reversal(
            payment_intent=payment_intent,
            amount=amount,
            reason_code="CHARGEBACK",
            note=note or f"Chargeback for payment_intent #{payment_intent.pk}",
            tx_type="CHARGEBACK",
            provider_event=provider_event,
            idempotency_key=idempotency_key,
        )
