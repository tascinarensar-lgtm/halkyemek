from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from businesses.models import BusinessMember
from businesses.services.membership import (
    get_business_operational_notification_users,
    user_has_business_membership,
    user_has_business_role,
)
from menus.models import MenuItem
from notifications.models import Notification
from notifications.services import NotificationService
from orders.models import Cart, CheckoutSession, Order, OrderItem, ORDER_QR_TTL_HOURS
from orders.services_cart import CartComputationResult, CartService
from orders.services_quota import (
    commit_quota_for_checkout_session,
    release_quota_for_checkout_session,
    reserve_quota_for_checkout_session,
)
from payouts.services import build_business_earning_breakdown, create_business_earning_for_order
from surprise_deals.models import SurpriseDealReservation
from surprise_deals.services import release_surprise_deal_reservation
from surprise_deals.services_consume import (
    SurpriseDealConsumeInsufficientBalance,
    SurpriseDealConsumeInvalidReservation,
    SurpriseDealConsumeReservationNotFound,
    consume_surprise_deal_checkout_session,
)
from wallets.models import Wallet
from wallets.services import WalletService


class CheckoutSessionError(Exception):
    pass


class CheckoutSessionNotFound(CheckoutSessionError):
    pass


class CheckoutSessionExpired(CheckoutSessionError):
    pass


class CheckoutSessionAlreadyConsumed(CheckoutSessionError):
    def __init__(self, message: str = "Checkout session already consumed.", *, order_id: int | None = None):
        super().__init__(message)
        self.order_id = order_id


class CheckoutSessionCancelled(CheckoutSessionError):
    pass


class CheckoutSessionBusinessMismatch(CheckoutSessionError):
    pass


class CheckoutSessionForbidden(CheckoutSessionError):
    pass


class CheckoutSessionInsufficientBalance(CheckoutSessionError):
    pass


class CheckoutSessionInvalidMenuItem(CheckoutSessionError):
    pass


@dataclass
class CheckoutConsumeResult:
    session: CheckoutSession
    order: Order
    amount: int


@dataclass
class CheckoutSessionAccessResult:
    session: CheckoutSession
    can_consume: bool
    failure_reason: str = ""
    existing_order_id: int | None = None


def _expire_if_needed(session: CheckoutSession) -> CheckoutSession:
    if session.status in {
        CheckoutSession.Status.PENDING,
        CheckoutSession.Status.CONFIRMED,
    } and session.expires_at <= timezone.now():
        session.status = CheckoutSession.Status.EXPIRED
        session.save(update_fields=["status", "updated_at"])
        release_quota_for_checkout_session(session=session)
        if session.source_type == CheckoutSession.SourceType.SURPRISE_DEAL:
            reservation = SurpriseDealReservation.objects.filter(
                checkout_session=session,
                status=SurpriseDealReservation.Status.RESERVED,
            ).only("id").first()
            if reservation is not None:
                release_surprise_deal_reservation(
                    reservation_id=reservation.id,
                    reason_status=SurpriseDealReservation.Status.EXPIRED,
                )
        if session.cart_id and session.cart.status == Cart.Status.CHECKED_OUT:
            session.cart.status = Cart.Status.ABANDONED
            session.cart.abandoned_at = timezone.now()
            session.cart.save(update_fields=["status", "abandoned_at", "updated_at"])
    return session


def _get_reusable_pending_session(*, user: User, cart: Cart, amount: int) -> CheckoutSession | None:
    session = (
        CheckoutSession.objects.filter(
            user=user,
            business=cart.business,
            cart=cart,
            status=CheckoutSession.Status.PENDING,
            amount=amount,
            expires_at__gt=timezone.now(),
        )
        .order_by("-created_at")
        .first()
    )
    if session is None:
        return None
    return _expire_if_needed(session)


