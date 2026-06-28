from __future__ import annotations

from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from orders.models import CheckoutSession
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from surprise_deals.services import commit_surprise_deal_reservation, expire_due_surprise_deal_reservations
from surprise_deals.services_checkout import create_surprise_deal_checkout_session
from test_support import create_business, create_user, seed_wallet


def _window():
    now = timezone.now()
    return now + timedelta(hours=1), now + timedelta(hours=3)


def _deal(*, business, quantity_total: int = 2) -> SurpriseDeal:
    start, end = _window()
    return SurpriseDeal.objects.create(
        business=business,
        title="Expire test paketi",
        description="Gun sonu secili urunlerden olusan paket.",
        original_value_amount=20000,
        sale_price_amount=9000,
        quantity_total=quantity_total,
        quantity_remaining=quantity_total,
        quantity_reserved=0,
        pickup_window_start=start,
        pickup_window_end=end,
        status=SurpriseDeal.Status.ACTIVE,
        min_contents_note="En az 2 urun",
    )


class SurpriseDealExpiryCommandTests(TestCase):
    def setUp(self):
        self.user = create_user(username=f"expire-user-{self._testMethodName}")
        self.business = create_business(name=f"Expire Biz {self._testMethodName}")
        seed_wallet(user=self.user, amount=100000)

    def _checkout_with_due_reservation(self):
        deal = _deal(business=self.business)
        result = create_surprise_deal_checkout_session(user=self.user, deal_id=deal.id, quantity=1)
        due_at = timezone.now() - timedelta(minutes=1)
        reserved_at = due_at - timedelta(minutes=10)
        CheckoutSession.objects.filter(id=result.session.id).update(expires_at=due_at)
        SurpriseDealReservation.objects.filter(id=result.reservation.id).update(
            reserved_at=reserved_at,
            expires_at=due_at,
        )
        return deal, result.session, result.reservation

    def test_due_reserved_reservation_expires_and_stock_returns(self):
        deal, session, reservation = self._checkout_with_due_reservation()

        expired_count = expire_due_surprise_deal_reservations()

        self.assertEqual(expired_count, 1)
        reservation.refresh_from_db()
        deal.refresh_from_db()
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.EXPIRED)
        self.assertEqual(deal.quantity_remaining, 2)
        self.assertEqual(deal.quantity_reserved, 0)

    def test_linked_pending_checkout_session_is_marked_expired(self):
        _deal, session, _reservation = self._checkout_with_due_reservation()

        expired_count = expire_due_surprise_deal_reservations()

        self.assertEqual(expired_count, 1)
        session.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.Status.EXPIRED)

    def test_consumed_session_linked_reserved_reservation_is_not_touched(self):
        deal, session, reservation = self._checkout_with_due_reservation()
        CheckoutSession.objects.filter(id=session.id).update(
            status=CheckoutSession.Status.CONSUMED,
            consumed_at=timezone.now(),
        )

        expired_count = expire_due_surprise_deal_reservations()

        self.assertEqual(expired_count, 0)
        reservation.refresh_from_db()
        deal.refresh_from_db()
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.RESERVED)
        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 1)

    def test_committed_reservation_is_not_touched(self):
        deal, session, reservation = self._checkout_with_due_reservation()
        commit_surprise_deal_reservation(reservation_id=reservation.id)
        SurpriseDealReservation.objects.filter(id=reservation.id).update(expires_at=timezone.now() - timedelta(minutes=1))

        expired_count = expire_due_surprise_deal_reservations()

        self.assertEqual(expired_count, 0)
        reservation.refresh_from_db()
        session.refresh_from_db()
        deal.refresh_from_db()
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.COMMITTED)
        self.assertEqual(session.status, CheckoutSession.Status.PENDING)
        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 0)

    def test_dry_run_does_not_change_database(self):
        deal, session, reservation = self._checkout_with_due_reservation()
        out = StringIO()

        call_command("expire_surprise_deal_reservations", "--dry-run", stdout=out)

        self.assertIn("expired_count=1", out.getvalue())
        self.assertIn("dry_run=true", out.getvalue())
        reservation.refresh_from_db()
        session.refresh_from_db()
        deal.refresh_from_db()
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.RESERVED)
        self.assertEqual(session.status, CheckoutSession.Status.PENDING)
        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 1)

    def test_command_is_idempotent_and_does_not_inflate_stock(self):
        deal, _session, _reservation = self._checkout_with_due_reservation()
        out_first = StringIO()
        out_second = StringIO()

        call_command("expire_surprise_deal_reservations", stdout=out_first)
        call_command("expire_surprise_deal_reservations", stdout=out_second)

        deal.refresh_from_db()
        self.assertIn("expired_count=1", out_first.getvalue())
        self.assertIn("expired_count=0", out_second.getvalue())
        self.assertEqual(deal.quantity_remaining, 2)
        self.assertEqual(deal.quantity_reserved, 0)
