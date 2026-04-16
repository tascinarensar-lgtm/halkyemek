from __future__ import annotations

import random
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from accounts.models import User
from businesses.services.membership import get_business_finance_notification_users
from common.references import payout_ref
from payments.models import SettlementRecord
from payments.settlement_proof import has_settlement_line_amount_proof, normalized_references
from notifications.models import Notification
from notifications.services import NotificationService
from orders.accounting import build_order_accounting_snapshot, collect_order_accounting_mismatches
from payouts.models import BusinessEarning, Payout, PayoutAdjustment, PayoutBatch, PayoutItem
from payouts.providers.iyzico_marketplace_payout import (
    IyzicoMarketplacePayoutProvider,
    PayoutStatusResult,
)
from payouts.providers.manual import DispatchResult, ManualPayoutProvider


@dataclass(frozen=True)
class ResolvedPayoutProvider:
    name: str
    provider: object


@dataclass(frozen=True)
class ConfirmPayoutResult:
    changed: bool
    payout_id: int
    status: str


def _new_idempotency_key() -> str:
    return secrets.token_urlsafe(32)


def get_business_earning_hold_delta() -> timedelta:
    hours = getattr(settings, "BUSINESS_EARNING_HOLD_HOURS", None)
    if hours is None:
        delay_days = int(getattr(settings, "PAYOUT_DELAY_DAYS", 0))
        hours = delay_days * 24
    return timedelta(hours=max(int(hours), 0))


def get_business_platform_fee_bps() -> int:
    fee_bps = int(getattr(settings, "BUSINESS_PLATFORM_FEE_BPS", 0))
    if fee_bps < 0 or fee_bps > 10000:
        raise ValueError("BUSINESS_PLATFORM_FEE_BPS must be between 0 and 10000")
    return fee_bps


def build_business_earning_breakdown(*, gross_amount: int, platform_fee_amount: int | None = None) -> dict[str, int]:
    gross_amount = int(gross_amount)
    if gross_amount <= 0:
        raise ValueError("gross_amount must be positive")

    if platform_fee_amount is None:
        platform_fee_amount = (gross_amount * get_business_platform_fee_bps()) // 10000

    platform_fee_amount = int(platform_fee_amount)
    net_amount = gross_amount - platform_fee_amount

    if platform_fee_amount < 0:
        raise ValueError("platform_fee_amount cannot be negative")
    if net_amount < 0:
        raise ValueError("net_amount cannot be negative")

    return {
        "gross_amount": gross_amount,
        "platform_fee_amount": platform_fee_amount,
        "net_amount": net_amount,
    }


def default_business_earning_eligible_at(*, now=None):
    base = now or timezone.now()
    return base + get_business_earning_hold_delta()


def get_earning_outstanding_amount(*, earning: BusinessEarning) -> int:
    return max(int(earning.net_amount) - int(earning.reversed_amount or 0), 0)


def _resolve_payout_provider(provider_name: str | None) -> ResolvedPayoutProvider:
    normalized = str(provider_name or "manual").strip().lower()
    if normalized in {"", "manual"}:
        return ResolvedPayoutProvider(name="manual", provider=ManualPayoutProvider())
    if normalized in {"iyzico", "iyzico_marketplace"}:
        return ResolvedPayoutProvider(name="iyzico_marketplace", provider=IyzicoMarketplacePayoutProvider())
    raise ValidationError({"provider": f"Unsupported payout provider: {provider_name}"})


def _dispatch_with_provider(*, payout: Payout) -> DispatchResult:
    try:
        resolved = _resolve_payout_provider(payout.batch.provider)
    except ValidationError as exc:
        return DispatchResult(
            ok=False,
            error_code="PROVIDER_EXCEPTION",
            error_message=str(exc)[:2000],
            retryable=False,
            raw={"stage": "provider_init", "provider": str(payout.batch.provider or "")},
        )

    provider = resolved.provider
    try:
        if resolved.name == "iyzico_marketplace":
            return provider.dispatch(  # type: ignore[attr-defined]
                payout_id=payout.id,
                provider_reference=payout.provider_reference,
                amount=int(payout.amount),
                currency=payout.currency,
                business=payout.business,
            )
        return provider.dispatch(  # type: ignore[attr-defined]
            payout_id=payout.id,
            amount=int(payout.amount),
            currency=payout.currency,
            business_id=payout.business_id,
        )
    except NotImplementedError as exc:
        return DispatchResult(
            ok=False,
            error_code="PROVIDER_NOT_IMPLEMENTED",
            error_message=str(exc) or "Payout provider is not implemented.",
            retryable=False,
        )
    except ValidationError as exc:
        return DispatchResult(
            ok=False,
            error_code="PROVIDER_EXCEPTION",
            error_message=str(exc)[:2000],
            retryable=False,
            raw={"stage": "provider_dispatch", "provider": resolved.name, "error": str(exc)[:2000]},
        )
    except Exception as exc:  # pragma: no cover - defensive guardrail
        return DispatchResult(
            ok=False,
            error_code="PROVIDER_EXCEPTION",
            error_message=str(exc)[:2000],
            retryable=True,
            raw={"stage": "provider_dispatch", "provider": resolved.name, "error": str(exc)[:2000]},
        )


