from __future__ import annotations

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from orders.models import CHECKOUT_SESSION_TTL_MINUTES, CheckoutSession
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from test_support import create_business, create_user, seed_wallet


def _window():
    now = timezone.now()
    return now + timedelta(hours=1), now + timedelta(hours=3)


def _deal(
    *,
    business,
    status: str = SurpriseDeal.Status.ACTIVE,
    quantity_total: int = 2,
    quantity_remaining: int | None = None,
    sale_price_amount: int = 9000,
    pickup_window_start=None,
    pickup_window_end=None,
) -> SurpriseDeal:
    start, end = _window()
    return SurpriseDeal.objects.create(
        business=business,
        title="Surpriz paket",
        description="Gun sonu secili urunlerden olusan paket.",
        original_value_amount=20000,
        sale_price_amount=sale_price_amount,
        quantity_total=quantity_total,
        quantity_remaining=quantity_total if quantity_remaining is None else quantity_remaining,
        quantity_reserved=0,
        pickup_window_start=pickup_window_start or start,
        pickup_window_end=pickup_window_end or end,
        status=status,
        min_contents_note="En az 2 urun",
    )


class SurpriseDealCheckoutSessionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_user(username="customer")
        self.other_user = create_user(username="other-customer")
        self.business = create_business(name="Komsu Firin")
        self.deal = _deal(business=self.business)

    def _auth(self, user=None):
        self.client.force_authenticate(user=user or self.user)

    def test_authenticated_user_creates_checkout_session_for_active_deal(self):
        seed_wallet(user=self.user, amount=20000)
        self._auth()

        response = self.client.post(f"/api/v1/surprise-deals/{self.deal.id}/checkout-session/", {}, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["total_amount"], self.deal.sale_price_amount)
        self.assertEqual(response.data["wallet_balance"], 20000)
        self.assertFalse(response.data["insufficient_balance"])

    def test_session_business_user_amount_and_expiry_are_correct(self):
        seed_wallet(user=self.user, amount=20000)
        self._auth()

        response = self.client.post(f"/api/v1/surprise-deals/{self.deal.id}/checkout-session/", {}, format="json")

        self.assertEqual(response.status_code, 201)
        session = CheckoutSession.objects.get(id=response.data["checkout_session"]["id"])
        self.assertEqual(session.user_id, self.user.id)
        self.assertEqual(session.business_id, self.business.id)
        self.assertIsNone(session.cart_id)
        self.assertEqual(session.source_type, CheckoutSession.SourceType.SURPRISE_DEAL)
        self.assertEqual(session.amount, self.deal.sale_price_amount)
        self.assertEqual(session.subtotal_amount, self.deal.sale_price_amount)
        self.assertEqual(session.customer_fee_amount, 0)
        self.assertEqual(session.business_net_amount, self.deal.sale_price_amount)
        self.assertLessEqual(session.expires_at, timezone.now() + timedelta(minutes=CHECKOUT_SESSION_TTL_MINUTES, seconds=5))
        self.assertLessEqual(session.expires_at, self.deal.pickup_window_end)
        self.assertEqual(session.cart_snapshot["source_type"], "SURPRISE_DEAL")
        self.assertEqual(session.cart_snapshot["surprise_deal_id"], self.deal.id)

    def test_reservation_is_created_and_bound_to_checkout_session(self):
        seed_wallet(user=self.user, amount=20000)
        self._auth()

        response = self.client.post(f"/api/v1/surprise-deals/{self.deal.id}/checkout-session/", {}, format="json")

        self.assertEqual(response.status_code, 201)
        reservation = SurpriseDealReservation.objects.get(id=response.data["reservation"]["id"])
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.RESERVED)
        self.assertEqual(reservation.checkout_session_id, response.data["checkout_session"]["id"])
        self.assertEqual(reservation.user_id, self.user.id)
        self.assertEqual(reservation.quantity, 1)

    def test_stock_is_reserved(self):
        seed_wallet(user=self.user, amount=20000)
        self._auth()

        response = self.client.post(f"/api/v1/surprise-deals/{self.deal.id}/checkout-session/", {}, format="json")

        self.assertEqual(response.status_code, 201)
        self.deal.refresh_from_db()
        self.assertEqual(self.deal.quantity_remaining, 1)
        self.assertEqual(self.deal.quantity_reserved, 1)

    def test_insufficient_wallet_does_not_create_session_or_reservation_or_change_stock(self):
        seed_wallet(user=self.user, amount=1000)
        self._auth()

        response = self.client.post(f"/api/v1/surprise-deals/{self.deal.id}/checkout-session/", {}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(CheckoutSession.objects.count(), 0)
        self.assertEqual(SurpriseDealReservation.objects.count(), 0)
        self.deal.refresh_from_db()
        self.assertEqual(self.deal.quantity_remaining, 2)
        self.assertEqual(self.deal.quantity_reserved, 0)

    def test_quantity_greater_than_one_is_rejected_in_v1(self):
        seed_wallet(user=self.user, amount=30000)
        self._auth()

        response = self.client.post(
            f"/api/v1/surprise-deals/{self.deal.id}/checkout-session/",
            {"quantity": 2},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(CheckoutSession.objects.count(), 0)
        self.assertEqual(SurpriseDealReservation.objects.count(), 0)

    def test_unavailable_deal_returns_404_or_400_without_reservation(self):
        seed_wallet(user=self.user, amount=20000)
        self._auth()
        closed = _deal(business=self.business, status=SurpriseDeal.Status.CLOSED, quantity_remaining=0)
        hidden_business = create_business(name="Gizli", is_listed=False)
        hidden = _deal(business=hidden_business)

        closed_response = self.client.post(f"/api/v1/surprise-deals/{closed.id}/checkout-session/", {}, format="json")
        hidden_response = self.client.post(f"/api/v1/surprise-deals/{hidden.id}/checkout-session/", {}, format="json")

        self.assertIn(closed_response.status_code, {400, 404})
        self.assertIn(hidden_response.status_code, {400, 404})
        self.assertEqual(SurpriseDealReservation.objects.count(), 0)

    def test_same_user_cannot_create_second_active_reservation_for_same_deal(self):
        seed_wallet(user=self.user, amount=30000)
        self._auth()

        first = self.client.post(f"/api/v1/surprise-deals/{self.deal.id}/checkout-session/", {}, format="json")
        second = self.client.post(f"/api/v1/surprise-deals/{self.deal.id}/checkout-session/", {}, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(SurpriseDealReservation.objects.filter(user=self.user, surprise_deal=self.deal).count(), 1)

    def test_other_user_cannot_take_last_stock_after_first_reservation(self):
        deal = _deal(business=self.business, quantity_total=1)
        seed_wallet(user=self.user, amount=20000)
        seed_wallet(user=self.other_user, amount=20000)

        self._auth(self.user)
        first = self.client.post(f"/api/v1/surprise-deals/{deal.id}/checkout-session/", {}, format="json")
        self._auth(self.other_user)
        second = self.client.post(f"/api/v1/surprise-deals/{deal.id}/checkout-session/", {}, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertIn(second.status_code, {400, 404})
        deal.refresh_from_db()
        self.assertEqual(deal.quantity_remaining, 0)
        self.assertEqual(deal.quantity_reserved, 1)