def _release_checked_out_cart(*, session: CheckoutSession) -> None:
    if session.cart_id is None:
        return

    cart = Cart.objects.select_for_update().filter(id=session.cart_id).first()
    if cart is None or cart.status != Cart.Status.CHECKED_OUT:
        return

    has_other_active_cart = (
        Cart.objects.select_for_update()
        .filter(user=session.user, status=Cart.Status.ACTIVE)
        .exclude(id=cart.id)
        .exists()
    )

    if has_other_active_cart:
        cart.status = Cart.Status.ABANDONED
        cart.abandoned_at = timezone.now()
        cart.save(update_fields=["status", "abandoned_at", "updated_at"])
        return

    cart.status = Cart.Status.ACTIVE
    cart.checked_out_at = None
    cart.abandoned_at = None
    cart.save(update_fields=["status", "checked_out_at", "abandoned_at", "updated_at"])




def get_latest_reusable_checkout_session(*, user: User) -> CheckoutSession | None:
    session = (
        CheckoutSession.objects.filter(
            user=user,
            status__in=[CheckoutSession.Status.PENDING, CheckoutSession.Status.CONFIRMED],
            expires_at__gt=timezone.now(),
        )
        .select_related("business", "cart")
        .order_by("-created_at")
        .first()
    )
    if session is None:
        return None
    return _expire_if_needed(session)


@transaction.atomic
def cancel_checkout_session(*, token: str, actor_user: User) -> CheckoutSession:
    session = (
        CheckoutSession.objects.select_for_update()
        .select_related("user", "business", "cart")
        .filter(token=token)
        .first()
    )

    if not session:
        raise CheckoutSessionNotFound("Checkout session not found.")

    session = _expire_if_needed(session)

    if not actor_user or not actor_user.is_authenticated:
        raise CheckoutSessionForbidden("Authenticated user required.")

    is_owner = session.user_id == actor_user.id
    if not (is_owner or actor_user.is_admin()):
        raise CheckoutSessionForbidden("You do not have access to cancel this checkout session.")

    if session.status == CheckoutSession.Status.EXPIRED:
        raise CheckoutSessionExpired("Checkout session expired.")
    if session.status == CheckoutSession.Status.CONSUMED:
        existing_order = Order.objects.filter(checkout_session=session).only("id").first()
        raise CheckoutSessionAlreadyConsumed(
            "Checkout session already consumed.",
            order_id=existing_order.id if existing_order else None,
        )
    if session.status == CheckoutSession.Status.CANCELLED:
        return session
    if session.status not in {CheckoutSession.Status.PENDING, CheckoutSession.Status.CONFIRMED}:
        raise CheckoutSessionError("Checkout session is not cancellable.")

    session.status = CheckoutSession.Status.CANCELLED
    session.cancelled_at = timezone.now()
    session.save(update_fields=["status", "cancelled_at", "updated_at"])

    release_quota_for_checkout_session(session=session)
    if session.source_type == CheckoutSession.SourceType.SURPRISE_DEAL:
        reservation = SurpriseDealReservation.objects.filter(
            checkout_session=session,
            status=SurpriseDealReservation.Status.RESERVED,
        ).only("id").first()
        if reservation is not None:
            release_surprise_deal_reservation(
                reservation_id=reservation.id,
                reason_status=SurpriseDealReservation.Status.CANCELLED,
            )
    _release_checked_out_cart(session=session)

    return session


