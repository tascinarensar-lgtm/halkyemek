from __future__ import annotations

from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from businesses.models import BusinessMember
from businesses.services.membership import user_has_business_role
from orders.models import ORDER_QR_TTL_HOURS, CheckoutSession, Order, OrderItem
from payouts.services import build_business_earning_breakdown, create_business_earning_for_order
from surprise_deals.models import SurpriseDealReservation
from surprise_deals.notifications import notify_surprise_deal_consumed
from surprise_deals.services import commit_surprise_deal_reservation, release_surprise_deal_reservation
from wallets.models import Wallet
from wallets.services import WalletService


class SurpriseDealConsumeError(Exception):
    pass


class SurpriseDealConsumeReservationNotFound(SurpriseDealConsumeError):
    pass


class SurpriseDealConsumeInvalidReservation(SurpriseDealConsumeError):
    pass


class SurpriseDealConsumeInsufficientBalance(SurpriseDealConsumeError):
    pass


@dataclass
class SurpriseDealConsumeResult:
    session: CheckoutSession
    order: Order
    amount: int
    reservation: SurpriseDealReservation


def _assert_cashier_access(*, actor_user, session: CheckoutSession) -> None:
    if not user_has_business_role(
        actor_user,
        session.business,
        [
            BusinessMember.Role.CASHIER,
            BusinessMember.Role.MANAGER,
            BusinessMember.Role.OWNER,
        ],
    ):
        raise ValidationError("Business cashier access required.")


def _build_order_item_snapshot(*, session: CheckoutSession, reservation: SurpriseDealReservation) -> dict:
    deal = reservation.surprise_deal
    return {
        "source_type": "SURPRISE_DEAL",
        "surprise_deal_id": int(deal.id),
        "checkout_session_id": int(session.id),
        "business_id": int(deal.business_id),
        "title": deal.title,
        "description": deal.description,
        "original_value_amount": int(deal.original_value_amount),
        "sale_price_amount": int(deal.sale_price_amount),
        "quantity": int(reservation.quantity),
        "pickup_window_start": deal.pickup_window_start.isoformat(),
        "pickup_window_end": deal.pickup_window_end.isoformat(),
        "min_contents_note": deal.min_contents_note,
        "allergens_note": deal.allergens_note,
        "image_url": deal.image_url or "",
    }


def consume_surprise_deal_checkout_session(*, session: CheckoutSession, actor_user) -> SurpriseDealConsumeResult:
    failure: Exception | None = None
    result: SurpriseDealConsumeResult | None = None
    consumed_reservation: SurpriseDealReservation | None = None

    with transaction.atomic():
        session = (
            CheckoutSession.objects.select_for_update()
            .select_related("user", "business")
            .get(id=session.id)
        )
        _assert_cashier_access(actor_user=actor_user, session=session)

        reservation = (
            SurpriseDealReservation.objects.select_for_update()
            .select_related("surprise_deal", "surprise_deal__business")
            .filter(checkout_session=session)
            .first()
        )
        if reservation is None:
            raise SurpriseDealConsumeReservationNotFound("Surpriz paket rezervasyonu bulunamadi.")
        if reservation.status != SurpriseDealReservation.Status.RESERVED:
            raise SurpriseDealConsumeInvalidReservation("Surpriz paket rezervasyonu tuketime uygun degil.")
        if session.status not in {CheckoutSession.Status.PENDING, CheckoutSession.Status.CONFIRMED}:
            raise SurpriseDealConsumeInvalidReservation("Checkout session tuketime uygun degil.")

        if session.expires_at <= timezone.now():
            release_surprise_deal_reservation(
                reservation_id=reservation.id,
                reason_status=SurpriseDealReservation.Status.EXPIRED,
            )
            session.status = CheckoutSession.Status.EXPIRED
            session.save(update_fields=["status", "updated_at"])
            failure = SurpriseDealConsumeInvalidReservation("Checkout session expired.")
        else:
            wallet = Wallet.objects.select_for_update().filter(user=session.user).first()
            if wallet is None or not wallet.is_active or int(wallet.balance) < int(session.amount):
                release_surprise_deal_reservation(
                    reservation_id=reservation.id,
                    reason_status=SurpriseDealReservation.Status.CANCELLED,
                )
                session.status = CheckoutSession.Status.CANCELLED
                session.cancelled_at = timezone.now()
                session.save(update_fields=["status", "cancelled_at", "updated_at"])
                failure = SurpriseDealConsumeInsufficientBalance("Cuzdan bakiyesi yetersiz.")

        if failure is None:
            now = timezone.now()
            earning_breakdown = build_business_earning_breakdown(
                gross_amount=int(session.subtotal_amount),
                platform_fee_amount=int(session.business_fee_amount),
            )
            deal = reservation.surprise_deal
            order_item_snapshot = _build_order_item_snapshot(session=session, reservation=reservation)

            order = Order(
                user=session.user,
                business=session.business,
                menu=None,
                amount=int(session.amount),
                subtotal_amount=int(session.subtotal_amount),
                customer_fee_amount=int(session.customer_fee_amount),
                business_fee_amount=int(earning_breakdown["platform_fee_amount"]),
                total_charged_amount=int(session.amount),
                business_net_amount=int(earning_breakdown["net_amount"]),
                item_count=int(reservation.quantity),
                pricing_snapshot=session.pricing_snapshot,
                order_snapshot={
                    "contract": "surprise_deal_qr_order_v1",
                    "checkout_session_id": int(session.id),
                    "checkout_session_token": session.token,
                    "source_type": CheckoutSession.SourceType.SURPRISE_DEAL,
                    "business_name": session.business_name,
                    "surprise_deal": order_item_snapshot,
                },
                status=Order.Status.CREATED,
                checkout_session=session,
            )
            order.mark_paid(ttl_hours=ORDER_QR_TTL_HOURS)
            order.mark_used()
            order.save()

            OrderItem.objects.create(
                order=order,
                menu_item=None,
                quantity=int(reservation.quantity),
                unit_price_amount=int(deal.sale_price_amount),
                line_total_amount=int(deal.sale_price_amount) * int(reservation.quantity),
                menu_item_name=deal.title or "Surpriz Paket",
                menu_item_snapshot=order_item_snapshot,
                sort_order=0,
            )

            WalletService.purchase(
                user=session.user,
                amount=int(session.amount),
                description=f"{session.business_name} - Surpriz Paket",
                order=order,
            )

            create_business_earning_for_order(
                order=order,
                gross_amount=int(session.subtotal_amount),
                platform_fee_amount=int(earning_breakdown["platform_fee_amount"]),
                currency=session.currency or "TRY",
            )

            committed_reservation = commit_surprise_deal_reservation(reservation_id=reservation.id)

            session.status = CheckoutSession.Status.CONSUMED
            session.consumed_at = now
            session.consumed_by = actor_user
            session.save(update_fields=["status", "consumed_at", "consumed_by", "updated_at"])
            consumed_reservation = committed_reservation
            result = SurpriseDealConsumeResult(session=session, order=order, amount=int(session.amount), reservation=committed_reservation)

    if failure is not None:
        raise failure
    if result is None:  # pragma: no cover - defensive guardrail
        raise SurpriseDealConsumeInvalidReservation("Surpriz paket tuketimi tamamlanamadi.")
    if consumed_reservation is not None:
        notify_surprise_deal_consumed(
            reservation=consumed_reservation,
            checkout_session=result.session,
            order=result.order,
        )
    return result
