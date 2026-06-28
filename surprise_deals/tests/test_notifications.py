from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from notifications.models import Notification
from orders.models import CheckoutSession, Order
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from surprise_deals.services import expire_due_surprise_deal_reservations
from test_support import add_membership, create_business, create_user, seed_wallet


def _window():
    now = timezone.now()
    return now + timedelta(hours=1), now + timedelta(hours=3)


def _deal(*, business, quantity_total: int = 3, sale_price_amount: int = 9000) -> SurpriseDeal:
    start, end = _window()
    return SurpriseDeal.objects.create(
        business=business,
        title="Akşam sürpriz paketi",
        description="Gün sonu seçili ürünlerden oluşan paket.",
        original_value_amount=20000,
        sale_price_amount=sale_price_amount,
        quantity_total=quantity_total,
        quantity_remaining=quantity_total,
        quantity_reserved=0,
        pickup_window_start=start,
        pickup_window_end=end,
        status=SurpriseDeal.Status.ACTIVE,
        min_contents_note="En az 2 ürün",
    )


class SurpriseDealNotificationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username="surprise-notif-customer")
        self.owner = create_user(username="surprise-notif-owner")
        self.manager = create_user(username="surprise-notif-manager")
        self.cashier = create_user(username="surprise-notif-cashier")
        self.business = create_business(name="Komşu Fırın")
        add_membership(business=self.business, user=self.owner, role=BusinessMember.Role.OWNER)
        add_membership(business=self.business, user=self.manager, role=BusinessMember.Role.MANAGER)
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.deal = _deal(business=self.business)

    def _create_checkout(self, *, user=None, wallet_amount: int = 50000):
        user = user or self.customer
        seed_wallet(user=user, amount=wallet_amount)
        self.client.force_authenticate(user=user)
        response = self.client.post(f"/api/v1/surprise-deals/{self.deal.id}/checkout-session/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        session = CheckoutSession.objects.get(id=response.data["checkout_session"]["id"])
        reservation = SurpriseDealReservation.objects.get(id=response.data["reservation"]["id"])
        return response, session, reservation

    def _consume(self, *, session: CheckoutSession):
        self.client.force_authenticate(user=self.cashier)
        response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{session.token}/consume/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def test_checkout_session_created_enqueues_customer_reserved_notification(self):
        _, session, reservation = self._create_checkout()

        notification = Notification.objects.get(
            user=self.customer,
            type=Notification.Type.SURPRISE_DEAL_RESERVED,
        )
        self.assertEqual(notification.dedupe_key, f"surprise-deal-reserved:{reservation.id}")
        self.assertEqual(notification.payload["surprise_deal_id"], self.deal.id)
        self.assertEqual(notification.payload["reservation_id"], reservation.id)
        self.assertEqual(notification.payload["checkout_session_id"], session.id)
        self.assertEqual(notification.payload["business_id"], self.business.id)
        self.assertEqual(notification.payload["url"], f"/checkout/{session.token}")

    def test_consume_success_enqueues_customer_consumed_notification(self):
        _, session, _reservation = self._create_checkout()
        consume_response = self._consume(session=session)
        order = Order.objects.get(id=consume_response.data["order_id"])

        notification = Notification.objects.get(
            user=self.customer,
            type=Notification.Type.SURPRISE_DEAL_CONSUMED,
            payload__audience="CUSTOMER",
        )
        self.assertEqual(notification.payload["order_id"], order.id)
        self.assertEqual(notification.payload["checkout_session_id"], session.id)
        self.assertEqual(notification.dedupe_key, f"surprise-deal-consumed:customer:{order.id}")

    def test_consume_success_enqueues_business_owner_and_manager_notifications(self):
        _, session, _reservation = self._create_checkout()
        consume_response = self._consume(session=session)
        order_id = consume_response.data["order_id"]

        business_notifications = Notification.objects.filter(
            type=Notification.Type.SURPRISE_DEAL_CONSUMED,
            payload__audience="BUSINESS",
        ).order_by("user_id")

        self.assertEqual(business_notifications.count(), 2)
        self.assertEqual({notification.user_id for notification in business_notifications}, {self.owner.id, self.manager.id})
        self.assertEqual({notification.payload["order_id"] for notification in business_notifications}, {order_id})

    def test_expire_enqueues_customer_expired_notification(self):
        _, session, reservation = self._create_checkout()
        now = timezone.now()
        reserved_at = now - timedelta(minutes=10)
        expires_at = now - timedelta(minutes=5)
        SurpriseDealReservation.objects.filter(id=reservation.id).update(reserved_at=reserved_at, expires_at=expires_at)
        CheckoutSession.objects.filter(id=session.id).update(expires_at=expires_at)

        expired_count = expire_due_surprise_deal_reservations()

        self.assertEqual(expired_count, 1)
        notification = Notification.objects.get(
            user=self.customer,
            type=Notification.Type.SURPRISE_DEAL_EXPIRED,
        )
        self.assertEqual(notification.payload["reservation_id"], reservation.id)
        self.assertEqual(notification.payload["checkout_session_id"], session.id)
        self.assertEqual(notification.dedupe_key, f"surprise-deal-expired:{reservation.id}")

    def test_notification_enqueue_failure_does_not_break_consume_flow(self):
        _, session, _reservation = self._create_checkout()
        self.customer.wallet.refresh_from_db()
        wallet_before = self.customer.wallet.balance

        with patch("surprise_deals.notifications.NotificationService.enqueue", side_effect=RuntimeError("notification-down")):
            consume_response = self._consume(session=session)

        order = Order.objects.get(id=consume_response.data["order_id"])
        session.refresh_from_db()
        self.customer.wallet.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.Status.CONSUMED)
        self.assertEqual(order.status, Order.Status.USED)
        self.assertEqual(int(self.customer.wallet.balance), int(wallet_before) - int(self.deal.sale_price_amount))