@transaction.atomic
def create_checkout_session(*, user: User, cart: Cart) -> CheckoutSession:
    if not user or not user.is_authenticated:
        raise CheckoutSessionForbidden("Authenticated user required.")

    if cart.status != Cart.Status.ACTIVE:
        raise CheckoutSessionInvalidMenuItem("Active cart required.")

    if cart.user_id != user.id:
        raise CheckoutSessionForbidden("Cart does not belong to user.")

    result: CartComputationResult = CartService.recompute_active_cart(cart=cart)
    if result.item_count <= 0 or result.pricing is None:
        raise CheckoutSessionInvalidMenuItem("Cart is empty.")

    business = cart.business

    if not business.is_active or not business.is_approved or not business.is_listed or not business.marketplace_is_visible:
        raise CheckoutSessionInvalidMenuItem("Business is not available for checkout.")

    amount = int(result.pricing.total_payable_amount)

    wallet = Wallet.objects.filter(user=user).only("balance", "is_active").first()
    if not wallet:
        raise CheckoutSessionInsufficientBalance("Wallet not found.")
    if not wallet.is_active:
        raise CheckoutSessionInsufficientBalance("Wallet is not active.")
    if int(wallet.balance) < amount:
        raise CheckoutSessionInsufficientBalance("Insufficient wallet balance.")

    reusable_session = _get_reusable_pending_session(user=user, cart=cart, amount=amount)
    if reusable_session is not None:
        reserve_quota_for_checkout_session(session=reusable_session)
        return reusable_session

    session = CheckoutSession.objects.create(
        user=user,
        business=business,
        cart=cart,
        token=CheckoutSession.generate_token(),
        status=CheckoutSession.Status.PENDING,
        amount=amount,
        subtotal_amount=int(result.pricing.subtotal_amount),
        customer_fee_amount=int(result.pricing.customer_fee_amount),
        business_fee_amount=int(result.pricing.business_fee_amount),
        business_net_amount=int(result.pricing.business_net_amount),
        platform_total_fee_amount=int(result.pricing.platform_total_fee_amount),
        item_count=int(result.item_count),
        currency=str(result.pricing.currency),
        business_name=business.business_name,
        pricing_snapshot=result.pricing.as_dict(),
        cart_snapshot=cart.snapshot,
        expires_at=CheckoutSession.default_expiry(),
    )

    reserve_quota_for_checkout_session(session=session)

    cart.status = Cart.Status.CHECKED_OUT
    cart.checked_out_at = timezone.now()
    cart.save(update_fields=["status", "checked_out_at", "updated_at"])

    return session


def get_checkout_session_by_token(*, token: str, actor_user: User | None = None) -> CheckoutSession:
    session = (
        CheckoutSession.objects.filter(token=token)
        .select_related("user", "business", "cart")
        .first()
    )

    if not session:
        raise CheckoutSessionNotFound("Checkout session not found.")

    session = _expire_if_needed(session)

    if actor_user is None:
        return session

    if not actor_user.is_authenticated:
        raise CheckoutSessionForbidden("Authenticated user required.")

    is_owner = session.user_id == actor_user.id
    is_business_member = user_has_business_membership(actor_user, session.business)
    if not (is_owner or is_business_member or actor_user.is_admin()):
        raise CheckoutSessionForbidden("You do not have access to this checkout session.")

    return session


def get_checkout_session_by_identifier(*, identifier: str, business_id: int | None = None) -> CheckoutSession:
    normalized_identifier = str(identifier or "").strip()
    if not normalized_identifier:
        raise CheckoutSessionNotFound("Checkout session not found.")

    queryset = CheckoutSession.objects.select_related("user", "business", "cart")
    if business_id is not None:
        queryset = queryset.filter(business_id=business_id)

    session = queryset.filter(
        Q(token=normalized_identifier) | Q(cashier_code__iexact=normalized_identifier.upper())
    ).first()
    if session is None:
        raise CheckoutSessionNotFound("Checkout session not found.")
    return session