def _retrieve_provider_status(*, payout: Payout) -> PayoutStatusResult:
    try:
        resolved = _resolve_payout_provider(payout.batch.provider)
    except ValidationError as exc:
        return PayoutStatusResult(
            ok=False,
            error_code="PROVIDER_STATUS_EXCEPTION",
            error_message=str(exc)[:2000],
            retryable=False,
            raw={"stage": "provider_init", "provider": str(payout.batch.provider or "")},
        )

    provider = resolved.provider
    if resolved.name != "iyzico_marketplace":
        return PayoutStatusResult(
            ok=False,
            error_code="UNSUPPORTED_PROVIDER_STATUS_SYNC",
            error_message=f"Provider {resolved.name} does not support status sync",
            retryable=False,
        )

    provider_payout_id = str(payout.provider_payout_id or "").strip()
    if not provider_payout_id:
        return PayoutStatusResult(
            ok=False,
            error_code="PROVIDER_PAYOUT_ID_REQUIRED",
            error_message="provider_payout_id is required before status sync",
            retryable=False,
        )

    try:
        return provider.retrieve_status(  # type: ignore[attr-defined]
            provider_payout_id=provider_payout_id,
            provider_reference=payout.provider_reference,
        )
    except ValidationError as exc:
        return PayoutStatusResult(
            ok=False,
            error_code="PROVIDER_STATUS_EXCEPTION",
            error_message=str(exc)[:2000],
            retryable=False,
            raw={"stage": "provider_status", "provider": resolved.name, "error": str(exc)[:2000]},
        )
    except Exception as exc:  # pragma: no cover - defensive guardrail
        return PayoutStatusResult(
            ok=False,
            error_code="PROVIDER_STATUS_EXCEPTION",
            error_message=str(exc)[:2000],
            retryable=True,
            raw={"stage": "provider_status", "provider": resolved.name, "error": str(exc)[:2000]},
        )


def _has_provider_dispatch_reference(*, provider_name: str, provider_payout_id: str) -> bool:
    if not provider_payout_id:
        return False
    normalized_provider = str(provider_name or "").strip().lower()
    return normalized_provider in {"iyzico_marketplace", "iyzico"}


def _is_inflight_dispatch_failure(*, payout: Payout, dispatch_result: DispatchResult) -> bool:
    provider_payout_id = str(dispatch_result.provider_payout_id or "").strip()
    if not _has_provider_dispatch_reference(provider_name=payout.batch.provider, provider_payout_id=provider_payout_id):
        return False

    non_inflight_error_codes = {
        "VALIDATION_ERROR",
        "INIT_REQUEST_ID_MISSING",
        "INVALID_ITEM",
    }
    if str(dispatch_result.error_code or "").strip().upper() in non_inflight_error_codes:
        return False

    return True


def _has_payout_settlement_proof(*, payout: Payout) -> bool:
    references = normalized_references(
        payout.provider_reference,
        payout.provider_payout_id,
        payout.provider_item_reference_code,
    )
    has_record = SettlementRecord.objects.filter(payout=payout, is_processed=True).exists()
    if has_record:
        return True

    return has_settlement_line_amount_proof(
        provider="IYZICO",
        references=references,
        amount=int(payout.amount),
        submerchant_key=payout.business.iyzico_submerchant_key,
    )


def _requires_manual_review_for_provider_inconsistency(*, status_result: PayoutStatusResult) -> bool:
    return str(status_result.error_code or "").strip().upper() in {
        "ITEM_NOT_FOUND_FINAL_STATE",
    }


def _sync_batch_status(*, batch_id: int):
    batch = PayoutBatch.objects.get(id=batch_id)
    payouts = list(batch.payouts.only("status", "sent_at", "confirmed_at", "provider_error", "last_error_code"))
    if not payouts:
        return batch

    statuses = {p.status for p in payouts}
    now = timezone.now()
    update_fields = ["updated_at"]

    if statuses == {"CONFIRMED"}:
        batch.status = PayoutBatch.Status.CONFIRMED
        batch.failure_reason = ""
        if batch.confirmed_at is None:
            batch.confirmed_at = max((p.confirmed_at for p in payouts if p.confirmed_at), default=now)
            update_fields.append("confirmed_at")
        if batch.failed_at is not None:
            batch.failed_at = None
            update_fields.append("failed_at")
    elif statuses.issubset({"FAILED", "CANCELLED"}):
        batch.status = PayoutBatch.Status.FAILED
        batch.failure_reason = " | ".join(
            filter(
                None,
                [
                    f"payout#{p.id}:{(p.last_error_code or p.provider_error or p.status)[:120]}"
                    for p in payouts
                    if p.status in {"FAILED", "CANCELLED"}
                ],
            )
        )[:2000]
        if batch.failed_at is None:
            batch.failed_at = now
            update_fields.append("failed_at")
    elif statuses & {"SENT", "CONFIRMED", "DISPATCHING"}:
        batch.status = PayoutBatch.Status.DISPATCHED
        batch.failure_reason = ""
        if batch.dispatched_at is None:
            batch.dispatched_at = max((p.sent_at for p in payouts if p.sent_at), default=now)
            update_fields.append("dispatched_at")
    else:
        batch.status = PayoutBatch.Status.DRAFT
        batch.failure_reason = ""

    update_fields.extend(["status", "failure_reason"])
    batch.save(update_fields=update_fields)
    return batch


