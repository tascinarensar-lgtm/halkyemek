from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from menus.models import MenuItem, MenuItemQuota
from orders.models import CheckoutQuotaReservation, CheckoutSession


class MenuItemQuotaError(Exception):
    code = "menu_item_quota_error"


class MenuItemSoldOut(MenuItemQuotaError):
    code = "menu_item_sold_out"


class MenuItemQuotaExceeded(MenuItemQuotaError):
    code = "menu_item_quota_exceeded"


@dataclass(frozen=True)
class MenuItemQuotaState:
    enabled: bool
    remaining: int | None
    label: str | None
    is_sold_out: bool
    can_add_to_cart: bool
    low_stock_threshold: int


def get_menu_item_quota(menu_item: MenuItem) -> MenuItemQuota | None:
    try:
        return menu_item.quota
    except MenuItemQuota.DoesNotExist:
        return None


def build_menu_item_quota_state(menu_item: MenuItem) -> MenuItemQuotaState:
    quota = get_menu_item_quota(menu_item)
    if quota is None or not quota.is_enabled or quota.quota_remaining is None:
        return MenuItemQuotaState(
            enabled=False,
            remaining=None,
            label=None,
            is_sold_out=False,
            can_add_to_cart=bool(menu_item.is_active and menu_item.is_visible and menu_item.is_available),
            low_stock_threshold=12,
        )

    remaining = int(quota.quota_remaining)
    threshold = int(quota.low_stock_threshold or 0)
    is_sold_out = remaining <= 0

    if is_sold_out:
        label = "Tükendi"
    elif threshold > 0 and remaining <= threshold:
        label = f"Son {remaining} adet"
    else:
        label = f"Bugün {remaining} adet kaldı"

    return MenuItemQuotaState(
        enabled=True,
        remaining=remaining,
        label=label,
        is_sold_out=is_sold_out,
        can_add_to_cart=bool(menu_item.is_active and menu_item.is_visible and menu_item.is_available and not is_sold_out),
        low_stock_threshold=threshold,
    )


def assert_menu_item_quota_available(*, menu_item: MenuItem, quantity: int) -> None:
    quantity = int(quantity)
    if quantity <= 0:
        return

    quota = get_menu_item_quota(menu_item)
    if quota is None or not quota.is_enabled or quota.quota_remaining is None:
        return

    remaining = int(quota.quota_remaining)
    if remaining <= 0:
        raise MenuItemSoldOut("Bu ürün az önce tükendi.")
    if remaining < quantity:
        raise MenuItemQuotaExceeded("Sepetteki miktar kalan kotayı aşıyor.")


def build_quota_snapshot_for_menu_item(menu_item: MenuItem) -> dict:
    state = build_menu_item_quota_state(menu_item)
    return {
        "quota_enabled": state.enabled,
        "quota_remaining": state.remaining,
        "quota_label": state.label,
        "is_sold_out": state.is_sold_out,
        "can_add_to_cart": state.can_add_to_cart,
        "low_stock_threshold": state.low_stock_threshold,
    }


def _aggregate_session_quantities(session: CheckoutSession) -> dict[int, int]:
    quantities: dict[int, int] = defaultdict(int)
    for item in (session.cart_snapshot or {}).get("items") or []:
        menu_item_id = item.get("menu_item_id")
        if not menu_item_id:
            continue
        quantities[int(menu_item_id)] += int(item.get("quantity") or 0)
    return {menu_item_id: quantity for menu_item_id, quantity in quantities.items() if quantity > 0}


@transaction.atomic
def reserve_quota_for_checkout_session(*, session: CheckoutSession) -> None:
    existing_reservation = (
        CheckoutQuotaReservation.objects.select_for_update()
        .filter(checkout_session=session)
        .only("id")
        .first()
    )
    if existing_reservation is not None:
        return

    quantities = _aggregate_session_quantities(session)
    if not quantities:
        return

    quotas = list(
        MenuItemQuota.objects.select_for_update()
        .filter(menu_item_id__in=sorted(quantities), is_enabled=True)
        .order_by("menu_item_id")
    )
    quota_by_menu_item_id = {int(quota.menu_item_id): quota for quota in quotas}

    for menu_item_id, quantity in quantities.items():
        quota = quota_by_menu_item_id.get(menu_item_id)
        if quota is None or quota.quota_remaining is None:
            continue
        remaining = int(quota.quota_remaining)
        if remaining <= 0:
            raise MenuItemSoldOut("Bu ürün az önce tükendi.")
        if remaining < quantity:
            raise MenuItemQuotaExceeded("Sepetteki miktar kalan kotayı aşıyor.")

    for menu_item_id, quantity in quantities.items():
        quota = quota_by_menu_item_id.get(menu_item_id)
        if quota is None or quota.quota_remaining is None:
            continue
        quota.quota_remaining = int(quota.quota_remaining) - quantity
        quota.quota_reserved = int(quota.quota_reserved or 0) + quantity
        quota.save(update_fields=["quota_remaining", "quota_reserved", "updated_at"])
        CheckoutQuotaReservation.objects.create(
            checkout_session=session,
            menu_item_id=menu_item_id,
            quantity=quantity,
            status=CheckoutQuotaReservation.Status.RESERVED,
        )


@transaction.atomic
def release_quota_for_checkout_session(*, session: CheckoutSession) -> None:
    reservations = list(
        CheckoutQuotaReservation.objects.select_for_update()
        .filter(checkout_session=session, status=CheckoutQuotaReservation.Status.RESERVED)
        .order_by("menu_item_id")
    )
    if not reservations:
        return

    quotas = list(
        MenuItemQuota.objects.select_for_update()
        .filter(menu_item_id__in=[reservation.menu_item_id for reservation in reservations])
        .order_by("menu_item_id")
    )
    quota_by_menu_item_id = {int(quota.menu_item_id): quota for quota in quotas}
    now = timezone.now()

    for reservation in reservations:
        quota = quota_by_menu_item_id.get(int(reservation.menu_item_id))
        if quota is not None and quota.quota_remaining is not None:
            quota.quota_remaining = int(quota.quota_remaining) + int(reservation.quantity)
            quota.quota_reserved = max(int(quota.quota_reserved or 0) - int(reservation.quantity), 0)
            quota.save(update_fields=["quota_remaining", "quota_reserved", "updated_at"])

        reservation.status = CheckoutQuotaReservation.Status.RELEASED
        reservation.released_at = now
        reservation.save(update_fields=["status", "released_at"])


@transaction.atomic
def commit_quota_for_checkout_session(*, session: CheckoutSession) -> None:
    reservations = list(
        CheckoutQuotaReservation.objects.select_for_update()
        .filter(checkout_session=session, status=CheckoutQuotaReservation.Status.RESERVED)
        .order_by("menu_item_id")
    )
    if not reservations:
        return

    quotas = list(
        MenuItemQuota.objects.select_for_update()
        .filter(menu_item_id__in=[reservation.menu_item_id for reservation in reservations])
        .order_by("menu_item_id")
    )
    quota_by_menu_item_id = {int(quota.menu_item_id): quota for quota in quotas}
    now = timezone.now()

    for reservation in reservations:
        quota = quota_by_menu_item_id.get(int(reservation.menu_item_id))
        if quota is not None:
            quota.quota_reserved = max(int(quota.quota_reserved or 0) - int(reservation.quantity), 0)
            quota.save(update_fields=["quota_reserved", "updated_at"])

        reservation.status = CheckoutQuotaReservation.Status.COMMITTED
        reservation.committed_at = now
        reservation.save(update_fields=["status", "committed_at"])