def _build_checkout_session_consume_preview_from_session(*, session: CheckoutSession, actor_user: User, business_id: int) -> CheckoutSessionAccessResult:
    session = _expire_if_needed(session)

    if session.business_id != business_id:
        raise CheckoutSessionBusinessMismatch("Checkout session does not belong to this business.")

    if not user_has_business_role(
        actor_user,
        session.business,
        [
            BusinessMember.Role.CASHIER,
            BusinessMember.Role.MANAGER,
            BusinessMember.Role.OWNER,
        ],
    ):
        raise CheckoutSessionForbidden("Business cashier access required.")

    existing_order = Order.objects.filter(checkout_session=session).only("id").first()

    if session.status == CheckoutSession.Status.EXPIRED:
        return CheckoutSessionAccessResult(session=session, can_consume=False, failure_reason="expired")
    if session.status == CheckoutSession.Status.CANCELLED:
        return CheckoutSessionAccessResult(session=session, can_consume=False, failure_reason="cancelled")
    if session.status == CheckoutSession.Status.CONSUMED:
        return CheckoutSessionAccessResult(
            session=session,
            can_consume=False,
            failure_reason="already_consumed",
            existing_order_id=existing_order.id if existing_order else None,
        )
    if session.status not in {CheckoutSession.Status.PENDING, CheckoutSession.Status.CONFIRMED}:
        return CheckoutSessionAccessResult(session=session, can_consume=False, failure_reason="invalid_status")

    if existing_order is not None:
        return CheckoutSessionAccessResult(
            session=session,
            can_consume=False,
            failure_reason="already_consumed",
            existing_order_id=existing_order.id,
        )

    cart_snapshot_items = list((session.cart_snapshot or {}).get("items") or [])
    if not cart_snapshot_items:
        return CheckoutSessionAccessResult(session=session, can_consume=False, failure_reason="empty_snapshot")

    if (
        not session.business.is_active
        or not session.business.is_approved
        or not session.business.is_listed
        or not session.business.marketplace_is_visible
    ):
        return CheckoutSessionAccessResult(session=session, can_consume=False, failure_reason="business_unavailable")

    wallet = Wallet.objects.filter(user=session.user).only("balance").first()
    if wallet is None:
        return CheckoutSessionAccessResult(session=session, can_consume=False, failure_reason="wallet_missing")
    if int(wallet.balance) < int(session.amount):
        return CheckoutSessionAccessResult(session=session, can_consume=False, failure_reason="insufficient_balance")

    return CheckoutSessionAccessResult(session=session, can_consume=True)


def build_checkout_session_consume_preview(*, token: str, actor_user: User, business_id: int) -> CheckoutSessionAccessResult:
    session = get_checkout_session_by_identifier(identifier=token, business_id=business_id)
    return _build_checkout_session_consume_preview_from_session(
        session=session,
        actor_user=actor_user,
        business_id=business_id,
    )


def build_checkout_session_consume_preview_by_identifier(*, identifier: str, actor_user: User, business_id: int) -> CheckoutSessionAccessResult:
    session = get_checkout_session_by_identifier(identifier=identifier, business_id=business_id)
    return _build_checkout_session_consume_preview_from_session(
        session=session,
        actor_user=actor_user,
        business_id=business_id,
    )


