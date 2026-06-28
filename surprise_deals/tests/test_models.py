from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from businesses.models import BusinessProfile
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation


class SurpriseDealModelTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="surprise-user", password="pass")
        self.business = BusinessProfile.objects.create(
            business_name="Surprise Lokanta",
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
            "title": "Günün Sürpriz Paketi",
            "description": "Gün sonu sınırlı paket.",
            "original_value_amount": 20000,
            "sale_price_amount": 9000,
            "quantity_total": 5,
            "quantity_remaining": 5,
            "quantity_reserved": 0,
            "pickup_window_start": now + timedelta(hours=1),
            "pickup_window_end": now + timedelta(hours=3),
            "status": SurpriseDeal.Status.DRAFT,
            "min_contents_note": "En az bir ana ürün içerir.",
            "created_by": self.user,
        }
        data.update(overrides)
        return SurpriseDeal(**data)

    def test_surprise_deal_can_be_created(self):
        deal = self._deal(status=SurpriseDeal.Status.ACTIVE)
        deal.save()

        self.assertEqual(deal.currency, "TRY")
        self.assertEqual(deal.quantity_remaining, 5)
        self.assertFalse(deal.is_sold_out)

    def test_sale_price_must_be_positive(self):
        deal = self._deal(sale_price_amount=0)

        with self.assertRaises(ValidationError):
            deal.full_clean()

    def test_original_value_cannot_be_below_sale_price(self):
        deal = self._deal(original_value_amount=8000, sale_price_amount=9000)

        with self.assertRaises(ValidationError):
            deal.full_clean()

    def test_pickup_window_end_must_be_after_start(self):
        start = timezone.now() + timedelta(hours=2)
        deal = self._deal(pickup_window_start=start, pickup_window_end=start)

        with self.assertRaises(ValidationError):
            deal.full_clean()

    def test_active_deal_requires_remaining_quantity_and_future_end(self):
        sold_out = self._deal(status=SurpriseDeal.Status.ACTIVE, quantity_remaining=0)
        expired = self._deal(
            status=SurpriseDeal.Status.ACTIVE,
            pickup_window_start=timezone.now() - timedelta(hours=3),
            pickup_window_end=timezone.now() - timedelta(hours=1),
        )

        with self.assertRaises(ValidationError):
            sold_out.full_clean()
        with self.assertRaises(ValidationError):
            expired.full_clean()

    def test_reservation_can_be_created_without_checkout_session_initially(self):
        deal = self._deal(status=SurpriseDeal.Status.ACTIVE)
        deal.save()

        reservation = SurpriseDealReservation.objects.create(
            surprise_deal=deal,
            user=self.user,
            quantity=1,
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        self.assertEqual(reservation.status, SurpriseDealReservation.Status.RESERVED)
        self.assertIsNone(reservation.checkout_session_id)

    def test_reservation_quantity_must_be_positive(self):
        deal = self._deal(status=SurpriseDeal.Status.ACTIVE)
        deal.save()
        reservation = SurpriseDealReservation(
            surprise_deal=deal,
            user=self.user,
            quantity=0,
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        with self.assertRaises(ValidationError):
            reservation.full_clean()