def _release_payout_items_to_eligible(*, payout: Payout):
    for item in payout.items.select_related("earning").all():
        earning = item.earning
        if earning.status == BusinessEarning.Status.IN_PAYOUT:
            earning.status = BusinessEarning.Status.ELIGIBLE
            earning.save(update_fields=["status"])
        if earning.order_id is not None:
            PayoutAdjustment.objects.filter(
                business_id=earning.business_id,
                order_id=earning.order_id,
                payment_reversal__isnull=False,
                payout__isnull=True,
                status=PayoutAdjustment.Status.PENDING,
            ).update(
                status=PayoutAdjustment.Status.CANCELLED,
                description="Cancelled after payout rollback: earning returned to eligible",
            )


def _refresh_batch_totals(*, batch: PayoutBatch) -> None:
    payouts = list(batch.payouts.prefetch_related("items"))
    batch.total_amount = sum(int(payout.amount) for payout in payouts)
    batch.earning_count = sum(payout.items.count() for payout in payouts)
    batch.save(update_fields=["total_amount", "earning_count", "updated_at"])


@transaction.atomic
def create_business_earning_for_order(
    *,
    order,
    gross_amount: int | None = None,
    platform_fee_amount: int | None = None,
    currency: str | None = None,
    eligible_at=None,
) -> BusinessEarning:
    order_accounting_mismatches = collect_order_accounting_mismatches(order=order)
    if order_accounting_mismatches:
        raise ValidationError({
            "order": f"Order accounting snapshot mismatch while creating business earning: {order_accounting_mismatches}"
        })

    accounting_snapshot = build_order_accounting_snapshot(order=order)
    snapshot_currency = str(accounting_snapshot["currency"] or "TRY")
    order_has_explicit_accounting = any([
        bool(order.pricing_snapshot),
        int(order.customer_fee_amount or 0) != 0,
        int(order.business_fee_amount or 0) != 0,
        int(order.subtotal_amount or 0) not in {0, int(order.amount or 0)},
        int(order.total_charged_amount or 0) not in {0, int(order.amount or 0)},
        int(order.business_net_amount or 0) not in {0, int(order.subtotal_amount or 0), int(order.amount or 0)},
    ])

    if gross_amount is None:
        gross_amount = int(order.subtotal_amount or 0) if order_has_explicit_accounting else int(order.amount)
    if platform_fee_amount is None:
        platform_fee_amount = int(order.business_fee_amount or 0) if order_has_explicit_accounting else platform_fee_amount
    resolved_currency = str(currency or snapshot_currency or "TRY").strip().upper() or "TRY"

    amounts = build_business_earning_breakdown(
        gross_amount=gross_amount,
        platform_fee_amount=platform_fee_amount,
    )

    snapshot_mismatches = {}
    if order_has_explicit_accounting:
        if int(amounts["gross_amount"]) != int(order.subtotal_amount or 0):
            snapshot_mismatches["gross_amount"] = (int(amounts["gross_amount"]), int(order.subtotal_amount or 0))
        if int(amounts["platform_fee_amount"]) != int(order.business_fee_amount or 0):
            snapshot_mismatches["platform_fee_amount"] = (int(amounts["platform_fee_amount"]), int(order.business_fee_amount or 0))
        if int(amounts["net_amount"]) != int(order.business_net_amount or 0):
            snapshot_mismatches["net_amount"] = (int(amounts["net_amount"]), int(order.business_net_amount or 0))
    if snapshot_mismatches:
        raise ValidationError({
            "order": f"Order accounting snapshot mismatch while creating business earning: {snapshot_mismatches}"
        })

    defaults = {
        "business": order.business,
        "gross_amount": amounts["gross_amount"],
        "platform_fee_amount": amounts["platform_fee_amount"],
        "net_amount": amounts["net_amount"],
        "currency": resolved_currency,
        "eligible_at": eligible_at if eligible_at is not None else default_business_earning_eligible_at(now=order.paid_at),
        "status": BusinessEarning.Status.PENDING,
    }
    earning, created = BusinessEarning.objects.get_or_create(order=order, defaults=defaults)

    if created:
        return earning

    mismatches = {}
    if earning.business_id != order.business_id:
        mismatches["business_id"] = (earning.business_id, order.business_id)
    for field, expected in defaults.items():
        actual = getattr(earning, field)
        if actual != expected:
            mismatches[field] = (actual, expected)

    if mismatches:
        raise ValidationError({
            "order": f"Existing earning does not match order accounting snapshot: {mismatches}"
        })

    return earning


