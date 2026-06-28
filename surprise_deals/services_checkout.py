from __future__ import annotations

from dataclasses import dataclass

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from orders.models import CheckoutSession
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from surprise_deals.notifications import notify_surprise_deal_reserved
from surprise_deals.services import reserve_surprise_deal
from wallets.models import Wallet


class SurpriseDealCheckoutError(Exception):
    pass


class SurpriseDealCheckoutNotFound(SurpriseDealCheckoutError):
    pass


class SurpriseDealCheckoutForbidden(SurpriseDealCheckoutError):
    pass


class SurpriseDealCheckoutInvalid(SurpriseDealCheckoutError):
    pass


class SurpriseDealCheckoutInsufficientBalance(SurpriseDealCheckoutError):
    pass


class SurpriseDealCheckoutDuplicateReservation(SurpriseDealCheckoutError):
    pass


@dataclass
class SurpriseDealCheckoutResult:
    session: CheckoutSession
    deal: SurpriseDeal
    reservation: SurpriseDealReservation
    total_amount: int
    wallet_balance: int
    insufficient_balance: bool = False


def _public_checkout_deal_queryset():
    now = timezone.now()
    return (
        SurpriseDeal.objects.select_for_update()
        .select_related("business")
        .filter(
            status=SurpriseDeal.Status.ACTIVE,
            quantity_remaining__gt=0,
            pickup_window_end__gt=now,
            business__is_active=True,
            business__is_approved=True,
            business__is_listed=True,
            business__marketplace_is_visible=True,
        )
    )


def _checkout_expiry_for_deal(*, deal: SurpriseDeal):
    default_expiry = CheckoutSession.default_expiry()
    if deal.pickup_window_end < default_expiry:
        return deal.pickup_window_end
    return default_expiry


def _build_snapshot(*, deal: SurpriseDeal, quantity: int, total_amount: int) -> dict:
    return {
        "contract": "surprise_deal_checkout_v1",
        "source_type": CheckoutSession.SourceType.SURPRISE_DEAL,
        "surprise_deal_id": int(deal.id),
        "business_id": int(deal.business_id),
        "business_name": deal.business.business_name,
        "item_count": int(quantity),
        "items": [
            {
                "source_type": "SURPRISE_DEAL",
                "surprise_deal_id": int(deal.id),
                "name": deal.title,
                "quantity": int(quantity),
                "unit_price_amount": int(deal.sale_price_amount),
                "line_total_amount": int(total_amount),
                "original_value_amount": int(deal.original_value_amount),
                "image_url": deal.image_url or "",
                "pickup_window_start": deal.pickup_window_start.isoformat(),
                "pickup_window_end": deal.pickup_window_end.isoformat(),
            }
        ],
    }


def _build_pricing_snapshot(*, deal: SurpriseDeal, quantity: int, total_amount: int) -> dict:
    return {
        "contract": "surprise_deal_checkout_pricing_v1",
        "currency": deal.currency or "TRY",
        "subtotal_amount": int(total_amount),
        "customer_fee_amount": 0,
        "business_fee_amount": 0,
        "business_net_amount": int(total_amount),
        "platform_total_fee_amount": 0,
        "total_payable_amount": int(total_amount),
        "item_count": int(quantity),
    }


@transaction.atomic
def create_surprise_deal_checkout_session(*, user, deal_id, quantity: int = 1) -> SurpriseDealCheckoutResult:
    if not user or not getattr(user, "is_authenticated", False):
        raise SurpriseDealCheckoutForbidden("Oturum acmis kullanici gerekir.")

    try:
        quantity = int(quantity)
    except (TypeError, ValueError):
        raise SurpriseDealCheckoutInvalid("Gecersiz adet.")

    if quantity != 1:
        raise SurpriseDealCheckoutInvalid("V1 icin surpriz paket adedi 1 ile sinirlidir.")

    now = timezone.now()
    deal = _public_checkout_deal_queryset().filter(id=deal_id).first()
    if deal is None:
        raise SurpriseDealCheckoutNotFound("Surpriz paket bulunamadi.")

    active_reservation_exists = SurpriseDealReservation.objects.select_for_update().filter(
        surprise_deal=deal,
        user=user,
        status=SurpriseDealReservation.Status.RESERVED,
        expires_at__gt=now,
    ).exists()
    if active_reservation_exists:
        raise SurpriseDealCheckoutDuplicateReservation("Bu firsat icin aktif rezervasyonunuz var.")

    total_amount = int(deal.sale_price_amount) * quantity
    wallet = Wallet.objects.select_for_update().filter(user=user).only("balance", "is_active").first()
    if wallet is None:
        raise SurpriseDealCheckoutInsufficientBalance("Cuzdan bulunamadi.")
    if not wallet.is_active:
        raise SurpriseDealCheckoutInsufficientBalance("Cuzdan aktif degil.")
    if int(wallet.balance) < total_amount:
        raise SurpriseDealCheckoutInsufficientBalance("Cuzdan bakiyesi yetersiz.")

    expires_at = _checkout_expiry_for_deal(deal=deal)
    if expires_at <= now:
        raise SurpriseDealCheckoutNotFound("Surpriz paketin teslim suresi doldu.")

    pricing_snapshot = _build_pricing_snapshot(deal=deal, quantity=quantity, total_amount=total_amount)
    cart_snapshot = _build_snapshot(deal=deal, quantity=quantity, total_amount=total_amount)

    session = CheckoutSession.objects.create(
        user=user,
        business=deal.business,
        cart=None,
        source_type=CheckoutSession.SourceType.SURPRISE_DEAL,
        token=CheckoutSession.generate_token(),
        status=CheckoutSession.Status.PENDING,
        amount=total_amount,
        subtotal_amount=total_amount,
        customer_fee_amount=0,
        business_fee_amount=0,
        business_net_amount=total_amount,
        platform_total_fee_amount=0,
        item_count=quantity,
        currency=deal.currency or "TRY",
        business_name=deal.business.business_name,
        pricing_snapshot=pricing_snapshot,
        cart_snapshot=cart_snapshot,
        expires_at=expires_at,
    )

    try:
        reservation = reserve_surprise_deal(
            deal_id=deal.id,
            user=user,
            quantity=quantity,
            checkout_session=session,
            expires_at=expires_at,
        )
    except ValidationError as exc:
        raise SurpriseDealCheckoutInvalid(str(exc))

    notify_surprise_deal_reserved(reservation=reservation, checkout_session=session)

    return SurpriseDealCheckoutResult(
        session=session,
        deal=reservation.surprise_deal,
        reservation=reservation,
        total_amount=total_amount,
        wallet_balance=int(wallet.balance),
        insufficient_balance=False,
    )