@transaction.atomic
def _consume_cart_checkout_session(*, token: str, actor_user: User, business_id: int) -> CheckoutConsumeResult:
    session = CheckoutSession.objects.select_for_update().select_related("user", "business", "cart").filter(token=token).first()

    if not session:
        raise CheckoutSessionNotFound("Checkout session not found.")

    session = _expire_if_needed(session)

    if session.business_id != business_id:
        raise CheckoutSessionBusinessMismatch("Checkout session does not belong to this business.")

    if not user_has_business_role(
        actor_user,
        session.business,
        [
            BusinessMember.Role.CASHIER,
            BusinessMember.Role.MANAGER,
            BusinessMember.Role.OWNER,
        ],
    ):
        raise CheckoutSessionForbidden("Business cashier access required.")

    if session.status == CheckoutSession.Status.EXPIRED:
        raise CheckoutSessionExpired("Checkout session expired.")
    if session.status == CheckoutSession.Status.CANCELLED:
        raise CheckoutSessionCancelled("Checkout session cancelled.")
    if session.status == CheckoutSession.Status.CONSUMED:
        existing_order = Order.objects.filter(checkout_session=session).only("id").first()
        raise CheckoutSessionAlreadyConsumed(
            "Checkout session already consumed.",
            order_id=existing_order.id if existing_order else None,
        )
    if session.status not in {
        CheckoutSession.Status.PENDING,
        CheckoutSession.Status.CONFIRMED,
    }:
        raise CheckoutSessionError("Checkout session is not consumable.")

    existing_order = Order.objects.filter(checkout_session=session).only("id").first()
    if existing_order is not None:
        raise CheckoutSessionAlreadyConsumed(
            "Checkout session already has an order.",
            order_id=existing_order.id,
        )

    if session.source_type == CheckoutSession.SourceType.SURPRISE_DEAL:
        try:
            surprise_result = consume_surprise_deal_checkout_session(
                session=session,
                actor_user=actor_user,
            )
        except SurpriseDealConsumeReservationNotFound as exc:
            raise CheckoutSessionInvalidMenuItem(str(exc)) from exc
        except SurpriseDealConsumeInvalidReservation as exc:
            if "expired" in str(exc).lower():
                raise CheckoutSessionExpired(str(exc)) from exc
            raise CheckoutSessionInvalidMenuItem(str(exc)) from exc
        except SurpriseDealConsumeInsufficientBalance as exc:
            raise CheckoutSessionInsufficientBalance(str(exc)) from exc
        return CheckoutConsumeResult(
            session=surprise_result.session,
            order=surprise_result.order,
            amount=surprise_result.amount,
        )

    cart_snapshot = session.cart_snapshot or {}
    cart_snapshot_items = list(cart_snapshot.get("items") or [])
    if not cart_snapshot_items:
        raise CheckoutSessionInvalidMenuItem("Checkout cart snapshot is empty.")

    reserve_quota_for_checkout_session(session=session)

    if (
        not session.business.is_active
        or not session.business.is_approved
        or not session.business.is_listed
        or not session.business.marketplace_is_visible
    ):
        raise CheckoutSessionInvalidMenuItem("Business is no longer available.")

    wallet = Wallet.objects.select_for_update().filter(user=session.user).first()
    if not wallet:
        raise CheckoutSessionInsufficientBalance("Wallet not found.")
    if int(wallet.balance) < int(session.amount):
        raise CheckoutSessionInsufficientBalance("Insufficient wallet balance.")

    now = timezone.now()
    earning_breakdown = build_business_earning_breakdown(
        gross_amount=int(session.subtotal_amount),
        platform_fee_amount=int(session.business_fee_amount),
    )

    representative_menu_id = cart_snapshot_items[0].get("menu_item_id")
    representative_menu = MenuItem.objects.filter(id=representative_menu_id).first() if representative_menu_id else None

    if len(cart_snapshot_items) == 1:
        business_notification_label = str(cart_snapshot_items[0].get("name") or "Sipariş")
    else:
        business_notification_label = f"{int(session.item_count)} ürünlük sipariş"

    order = Order(
        user=session.user,
        business=session.business,
        menu=representative_menu,
        amount=int(session.amount),
        subtotal_amount=int(session.subtotal_amount),
        customer_fee_amount=int(session.customer_fee_amount),
        business_fee_amount=int(earning_breakdown["platform_fee_amount"]),
        total_charged_amount=int(session.amount),
        business_net_amount=int(earning_breakdown["net_amount"]),
        item_count=int(session.item_count),
        pricing_snapshot=session.pricing_snapshot,
        order_snapshot={
            "contract": "cart_checkout_qr_order",
            "checkout_session_id": session.id,
            "checkout_session_token": session.token,
            "business_name": session.business_name,
            "cart_id": session.cart_id,
            "cart_snapshot": session.cart_snapshot,
        },
        status=Order.Status.CREATED,
        checkout_session=session,
    )
    order.mark_paid(ttl_hours=ORDER_QR_TTL_HOURS)
    order.mark_used()
    order.save()

    for idx, item_payload in enumerate(cart_snapshot_items):
        item_menu_id = item_payload.get("menu_item_id")
        item_menu = MenuItem.objects.filter(id=item_menu_id).first() if item_menu_id else None
        OrderItem.objects.create(
            order=order,
            menu_item=item_menu,
            quantity=int(item_payload.get("quantity") or 0),
            unit_price_amount=int(item_payload.get("unit_price_amount") or 0),
            line_total_amount=int(item_payload.get("line_total_amount") or 0),
            menu_item_name=str(item_payload.get("name") or ""),
            menu_item_snapshot=dict(item_payload.get("menu_item_snapshot") or {}),
            sort_order=int(item_payload.get("sort_order") or idx),
        )

    WalletService.purchase(
        user=session.user,
        amount=int(session.amount),
        description=f"{session.business_name} - {session.item_count} item(s)",
        order=order,
    )

    create_business_earning_for_order(
        order=order,
        gross_amount=int(session.subtotal_amount),
        platform_fee_amount=int(earning_breakdown["platform_fee_amount"]),
        currency="TRY",
    )

    session.status = CheckoutSession.Status.CONSUMED
    session.consumed_at = now
    session.consumed_by = actor_user
    session.save(update_fields=["status", "consumed_at", "consumed_by", "updated_at"])

    commit_quota_for_checkout_session(session=session)

    if session.cart_id:
        cart = session.cart
        cart.status = Cart.Status.CONVERTED
        cart.converted_order = order
        cart.save(update_fields=["status", "converted_order", "updated_at"])

    NotificationService.enqueue(
        user=session.user,
        type=Notification.Type.ORDER_PAID,
        title="Ödemen tamamlandı",
        body=f"{session.business_name} için ödemen başarıyla alındı.",
        payload={
            "order_id": order.id,
            "checkout_session_id": session.id,
                "amount": session.amount,
                "business_id": session.business_id,
            },
        dedupe_key=f"checkout_consumed:{session.id}:customer",
    )

    for user in get_business_operational_notification_users(session.business):
        NotificationService.enqueue(
            user=user,
            type=Notification.Type.ORDER_CONSUMED,
            title="Yeni sipariş tüketildi",
            body=f"{business_notification_label} kasada başarıyla tüketildi.",
            payload={
                "order_id": order.id,
                "checkout_session_id": session.id,
                "amount": session.amount,
                "business_id": session.business_id,
                "consumed_by_user_id": actor_user.id,
            },
            dedupe_key=f"checkout_consumed:{session.id}:business:{user.id}",
        )

    return CheckoutConsumeResult(session=session, order=order, amount=int(session.amount))