class PayoutService:
    @staticmethod
    @transaction.atomic
    def run_eligibility_sweep(*, now=None) -> int:
        now = now or timezone.now()
        qs = BusinessEarning.objects.select_for_update().filter(
            status=BusinessEarning.Status.PENDING,
            eligible_at__lte=now,
        )
        moved = qs.update(status=BusinessEarning.Status.ELIGIBLE)
        return int(moved)

    @staticmethod
    def _default_batch_provider() -> str:
        return str(getattr(settings, "PAYOUT_PROVIDER", "manual") or "manual").strip().lower()

    @staticmethod
    def _create_batch_for_business(*, business, items, provider: str) -> PayoutBatch | None:
        items = [x for x in list(items) if get_earning_outstanding_amount(earning=x) > 0]
        adjustments = list(
            PayoutAdjustment.objects.select_for_update()
            .filter(business=business, status=PayoutAdjustment.Status.PENDING)
            .order_by("id")
        )
        if not items and not adjustments:
            raise ValidationError("No eligible earnings found for payout batch creation")

        earnings_total = sum(get_earning_outstanding_amount(earning=x) for x in items)
        adjustments_total = sum(int(x.amount) for x in adjustments)
        total = earnings_total + adjustments_total
        if total <= 0:
            return None

        batch = PayoutBatch.objects.create(
            business=business,
            provider=provider,
            status=PayoutBatch.Status.DRAFT,
            total_amount=total,
            earning_count=len(items),
        )

        payout = Payout.objects.create(
            batch=batch,
            business=business,
            amount=total,
            currency="TRY",
            status="CREATED",
            idempotency_key=_new_idempotency_key(),
            provider_reference="",
        )
        payout.provider_reference = payout_ref(payout.id)
        payout.save(update_fields=["provider_reference"])

        previous_batch_ids: set[int] = set()
        for earning in items:
            item_amount = get_earning_outstanding_amount(earning=earning)
            existing_item = getattr(earning, "payout_item", None)
            if existing_item is None:
                PayoutItem.objects.create(
                    payout=payout,
                    earning=earning,
                    amount=item_amount,
                )
                continue

            previous_payout = existing_item.payout
            if previous_payout.status not in {"FAILED", "CANCELLED"}:
                raise ValidationError(
                    f"Earning {earning.id} is already linked to non-mutable payout {previous_payout.id}"
                )

            previous_batch_ids.add(previous_payout.batch_id)
            previous_amount = int(existing_item.amount)
            previous_payout.amount = max(int(previous_payout.amount) - previous_amount, 0)
            previous_payout.save(update_fields=["amount"])

            existing_item.payout = payout
            existing_item.amount = item_amount
            existing_item.save(update_fields=["payout", "amount"])

        for previous_batch_id in previous_batch_ids:
            previous_batch = PayoutBatch.objects.select_for_update().get(id=previous_batch_id)
            _refresh_batch_totals(batch=previous_batch)
            _sync_batch_status(batch_id=previous_batch_id)

        BusinessEarning.objects.filter(id__in=[earning.id for earning in items]).update(status=BusinessEarning.Status.IN_PAYOUT)
        if adjustments:
            PayoutAdjustment.objects.filter(id__in=[adj.id for adj in adjustments]).update(
                status=PayoutAdjustment.Status.APPLIED,
                payout=payout,
                applied_at=timezone.now(),
            )
        return batch

    @staticmethod
    @transaction.atomic
    def create_batches_for_eligible(*, max_businesses: int | None = None, provider: str | None = None) -> list[PayoutBatch]:
        eligibles = list(
            BusinessEarning.objects.select_for_update()
            .filter(status=BusinessEarning.Status.ELIGIBLE)
            .filter(Q(payout_item__isnull=True) | Q(payout_item__payout__status__in=["FAILED", "CANCELLED"]))
            .select_related("business", "payout_item__payout")
            .order_by("business_id", "id")
            .distinct()
        )
        if not eligibles:
            return []

        selected_provider = _resolve_payout_provider(provider or PayoutService._default_batch_provider()).name
        batches: list[PayoutBatch] = []
        grouped: dict[int, list[BusinessEarning]] = {}
        business_order: list[int] = []

        for earning in eligibles:
            if earning.business_id not in grouped:
                if max_businesses is not None and len(grouped) >= max_businesses:
                    continue
                grouped[earning.business_id] = []
                business_order.append(earning.business_id)
            grouped[earning.business_id].append(earning)

        for business_id in business_order:
            items = grouped[business_id]
            batch = PayoutService._create_batch_for_business(
                business=items[0].business,
                items=items,
                provider=selected_provider,
            )
            if batch is not None:
                batches.append(batch)
        return batches

    @staticmethod
    @transaction.atomic
    def create_batch_for_eligible(*, max_businesses: int | None = None) -> PayoutBatch:
        batches = PayoutService.create_batches_for_eligible(max_businesses=max_businesses)
        if not batches:
            raise ValidationError("No eligible earnings found for payout batch creation")
        return batches[0]

    @staticmethod
    @transaction.atomic
    def mark_payout_sent(*, payout_id: int, provider_payout_id: str | None = None):
        payout = Payout.objects.select_for_update().select_related("batch", "business").get(id=payout_id)
        if payout.status not in {"CREATED", "DISPATCHING"}:
            return

        payout.status = "SENT"
        payout.sent_at = timezone.now()
        if provider_payout_id:
            payout.provider_payout_id = str(provider_payout_id)
        payout.attempt_count = int(payout.attempt_count) + 1
        payout.status_sync_attempt_count = 0
        payout.save(update_fields=["status", "sent_at", "provider_payout_id", "attempt_count", "status_sync_attempt_count"])

        _sync_batch_status(batch_id=payout.batch_id)

        for user in get_business_finance_notification_users(payout.business):
            NotificationService.enqueue(
                user=user,
                type=Notification.Type.PAYOUT_SENT,
                title="Ödeme transfer süreci başladı",
                body="İşletme payout kaydın gönderildi.",
                payload={"payout_id": payout.id},
                dedupe_key=f"payout_sent:{payout.id}",
            )

    @staticmethod
    @transaction.atomic
    def confirm_payout(
        *,
        payout_id: int,
        actor: User | None = None,
        source: str = "manual",
        note: str = "",
        provider_status_payload: dict | None = None,
        provider_item_reference_code: str = "",
    ) -> ConfirmPayoutResult:
        payout = Payout.objects.select_for_update().select_related("batch", "business").get(id=payout_id)
        if payout.status != "SENT":
            return ConfirmPayoutResult(changed=False, payout_id=int(payout.id), status=str(payout.status))

        now = timezone.now()
        payout.status = "CONFIRMED"
        payout.confirmed_at = now
        payout.confirmed_by = actor
        payout.confirm_source = source
        payout.confirm_note = (note or "")[:255]
        payout.next_retry_at = None
        payout.status_sync_attempt_count = 0
        payout.provider_error = ""
        payout.last_error_code = ""
        payout.last_error_at = None
        if provider_status_payload is not None:
            payout.provider_status_payload = provider_status_payload
        if provider_item_reference_code:
            payout.provider_item_reference_code = str(provider_item_reference_code)[:128]
        payout.save(update_fields=[
            "status",
            "confirmed_at",
            "confirmed_by",
            "confirm_source",
            "confirm_note",
            "next_retry_at",
            "status_sync_attempt_count",
            "provider_error",
            "last_error_code",
            "last_error_at",
            "provider_status_payload",
            "provider_item_reference_code",
        ])

        for item in payout.items.select_related("earning").all():
            earning = item.earning
            if earning.status in {BusinessEarning.Status.PAID, BusinessEarning.Status.REVERSED}:
                continue
            if earning.status != BusinessEarning.Status.PAID:
                earning.status = BusinessEarning.Status.PAID
                earning.paid_at = now
                earning.save(update_fields=["status", "paid_at"])

        _sync_batch_status(batch_id=payout.batch_id)

        for user in get_business_finance_notification_users(payout.business):
            NotificationService.enqueue(
                user=user,
                type=Notification.Type.PAYOUT_CONFIRMED,
                title="Payout onaylandı",
                body="İşletme payout kaydın settlement ile doğrulandı.",
                payload={"payout_id": payout.id},
                dedupe_key=f"payout_confirmed:{payout.id}",
            )

        return ConfirmPayoutResult(changed=True, payout_id=int(payout.id), status=str(payout.status))

    def sync_sent_payout_statuses(*, limit: int = 50) -> int:
        now = timezone.now()
        _, _, _, _, status_sync_max_attempts = PayoutService._payout_retry_policy()
        payouts = list(
            Payout.objects.select_related("business", "batch")
            .filter(status="SENT")
            .filter(status_sync_attempt_count__lt=status_sync_max_attempts)
            .filter(Q(next_retry_at__isnull=True) | Q(next_retry_at__lte=now))
            .order_by("id")[:limit]
        )
        if not payouts:
            return 0

        processed = 0
        for payout in payouts:
            status_result = _retrieve_provider_status(payout=payout)

            if status_result.ok:
                PayoutService.confirm_payout(
                    payout_id=payout.id,
                    actor=None,
                    source="provider_status_sync",
                    note=(
                        f"Provider sync payout_status={status_result.payout_status} "
                        f"item_status={status_result.item_status} "
                        f"item_reference_code={status_result.item_reference_code}"
                    )[:255],
                    provider_status_payload=status_result.raw or {},
                    provider_item_reference_code=status_result.item_reference_code,
                )
                processed += 1
                continue

            with transaction.atomic():
                locked_payout = Payout.objects.select_for_update().select_related("batch", "business").get(id=payout.id)
                if locked_payout.status != "SENT":
                    continue

                provider_status_payload = dict(status_result.raw or {})
                locked_payout.provider_error = (status_result.error_message or "")[:2000]
                locked_payout.last_error_code = (status_result.error_code or "")[:64]
                locked_payout.last_error_at = now
                locked_payout.provider_status_payload = provider_status_payload
                update_fields = [
                    "provider_error",
                    "last_error_code",
                    "last_error_at",
                    "provider_status_payload",
                ]

                if status_result.error_code == "UNSUPPORTED_PROVIDER_STATUS_SYNC":
                    locked_payout.status_sync_attempt_count = int(locked_payout.status_sync_attempt_count) + 1
                    locked_payout.next_retry_at = None
                    update_fields.extend(["next_retry_at", "status_sync_attempt_count"])
                    locked_payout.save(update_fields=update_fields)
                    processed += 1
                    continue

                locked_payout.status_sync_attempt_count = int(locked_payout.status_sync_attempt_count) + 1
                update_fields.append("status_sync_attempt_count")

                can_retry = status_result.retryable and int(locked_payout.status_sync_attempt_count) < status_sync_max_attempts
                if can_retry:
                    locked_payout.next_retry_at = PayoutService._compute_next_retry(int(locked_payout.status_sync_attempt_count))
                    update_fields.append("next_retry_at")
                else:
                    locked_payout.next_retry_at = None
                    update_fields.append("next_retry_at")
                    if status_result.retryable:
                        locked_payout.last_error_code = "STATUS_SYNC_RETRY_EXHAUSTED"
                        locked_payout.provider_error = (
                            (status_result.error_message or "")[:1800] + " | manual_review_required"
                        )[:2000]
                        locked_payout.provider_status_payload = {
                            **provider_status_payload,
                            "manual_review_required": True,
                            "status_sync_attempt_count": int(locked_payout.status_sync_attempt_count),
                            "retry_exhausted_at": now.isoformat(),
                        }
                        update_fields.extend(["last_error_code", "provider_error", "provider_status_payload"])
                    else:
                        if _requires_manual_review_for_provider_inconsistency(status_result=status_result):
                            locked_payout.last_error_code = "STATUS_SYNC_PROVIDER_INCONSISTENT"
                            locked_payout.provider_error = (
                                (status_result.error_message or "")[:1700] + " | provider_inconsistency_manual_review_required"
                            )[:2000]
                            locked_payout.provider_status_payload = {
                                **provider_status_payload,
                                "manual_review_required": True,
                                "provider_inconsistency": True,
                                "status_sync_attempt_count": int(locked_payout.status_sync_attempt_count),
                                "last_provider_error_code": status_result.error_code,
                            }
                            update_fields.extend(["last_error_code", "provider_error", "provider_status_payload"])
                        elif _has_payout_settlement_proof(payout=locked_payout):
                            locked_payout.last_error_code = "STATUS_SYNC_PROVIDER_FAILED_BUT_SETTLED"
                            locked_payout.provider_error = (
                                (status_result.error_message or "")[:1650] + " | settlement_proof_present_manual_review"
                            )[:2000]
                            locked_payout.provider_status_payload = {
                                **provider_status_payload,
                                "manual_review_required": True,
                                "settlement_proof_present": True,
                                "status_sync_attempt_count": int(locked_payout.status_sync_attempt_count),
                            }
                            update_fields.extend(["last_error_code", "provider_error", "provider_status_payload"])
                        else:
                            locked_payout.status = "FAILED"
                            update_fields.append("status")

                locked_payout.save(update_fields=update_fields)
                if locked_payout.status == "FAILED" and not status_result.retryable:
                    _release_payout_items_to_eligible(payout=locked_payout)
                    _sync_batch_status(batch_id=locked_payout.batch_id)
            processed += 1

        return processed

    @staticmethod
    def _payout_retry_policy():
        max_attempts = int(getattr(settings, "PAYOUT_MAX_ATTEMPTS", 8))
        base_seconds = int(getattr(settings, "PAYOUT_RETRY_BASE_SECONDS", 60))
        max_seconds = int(getattr(settings, "PAYOUT_RETRY_MAX_SECONDS", 6 * 60 * 60))
        lock_ttl_seconds = int(getattr(settings, "PAYOUT_LOCK_TTL_SECONDS", 10 * 60))
        status_sync_max_attempts = int(getattr(settings, "PAYOUT_STATUS_SYNC_MAX_ATTEMPTS", 12))
        return max_attempts, base_seconds, max_seconds, lock_ttl_seconds, status_sync_max_attempts

    @staticmethod
    def _compute_next_retry(attempt_count: int) -> datetime:
        _, base_seconds, max_seconds, _, _ = PayoutService._payout_retry_policy()
        delay = min(base_seconds * (2 ** max(attempt_count - 1, 0)), max_seconds)
        jitter_ratio = float(getattr(settings, "PAYOUT_RETRY_JITTER_RATIO", 0.2) or 0.0)
        if jitter_ratio > 0 and delay > 0:
            jitter_max = int(delay * jitter_ratio)
            if jitter_max > 0:
                delay = min(delay + random.randint(0, jitter_max), max_seconds)
        return timezone.now() + timedelta(seconds=delay)

    @staticmethod
    def dispatch_due_payouts(*, limit: int = 50, worker_id: str = "local") -> int:
        now = timezone.now()
        max_attempts, _, _, lock_ttl, _ = PayoutService._payout_retry_policy()
        stale_before = now - timedelta(seconds=lock_ttl)

        stale_payouts = list(
            Payout.objects.filter(status="DISPATCHING", locked_at__lt=stale_before)
            .select_related("business")
            .only(
                "id",
                "batch_id",
                "attempt_count",
                "business_id",
                "provider_payout_id",
                "provider_dispatch_payload",
                "sent_at",
            )
        )
        if stale_payouts:
            stale_batch_ids = {p.batch_id for p in stale_payouts}
            for stale_payout in stale_payouts:
                stale_payload = dict(stale_payout.provider_dispatch_payload or {})
                stale_payload["stale_lock_recovery"] = {
                    "at": now.isoformat(),
                    "worker": worker_id,
                    "reason": "LOCK_STALE_RECOVERED" if str(stale_payout.provider_payout_id or "").strip() else "LOCK_STALE",
                }
                if str(stale_payout.provider_payout_id or "").strip():
                    Payout.objects.filter(id=stale_payout.id).update(
                        status="SENT",
                        sent_at=stale_payout.sent_at or now,
                        locked_at=None,
                        locked_by="",
                        last_error_code="LOCK_STALE_RECOVERED",
                        last_error_at=now,
                        provider_error="Dispatcher lock stale; moved to SENT for provider status sync",
                        provider_dispatch_payload=stale_payload,
                        next_retry_at=now,
                        status_sync_attempt_count=0,
                    )
                    continue

                current_attempt_count = int(stale_payout.attempt_count)
                next_attempt_count = min(current_attempt_count + 1, max_attempts)
                can_retry = next_attempt_count < max_attempts
                Payout.objects.filter(id=stale_payout.id).update(
                    status="FAILED",
                    attempt_count=next_attempt_count,
                    locked_at=None,
                    locked_by="",
                    last_error_code="LOCK_STALE",
                    last_error_at=now,
                    provider_error="Dispatcher lock stale; moved to FAILED",
                    provider_dispatch_payload=stale_payload,
                    next_retry_at=(
                        PayoutService._compute_next_retry(next_attempt_count)
                        if can_retry
                        else None
                    ),
                )
                if not can_retry:
                    stale_payout.refresh_from_db(fields=["status"])
                    _release_payout_items_to_eligible(payout=stale_payout)
            for batch_id in stale_batch_ids:
                _sync_batch_status(batch_id=batch_id)

        picked = list(
            Payout.objects.select_related("business", "batch")
            .filter(Q(status="CREATED") | Q(status="FAILED", provider_payout_id=""), attempt_count__lt=max_attempts)
            .filter(Q(next_retry_at__isnull=True) | Q(next_retry_at__lte=now))
            .order_by("id")[:limit]
        )
        if not picked:
            return 0

        processed = 0
        for payout in picked:
            provider_reference = payout.provider_reference or payout_ref(payout.id)
            claimed = (
                Payout.objects.filter(id=payout.id)
                .filter(Q(status="CREATED") | Q(status="FAILED", provider_payout_id=""), attempt_count__lt=max_attempts)
                .filter(Q(next_retry_at__isnull=True) | Q(next_retry_at__lte=now))
                .update(
                    provider_reference=provider_reference,
                    status="DISPATCHING",
                    locked_at=now,
                    locked_by=worker_id,
                    attempt_count=F("attempt_count") + 1,
                )
            )
            if not claimed:
                continue

            payout.refresh_from_db()
            dispatch_claim_payload = dict(payout.provider_dispatch_payload or {})
            dispatch_claim_payload["dispatch_claim"] = {
                "at": now.isoformat(),
                "worker": worker_id,
                "attempt_count": int(payout.attempt_count),
                "provider_reference": provider_reference,
            }
            payout.provider_dispatch_payload = dispatch_claim_payload
            payout.save(update_fields=["provider_dispatch_payload"])

            res = _dispatch_with_provider(payout=payout)

            if res.ok:
                payout.status = "SENT"
                payout.sent_at = timezone.now()
                payout.provider_payout_id = res.provider_payout_id
                payout.status_sync_attempt_count = 0
                payout.locked_at = None
                payout.locked_by = ""
                payout.provider_error = ""
                payout.last_error_code = ""
                payout.last_error_at = None
                payout.next_retry_at = None
                payout.provider_dispatch_payload = res.raw or {}
                payout.save(update_fields=[
                    "status",
                    "sent_at",
                    "provider_payout_id",
                    "status_sync_attempt_count",
                    "locked_at",
                    "locked_by",
                    "provider_error",
                    "last_error_code",
                    "last_error_at",
                    "next_retry_at",
                    "provider_dispatch_payload",
                ])

                if not payout.batch.external_batch_id:
                    payout.batch.external_batch_id = res.provider_payout_id or payout.provider_reference
                    payout.batch.save(update_fields=["external_batch_id", "updated_at"])

                _sync_batch_status(batch_id=payout.batch_id)

                for user in get_business_finance_notification_users(payout.business):
                    NotificationService.enqueue(
                        user=user,
                        type=Notification.Type.PAYOUT_SENT,
                        title="Ödeme transfer süreci başladı",
                        body="İşletme payout kaydın gönderildi.",
                        payload={"payout_id": payout.id},
                        dedupe_key=f"payout_sent:{payout.id}",
                    )

                processed += 1
                continue

            provider_payout_id = str(res.provider_payout_id or "").strip()
            is_inflight_unknown = _is_inflight_dispatch_failure(payout=payout, dispatch_result=res)

            payout.status = "SENT" if is_inflight_unknown else "FAILED"
            if is_inflight_unknown and payout.sent_at is None:
                payout.sent_at = timezone.now()
            if provider_payout_id:
                payout.provider_payout_id = provider_payout_id
            payout.provider_error = (res.error_message or "")[:2000]
            payout.last_error_code = (res.error_code or "")[:64]
            payout.last_error_at = timezone.now()
            payout.locked_at = None
            payout.locked_by = ""
            payout.provider_dispatch_payload = res.raw or {}
            can_retry = (not is_inflight_unknown) and res.retryable and int(payout.attempt_count) < max_attempts
            payout.next_retry_at = (
                PayoutService._compute_next_retry(int(payout.attempt_count))
                if can_retry
                else None
            )
            if is_inflight_unknown:
                payout.status_sync_attempt_count = 0
            if (not is_inflight_unknown) and (not res.retryable):
                payout.attempt_count = max_attempts
            payout.save(update_fields=[
                "status",
                "sent_at",
                "attempt_count",
                "provider_payout_id",
                "provider_error",
                "last_error_code",
                "last_error_at",
                "locked_at",
                "locked_by",
                "next_retry_at",
                "provider_dispatch_payload",
                "status_sync_attempt_count",
            ])

            if (not is_inflight_unknown) and (not can_retry) and (not res.retryable):
                _release_payout_items_to_eligible(payout=payout)

            _sync_batch_status(batch_id=payout.batch_id)
            processed += 1

        return processed


