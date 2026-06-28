from __future__ import annotations

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from orders.models import CHECKOUT_SESSION_TTL_MINUTES, CheckoutSession
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from surprise_deals.notifications import notify_surprise_deal_expired


RELEASABLE_RESERVATION_STATUSES = {
    SurpriseDealReservation.Status.RELEASED,
    SurpriseDealReservation.Status.EXPIRED,
    SurpriseDealReservation.Status.CANCELLED,
}


def _default_reservation_expiry(*, deal: SurpriseDeal, now) -> object:
    checkout_like_expiry = now + timedelta(minutes=CHECKOUT_SESSION_TTL_MINUTES)
    if deal.pickup_window_end and deal.pickup_window_end < checkout_like_expiry:
        return deal.pickup_window_end
    return checkout_like_expiry


def _close_if_sold_out(*, deal: SurpriseDeal) -> None:
    if deal.status == SurpriseDeal.Status.ACTIVE and int(deal.quantity_remaining or 0) <= 0:
        deal.status = SurpriseDeal.Status.CLOSED
        deal.closed_at = timezone.now()


def _reopen_if_available_after_release(*, deal: SurpriseDeal, now) -> None:
    if (
        deal.status == SurpriseDeal.Status.CLOSED
        and int(deal.quantity_remaining or 0) > 0
        and deal.pickup_window_end > now
    ):
        deal.status = SurpriseDeal.Status.ACTIVE
        deal.closed_at = None


@transaction.atomic
def reserve_surprise_deal(*, deal_id, user, quantity: int = 1, checkout_session=None, expires_at=None) -> SurpriseDealReservation:
    quantity = int(quantity)
    now = timezone.now()

    if quantity <= 0:
        raise ValidationError("Rezervasyon adedi pozitif olmalıdır.")
    if not user or not getattr(user, "is_authenticated", False):
        raise ValidationError("Rezervasyon için oturum açmış kullanıcı gerekir.")

    deal = SurpriseDeal.objects.select_for_update().select_related("business").get(pk=deal_id)

    if deal.status != SurpriseDeal.Status.ACTIVE:
        raise ValidationError("Bu sürpriz paket şu anda satışa açık değil.")
    if deal.pickup_window_end <= now:
        raise ValidationError("Bu sürpriz paketin teslim alma süresi dolmuş.")
    if int(deal.quantity_remaining or 0) < quantity:
        raise ValidationError("Bu sürpriz paket için yeterli stok kalmadı.")
    if checkout_session is not None:
        if checkout_session.user_id != user.id:
            raise ValidationError("Checkout session kullanıcı ile eşleşmiyor.")
        if checkout_session.business_id != deal.business_id:
            raise ValidationError("Checkout session işletme ile eşleşmiyor.")

    reservation_expires_at = expires_at or _default_reservation_expiry(deal=deal, now=now)
    if reservation_expires_at <= now:
        raise ValidationError("Rezervasyon süresi geçerli olmalıdır.")

    deal.quantity_remaining = int(deal.quantity_remaining) - quantity
    deal.quantity_reserved = int(deal.quantity_reserved or 0) + quantity
    _close_if_sold_out(deal=deal)
    deal.save(update_fields=["quantity_remaining", "quantity_reserved", "status", "closed_at", "updated_at"])

    return SurpriseDealReservation.objects.create(
        surprise_deal=deal,
        checkout_session=checkout_session,
        user=user,
        quantity=quantity,
        status=SurpriseDealReservation.Status.RESERVED,
        reserved_at=now,
        expires_at=reservation_expires_at,
    )