def consume_checkout_session(*, token: str, actor_user: User, business_id: int) -> CheckoutConsumeResult:
    session = CheckoutSession.objects.filter(token=token).select_related("business").first()
    if not session:
        raise CheckoutSessionNotFound("Checkout session not found.")

    if session.source_type != CheckoutSession.SourceType.SURPRISE_DEAL:
        return _consume_cart_checkout_session(token=token, actor_user=actor_user, business_id=business_id)

    if session.business_id != business_id:
        raise CheckoutSessionBusinessMismatch("Checkout session does not belong to this business.")

    if session.status == CheckoutSession.Status.CONSUMED:
        existing_order = Order.objects.filter(checkout_session=session).only("id").first()
        raise CheckoutSessionAlreadyConsumed(
            "Checkout session already consumed.",
            order_id=existing_order.id if existing_order else None,
        )
    if session.status == CheckoutSession.Status.CANCELLED:
        raise CheckoutSessionCancelled("Checkout session cancelled.")
    if session.status not in {
        CheckoutSession.Status.PENDING,
        CheckoutSession.Status.CONFIRMED,
    }:
        raise CheckoutSessionError("Checkout session is not consumable.")

    try:
        surprise_result = consume_surprise_deal_checkout_session(
            session=session,
            actor_user=actor_user,
        )
    except SurpriseDealConsumeReservationNotFound as exc:
        raise CheckoutSessionInvalidMenuItem(str(exc)) from exc
    except SurpriseDealConsumeInvalidReservation as exc:
        if "expired" in str(exc).lower():
            raise CheckoutSessionExpired(str(exc)) from exc
        raise CheckoutSessionInvalidMenuItem(str(exc)) from exc
    except SurpriseDealConsumeInsufficientBalance as exc:
        raise CheckoutSessionInsufficientBalance(str(exc)) from exc

    return CheckoutConsumeResult(
        session=surprise_result.session,
        order=surprise_result.order,
        amount=surprise_result.amount,
    )