@dataclass(frozen=True)
class BusinessReversalResult:
    mode: str
    reversed_amount: int
    payout_adjustment_id: int | None = None


class BusinessReversalService:
    _PRE_DISPATCH_MUTABLE_PAYOUT_STATUSES = {"CREATED", "FAILED", "CANCELLED"}

    @staticmethod
    def _apply_earning_reverse_in_place(*, earning: BusinessEarning, amount: int, now) -> None:
        earning.reversed_amount = int(earning.reversed_amount or 0) + int(amount)
        earning.reversed_at = now
        if int(earning.reversed_amount) >= int(earning.net_amount):
            earning.status = BusinessEarning.Status.REVERSED
        earning.save(update_fields=["reversed_amount", "reversed_at", "status"])

    @staticmethod
    def _reverse_locked_payout_item(*, earning: BusinessEarning, payout_item: PayoutItem, amount: int, now) -> bool:
        payout = (
            Payout.objects.select_for_update()
            .select_related("batch")
            .get(id=payout_item.payout_id)
        )
        if payout.status not in BusinessReversalService._PRE_DISPATCH_MUTABLE_PAYOUT_STATUSES:
            return False

        item_amount = int(payout_item.amount)
        if amount > item_amount:
            raise ValidationError("reversal amount exceeds mutable payout item amount")

        new_item_amount = item_amount - int(amount)
        if new_item_amount > 0:
            payout_item.amount = new_item_amount
            payout_item.save(update_fields=["amount"])
        else:
            payout_item.delete()

        new_payout_amount = int(payout.amount) - int(amount)
        if new_payout_amount < 0:
            raise ValidationError("reversal amount exceeds mutable payout amount")

        payout.amount = new_payout_amount
        payout_fields = ["amount"]
        if new_payout_amount == 0:
            payout.status = "CANCELLED"
            payout.next_retry_at = None
            payout.locked_at = None
            payout.locked_by = ""
            payout.provider_error = "Cancelled before dispatch due to full earning reversal"
            payout_fields.extend(["status", "next_retry_at", "locked_at", "locked_by", "provider_error"])
        payout.save(update_fields=payout_fields)

        _refresh_batch_totals(batch=payout.batch)

        BusinessReversalService._apply_earning_reverse_in_place(earning=earning, amount=amount, now=now)
        _sync_batch_status(batch_id=payout.batch_id)
        return True

    @staticmethod
    @transaction.atomic
    def reverse_order_earning(
        *,
        order,
        amount: int,
        reason_code: str = "",
        payment_reversal=None,
        description: str = "",
    ) -> BusinessReversalResult:
        amount = int(amount)
        if amount <= 0:
            raise ValidationError("reversal amount must be positive")

        earning = BusinessEarning.objects.select_for_update().select_related("payout_item", "business").get(order=order)
        already_reversed = int(earning.reversed_amount or 0)
        if already_reversed + amount > int(earning.net_amount):
            raise ValidationError("earning reversal exceeds outstanding net receivable")

        now = timezone.now()
        payout_item = getattr(earning, "payout_item", None)
        if payout_item is None and earning.status in {BusinessEarning.Status.PENDING, BusinessEarning.Status.ELIGIBLE}:
            BusinessReversalService._apply_earning_reverse_in_place(earning=earning, amount=amount, now=now)
            return BusinessReversalResult(mode="pre_payout_reversed", reversed_amount=amount)

        if payout_item is not None and BusinessReversalService._reverse_locked_payout_item(
            earning=earning,
            payout_item=payout_item,
            amount=amount,
            now=now,
        ):
            return BusinessReversalResult(mode="pre_payout_reversed", reversed_amount=amount)

        adjustment = PayoutAdjustment.objects.create(
            business=earning.business,
            order=order,
            payment_reversal=payment_reversal,
            amount=-amount,
            status=PayoutAdjustment.Status.PENDING,
            reason_code=(reason_code or "")[:64],
            description=(description or "Order reversal carried to next payout cycle")[:255],
        )
        earning.reversed_amount = already_reversed + amount
        earning.reversed_at = now
        if int(earning.reversed_amount) >= int(earning.net_amount):
            earning.status = BusinessEarning.Status.REVERSED
            earning.save(update_fields=["reversed_amount", "reversed_at", "status"])
        else:
            earning.save(update_fields=["reversed_amount", "reversed_at"])
        return BusinessReversalResult(mode="next_cycle_adjustment", reversed_amount=amount, payout_adjustment_id=adjustment.pk)
