from __future__ import annotations

import logging

from businesses.models import BusinessMember
from notifications.models import Notification
from notifications.services import NotificationService
from orders.models import CheckoutSession, Order
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation

logger = logging.getLogger(__name__)


def _deal_payload(
    *,
    deal: SurpriseDeal,
    reservation: SurpriseDealReservation | None = None,
    checkout_session: CheckoutSession | None = None,
    order: Order | None = None,
) -> dict:
    return {
        "surprise_deal_id": int(deal.id),
        "reservation_id": int(reservation.id) if reservation else None,
        "checkout_session_id": int(checkout_session.id) if checkout_session else None,
        "order_id": int(order.id) if order else None,
        "business_id": int(deal.business_id),
        "title": deal.title,
        "business_name": deal.business.business_name if getattr(deal, "business", None) else "",
        "pickup_window_start": deal.pickup_window_start.isoformat() if deal.pickup_window_start else None,
        "pickup_window_end": deal.pickup_window_end.isoformat() if deal.pickup_window_end else None,
        "url": f"/checkout/{checkout_session.token}" if checkout_session else "/halktasarruf",
        "source_type": "SURPRISE_DEAL",
    }


def _safe_enqueue(*, user, type: str, title: str, body: str, payload: dict, dedupe_key: str) -> None:
    if not user:
        return
    try:
        NotificationService.enqueue(
            user=user,
            type=type,
            title=title[:120],
            body=body[:240],
            payload=payload,
            dedupe_key=dedupe_key[:128],
        )
    except Exception:
        logger.exception(
            "surprise_deal.notification_enqueue_failed",
            extra={
                "user_id": int(getattr(user, "pk", 0) or 0),
                "type": type,
                "dedupe_key": dedupe_key,
                "surprise_deal_id": payload.get("surprise_deal_id"),
                "reservation_id": payload.get("reservation_id"),
                "checkout_session_id": payload.get("checkout_session_id"),
                "order_id": payload.get("order_id"),
            },
        )


def notify_surprise_deal_reserved(*, reservation: SurpriseDealReservation, checkout_session: CheckoutSession) -> None:
    deal = reservation.surprise_deal
    payload = _deal_payload(deal=deal, reservation=reservation, checkout_session=checkout_session)
    _safe_enqueue(
        user=reservation.user,
        type=Notification.Type.SURPRISE_DEAL_RESERVED,
        title="Sürpriz paketin ayrıldı",
        body=f"{deal.business.business_name} için {deal.title} rezervasyonun hazır. QR kodunu teslim saatinde göster.",
        payload=payload,
        dedupe_key=f"surprise-deal-reserved:{int(reservation.id)}",
    )


def notify_surprise_deal_consumed(*, reservation: SurpriseDealReservation, checkout_session: CheckoutSession, order: Order) -> None:
    deal = reservation.surprise_deal
    payload = _deal_payload(deal=deal, reservation=reservation, checkout_session=checkout_session, order=order)
    amount = int(order.total_charged_amount or order.amount or 0)

    _safe_enqueue(
        user=order.user,
        type=Notification.Type.SURPRISE_DEAL_CONSUMED,
        title="Sürpriz paket teslim edildi",
        body=f"{deal.title} teslim edildi. Sipariş #{order.id} başarıyla tamamlandı.",
        payload={**payload, "amount": amount, "audience": "CUSTOMER"},
        dedupe_key=f"surprise-deal-consumed:customer:{int(order.id)}",
    )

    members = (
        BusinessMember.objects.select_related("user")
        .filter(
            business_id=deal.business_id,
            is_active=True,
            role__in=[BusinessMember.Role.OWNER, BusinessMember.Role.MANAGER],
            user__is_active=True,
        )
        .order_by("user_id")
    )
    seen_user_ids: set[int] = set()
    for member in members:
        user_id = int(member.user_id)
        if user_id in seen_user_ids:
            continue
        seen_user_ids.add(user_id)
        _safe_enqueue(
            user=member.user,
            type=Notification.Type.SURPRISE_DEAL_CONSUMED,
            title="Sürpriz paket kullanıldı",
            body=f"{deal.title} kullanıldı. Sipariş #{order.id} tamamlandı.",
            payload={**payload, "amount": amount, "audience": "BUSINESS", "business_role": member.role},
            dedupe_key=f"surprise-deal-consumed:business:{int(order.id)}:{user_id}",
        )


def notify_surprise_deal_expired(*, reservation: SurpriseDealReservation, checkout_session: CheckoutSession | None = None) -> None:
    deal = reservation.surprise_deal
    payload = _deal_payload(deal=deal, reservation=reservation, checkout_session=checkout_session)
    _safe_enqueue(
        user=reservation.user,
        type=Notification.Type.SURPRISE_DEAL_EXPIRED,
        title="Sürpriz paket rezervasyonun süresi doldu",
        body=f"{deal.business.business_name} için {deal.title} rezervasyonunun süresi doldu.",
        payload=payload,
        dedupe_key=f"surprise-deal-expired:{int(reservation.id)}",
    )


def notify_surprise_deal_closed(*, deal: SurpriseDeal) -> None:
    payload = _deal_payload(deal=deal)
    members = (
        BusinessMember.objects.select_related("user")
        .filter(
            business_id=deal.business_id,
            is_active=True,
            role__in=[BusinessMember.Role.OWNER, BusinessMember.Role.MANAGER],
            user__is_active=True,
        )
        .order_by("user_id")
    )
    seen_user_ids: set[int] = set()
    for member in members:
        user_id = int(member.user_id)
        if user_id in seen_user_ids:
            continue
        seen_user_ids.add(user_id)
        _safe_enqueue(
            user=member.user,
            type=Notification.Type.SURPRISE_DEAL_CLOSED,
            title="Sürpriz paket kapatıldı",
            body=f"{deal.title} artık satışa kapalı.",
            payload={**payload, "audience": "BUSINESS", "business_role": member.role},
            dedupe_key=f"surprise-deal-closed:{int(deal.id)}:{user_id}",
        )
