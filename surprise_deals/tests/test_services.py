from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from businesses.models import BusinessProfile
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from surprise_deals.services import (
    commit_surprise_deal_reservation,
    expire_due_surprise_deal_reservations,
    release_surprise_deal_reservation,
    reserve_surprise_deal,
)


class SurpriseDealServiceTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="surprise-customer", password="pass")
        self.business = BusinessProfile.objects.create(
            business_name="Son Dakika Lokanta",
            category="Döner",
            adress="Beylikdüzü",
            is_active=True,
            is_approved=True,
            is_listed=True,
            marketplace_is_visible=True,
        )

    def _deal(self, **overrides):
        now = timezone.now()
        data = {
            "business": self.business,
            "title": "Sürpriz Paket",
            "description": "Gün sonu fırsatı.",
            "original_value_amount": 20000,
            "sale_price_amount": 9000,
            "quantity_total": 3,
            "quantity_remaining": 3,
            "quantity_reserved": 0,
            "pickup_window_start": now + timedelta(minutes=30),
            "pickup_window_end": now + timedelta(hours=2),
            "status": SurpriseDeal.Status.ACTIVE,
            "min_contents_note": "En az bir ana ürün.",
            "created_by": self.user,
        }
        data.update(overrides)
        return SurpriseDeal.objects.create(**data)

    def test_active_deal_reserve_successfully(self):
        deal = self._deal()

        reservation = reserve_surprise_deal(deal_id=deal.id, user=self.user)

        self.assertEqual(reservation.status, SurpriseDealReservation.Status.RESERVED)
        self.assertEqual(reservation.quantity, 1)
        self.assertIsNone(reservation.checkout_session_id)

    def test_reserve_decrements_remaining_and_increments_reserved(self):
        deal = self._deal(quantity_total=5, quantity_remaining=5, quantity_reserved=0)

        reserve_surprise_deal(deal_id=deal.id, user=self.user, quantity=2)
        deal.refresh_from_db()

        self.assertEqual(deal.quantity_remaining, 3)
        self.assertEqual(deal.quantity_reserved, 2)

    def test_reserve_fails_when_stock_is_insufficient(self):
        deal = self._deal(quantity_total=1, quantity_remaining=1)

        with self.assertRaises(ValidationError):
            reserve_surprise_deal(deal_id=deal.id, user=self.user, quantity=2)

        deal.refresh_from_db()
        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 0)

    def test_non_active_deals_cannot_be_reserved(self):
        paused = self._deal(status=SurpriseDeal.Status.PAUSED)
        closed = self._deal(status=SurpriseDeal.Status.CLOSED)

        with self.assertRaises(ValidationError):
            reserve_surprise_deal(deal_id=paused.id, user=self.user)
        with self.assertRaises(ValidationError):
            reserve_surprise_deal(deal_id=closed.id, user=self.user)

    def test_expired_pickup_window_cannot_be_reserved(self):
        deal = self._deal(status=SurpriseDeal.Status.DRAFT)
        SurpriseDeal.objects.filter(pk=deal.pk).update(
            status=SurpriseDeal.Status.ACTIVE,
            pickup_window_start=timezone.now() - timedelta(hours=2),
            pickup_window_end=timezone.now() - timedelta(minutes=1),
        )

        with self.assertRaises(ValidationError):
            reserve_surprise_deal(deal_id=deal.id, user=self.user)

    def test_release_reserved_reservation_returns_stock(self):
        deal = self._deal(quantity_total=2, quantity_remaining=2)
        reservation = reserve_surprise_deal(deal_id=deal.id, user=self.user)

        released = release_surprise_deal_reservation(reservation_id=reservation.id)
        deal.refresh_from_db()

        self.assertEqual(released.status, SurpriseDealReservation.Status.RELEASED)
        self.assertEqual(deal.quantity_remaining, 2)
        self.assertEqual(deal.quantity_reserved, 0)

    def test_commit_reserved_reservation_decrements_reserved_without_returning_remaining(self):
        deal = self._deal(quantity_total=2, quantity_remaining=2)
        reservation = reserve_surprise_deal(deal_id=deal.id, user=self.user)

        committed = commit_surprise_deal_reservation(reservation_id=reservation.id)
        deal.refresh_from_db()

        self.assertEqual(committed.status, SurpriseDealReservation.Status.COMMITTED)
        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 0)

    def test_committed_reservation_release_is_idempotent_and_does_not_change_stock(self):
        deal = self._deal(quantity_total=2, quantity_remaining=2)
        reservation = reserve_surprise_deal(deal_id=deal.id, user=self.user)
        committed = commit_surprise_deal_reservation(reservation_id=reservation.id)

        released = release_surprise_deal_reservation(reservation_id=committed.id)
        deal.refresh_from_db()

        self.assertEqual(released.status, SurpriseDealReservation.Status.COMMITTED)
        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 0)

    def test_last_stock_reservation_closes_deal_and_release_reopens_it(self):
        deal = self._deal(quantity_total=1, quantity_remaining=1)

        reservation = reserve_surprise_deal(deal_id=deal.id, user=self.user)
        deal.refresh_from_db()

        self.assertEqual(deal.quantity_remaining, 0)
        self.assertEqual(deal.quantity_reserved, 1)
        self.assertEqual(deal.status, SurpriseDeal.Status.CLOSED)

        release_surprise_deal_reservation(reservation_id=reservation.id)
        deal.refresh_from_db()

        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 0)
        self.assertEqual(deal.status, SurpriseDeal.Status.ACTIVE)

    def test_serial_last_stock_attempt_does_not_make_stock_negative(self):
        deal = self._deal(quantity_total=1, quantity_remaining=1)

        reserve_surprise_deal(deal_id=deal.id, user=self.user)
        with self.assertRaises(ValidationError):
            reserve_surprise_deal(deal_id=deal.id, user=self.user)

        deal.refresh_from_db()
        self.assertEqual(deal.quantity_remaining, 0)
        self.assertEqual(deal.quantity_reserved, 1)

    def test_expire_due_reservations_marks_expired_and_returns_stock(self):
        deal = self._deal(quantity_total=2, quantity_remaining=2)
        reservation = reserve_surprise_deal(
            deal_id=deal.id,
            user=self.user,
            expires_at=timezone.now() + timedelta(minutes=1),
        )
        now = timezone.now()
        SurpriseDealReservation.objects.filter(pk=reservation.pk).update(
            reserved_at=now - timedelta(minutes=2),
            expires_at=now - timedelta(minutes=1),
        )

        expired_count = expire_due_surprise_deal_reservations(limit=10)
        reservation.refresh_from_db()
        deal.refresh_from_db()

        self.assertEqual(expired_count, 1)
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.EXPIRED)
        self.assertEqual(deal.quantity_remaining, 2)
        self.assertEqual(deal.quantity_reserved, 0)