@transaction.atomic
def release_surprise_deal_reservation(*, reservation_id, reason_status: str = SurpriseDealReservation.Status.RELEASED) -> SurpriseDealReservation:
    if reason_status not in RELEASABLE_RESERVATION_STATUSES:
        raise ValidationError("Geçersiz rezervasyon kapatma durumu.")

    reservation = (
        SurpriseDealReservation.objects.select_for_update()
        .select_related("surprise_deal")
        .get(pk=reservation_id)
    )

    if reservation.status != SurpriseDealReservation.Status.RESERVED:
        return reservation

    now = timezone.now()
    deal = SurpriseDeal.objects.select_for_update().get(pk=reservation.surprise_deal_id)
    quantity = int(reservation.quantity)

    deal.quantity_reserved = max(int(deal.quantity_reserved or 0) - quantity, 0)
    deal.quantity_remaining = int(deal.quantity_remaining or 0) + quantity
    _reopen_if_available_after_release(deal=deal, now=now)
    deal.save(update_fields=["quantity_remaining", "quantity_reserved", "status", "closed_at", "updated_at"])

    reservation.status = reason_status
    reservation.released_at = now
    reservation.save(update_fields=["status", "released_at", "updated_at"])
    return reservation


@transaction.atomic
def commit_surprise_deal_reservation(*, reservation_id) -> SurpriseDealReservation:
    reservation = (
        SurpriseDealReservation.objects.select_for_update()
        .select_related("surprise_deal")
        .get(pk=reservation_id)
    )

    if reservation.status != SurpriseDealReservation.Status.RESERVED:
        return reservation

    deal = SurpriseDeal.objects.select_for_update().get(pk=reservation.surprise_deal_id)
    quantity = int(reservation.quantity)

    deal.quantity_reserved = max(int(deal.quantity_reserved or 0) - quantity, 0)
    deal.save(update_fields=["quantity_reserved", "updated_at"])

    reservation.status = SurpriseDealReservation.Status.COMMITTED
    reservation.committed_at = timezone.now()
    reservation.save(update_fields=["status", "committed_at", "updated_at"])
    return reservation


def _is_session_safe_to_expire(*, session: CheckoutSession | None) -> bool:
    if session is None:
        return True
    return session.status != CheckoutSession.Status.CONSUMED


def _expire_checkout_session_if_waiting(*, session: CheckoutSession | None) -> None:
    if session is None:
        return
    if session.status in {CheckoutSession.Status.PENDING, CheckoutSession.Status.CONFIRMED}:
        session.status = CheckoutSession.Status.EXPIRED
        session.save(update_fields=["status", "updated_at"])


def expire_due_surprise_deal_reservations(*, now=None, limit: int = 100, dry_run: bool = False) -> int:
    now = now or timezone.now()
    limit = max(int(limit), 1)
    reservation_ids = list(
        SurpriseDealReservation.objects.filter(
            status=SurpriseDealReservation.Status.RESERVED,
            expires_at__lte=now,
        )
        .exclude(checkout_session__status=CheckoutSession.Status.CONSUMED)
        .order_by("expires_at", "id")
        .values_list("id", flat=True)[:limit]
    )

    if dry_run:
        return len(reservation_ids)

    expired_count = 0
    for reservation_id in reservation_ids:
        with transaction.atomic():
            reservation = (
                SurpriseDealReservation.objects.select_for_update()
                .select_related("checkout_session")
                .filter(id=reservation_id)
                .first()
            )
            if reservation is None:
                continue
            if reservation.status != SurpriseDealReservation.Status.RESERVED or reservation.expires_at > now:
                continue

            session = None
            if reservation.checkout_session_id:
                session = CheckoutSession.objects.select_for_update().filter(id=reservation.checkout_session_id).first()
            if not _is_session_safe_to_expire(session=session):
                continue

            _expire_checkout_session_if_waiting(session=session)
            reservation = release_surprise_deal_reservation(
                reservation_id=reservation_id,
                reason_status=SurpriseDealReservation.Status.EXPIRED,
            )
            if reservation.status == SurpriseDealReservation.Status.EXPIRED:
                notify_surprise_deal_expired(reservation=reservation, checkout_session=session)
                expired_count += 1
    return expired_count
