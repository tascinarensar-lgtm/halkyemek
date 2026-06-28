from __future__ import annotations

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from surprise_deals.services import reserve_surprise_deal
from test_support import add_membership, create_business, create_user


def _window():
    now = timezone.now()
    return now + timedelta(hours=1), now + timedelta(hours=3)


def _deal(
    *,
    business,
    title: str = "Aksam surpriz paketi",
    status: str = SurpriseDeal.Status.ACTIVE,
    quantity_total: int = 3,
    quantity_remaining: int | None = None,
    pickup_window_start=None,
    pickup_window_end=None,
    **extra,
) -> SurpriseDeal:
    start, end = _window()
    return SurpriseDeal.objects.create(
        business=business,
        title=title,
        description="Gun sonu secili urunlerden olusan paket.",
        original_value_amount=20000,
        sale_price_amount=9000,
        quantity_total=quantity_total,
        quantity_remaining=quantity_total if quantity_remaining is None else quantity_remaining,
        quantity_reserved=0,
        pickup_window_start=pickup_window_start or start,
        pickup_window_end=pickup_window_end or end,
        status=status,
        min_contents_note="En az 2 urun",
        **extra,
    )


class SurpriseDealPublicApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.business = create_business(name="Komsu Firin")

    def test_public_list_only_returns_active_future_stocked_public_business_deals(self):
        visible = _deal(business=self.business, title="Gorunen paket")
        _deal(business=self.business, title="Taslak paket", status=SurpriseDeal.Status.DRAFT)
        _deal(business=self.business, title="Kapali paket", status=SurpriseDeal.Status.CLOSED, quantity_remaining=0)
        hidden_business = create_business(name="Gizli Isletme", is_listed=False)
        _deal(business=hidden_business, title="Gizli paket")
        inactive_business = create_business(name="Pasif Isletme", is_active=False)
        _deal(business=inactive_business, title="Pasif paket")
        other_business = create_business(name="Baska Isletme")
        _deal(business=other_business, title="Baska paket")

        response = self.client.get("/api/v1/surprise-deals/")

        self.assertEqual(response.status_code, 200)
        ids = [row["id"] for row in response.data["results"]]
        self.assertIn(visible.id, ids)
        self.assertEqual(len(ids), 2)

    def test_public_list_filters_by_business(self):
        visible = _deal(business=self.business, title="Bizim paket")
        other_business = create_business(name="Diger")
        _deal(business=other_business, title="Diger paket")

        response = self.client.get(f"/api/v1/surprise-deals/?business={self.business.id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.data["results"]], [visible.id])

    def test_public_detail_returns_404_for_closed_or_past_deal(self):
        closed = _deal(business=self.business, status=SurpriseDeal.Status.CLOSED, quantity_remaining=0)
        past_start = timezone.now() - timedelta(hours=3)
        past_end = timezone.now() - timedelta(hours=1)
        past = _deal(
            business=self.business,
            status=SurpriseDeal.Status.DRAFT,
            pickup_window_start=past_start,
            pickup_window_end=past_end,
        )
        SurpriseDeal.objects.filter(id=past.id).update(status=SurpriseDeal.Status.ACTIVE)

        closed_response = self.client.get(f"/api/v1/surprise-deals/{closed.id}/")
        past_response = self.client.get(f"/api/v1/surprise-deals/{past.id}/")

        self.assertEqual(closed_response.status_code, 404)
        self.assertEqual(past_response.status_code, 404)


class SurpriseDealBusinessApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = create_user(username="owner")
        self.other_owner = create_user(username="other-owner")
        self.customer = create_user(username="customer")
        self.business = create_business(contact_user=self.owner, name="Komsu Mutfagi")
        self.other_business = create_business(contact_user=self.other_owner, name="Baska Mutfak")
        membership = add_membership(business=self.business, user=self.owner, role=BusinessMember.Role.OWNER)
        membership.access_halktasarruf = True
        membership.save(update_fields=["access_halktasarruf"])
        other_membership = add_membership(business=self.other_business, user=self.other_owner, role=BusinessMember.Role.OWNER)
        other_membership.access_halktasarruf = True
        other_membership.save(update_fields=["access_halktasarruf"])
        self.business.supports_halktasarruf = True
        self.business.save(update_fields=["supports_halktasarruf"])
        self.other_business.supports_halktasarruf = True
        self.other_business.save(update_fields=["supports_halktasarruf"])

    def _payload(self, **overrides):
        start, end = _window()
        payload = {
            "title": "Aksam surpriz paketi",
            "description": "Gun sonu secili urunler.",
            "original_value_amount": 25000,
            "sale_price_amount": 12000,
            "quantity_total": 5,
            "pickup_window_start": start.isoformat(),
            "pickup_window_end": end.isoformat(),
            "min_contents_note": "En az 2 urun",
            "allergens_note": "",
        }
        payload.update(overrides)
        return payload

    def test_business_list_requires_authorization(self):
        response = self.client.get(f"/api/v1/businesses/{self.business.id}/surprise-deals/")
        self.assertIn(response.status_code, {401, 403})

        self.client.force_authenticate(user=self.customer)
        response = self.client.get(f"/api/v1/businesses/{self.business.id}/surprise-deals/")
        self.assertEqual(response.status_code, 403)

    def test_halktasarruf_access_flag_is_required_for_business_member(self):
        membership = BusinessMember.objects.get(business=self.business, user=self.owner)
        membership.access_halktasarruf = False
        membership.save(update_fields=["access_halktasarruf"])

        self.client.force_authenticate(user=self.owner)
        response = self.client.get(f"/api/v1/businesses/{self.business.id}/surprise-deals/")

        self.assertEqual(response.status_code, 403)

    def test_business_member_can_create_deal(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/surprise-deals/",
            self._payload(),
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        deal = SurpriseDeal.objects.get(id=response.data["id"])
        self.assertEqual(deal.business_id, self.business.id)
        self.assertEqual(deal.created_by_id, self.owner.id)
        self.assertEqual(deal.quantity_remaining, 5)
        self.assertEqual(deal.quantity_reserved, 0)

    def test_create_ignores_body_business_and_uses_path_business(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/surprise-deals/",
            self._payload(business=self.other_business.id),
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(SurpriseDeal.objects.get(id=response.data["id"]).business_id, self.business.id)

    def test_active_create_sets_published_at(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/surprise-deals/",
            self._payload(status=SurpriseDeal.Status.ACTIVE),
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        deal = SurpriseDeal.objects.get(id=response.data["id"])
        self.assertEqual(deal.status, SurpriseDeal.Status.ACTIVE)
        self.assertIsNotNone(deal.published_at)

    def test_active_create_with_zero_stock_is_validation_error(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/surprise-deals/",
            self._payload(status=SurpriseDeal.Status.ACTIVE, quantity_total=0),
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_patch_status_paused_and_closed(self):
        self.client.force_authenticate(user=self.owner)
        deal = _deal(business=self.business, status=SurpriseDeal.Status.ACTIVE)

        paused = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/surprise-deals/{deal.id}/",
            {"status": SurpriseDeal.Status.PAUSED},
            format="json",
        )
        closed = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/surprise-deals/{deal.id}/",
            {"status": SurpriseDeal.Status.CLOSED},
            format="json",
        )

        self.assertEqual(paused.status_code, 200)
        self.assertEqual(closed.status_code, 200)
        deal.refresh_from_db()
        self.assertEqual(deal.status, SurpriseDeal.Status.CLOSED)
        self.assertIsNotNone(deal.closed_at)

    def test_close_is_blocked_when_active_reservation_exists(self):
        self.client.force_authenticate(user=self.owner)
        deal = _deal(business=self.business, quantity_total=2)
        reservation = reserve_surprise_deal(deal_id=deal.id, user=self.customer, quantity=1)

        response = self.client.post(f"/api/v1/businesses/{self.business.id}/surprise-deals/{deal.id}/close/")

        self.assertEqual(response.status_code, 400)
        reservation.refresh_from_db()
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.RESERVED)

    def test_active_reservation_blocks_critical_patch_fields(self):
        self.client.force_authenticate(user=self.owner)
        deal = _deal(business=self.business, quantity_total=2)
        reserve_surprise_deal(deal_id=deal.id, user=self.customer, quantity=1)

        response = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/surprise-deals/{deal.id}/",
            {"quantity_total": 4},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        deal.refresh_from_db()
        self.assertEqual(deal.quantity_total, 2)
        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 1)

    def test_quantity_total_patch_preserves_used_quantity_with_delta(self):
        self.client.force_authenticate(user=self.owner)
        deal = _deal(business=self.business, quantity_total=5, quantity_remaining=3)

        response = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/surprise-deals/{deal.id}/",
            {"quantity_total": 7},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        deal.refresh_from_db()
        self.assertEqual(deal.quantity_total, 7)
        self.assertEqual(deal.quantity_remaining, 5)

    def test_other_business_member_cannot_update_deal(self):
        self.client.force_authenticate(user=self.owner)
        other_deal = _deal(business=self.other_business)

        response = self.client.patch(
            f"/api/v1/businesses/{self.other_business.id}/surprise-deals/{other_deal.id}/",
            {"status": SurpriseDeal.Status.PAUSED},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_delete_allows_clean_draft_without_reservations(self):
        self.client.force_authenticate(user=self.owner)
        deal = _deal(business=self.business, status=SurpriseDeal.Status.DRAFT)

        response = self.client.delete(f"/api/v1/businesses/{self.business.id}/surprise-deals/{deal.id}/")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(SurpriseDeal.objects.filter(id=deal.id).exists())

    def test_delete_is_blocked_when_reservation_history_exists(self):
        self.client.force_authenticate(user=self.owner)
        deal = _deal(business=self.business, quantity_total=2)
        reserve_surprise_deal(deal_id=deal.id, user=self.customer, quantity=1)

        response = self.client.delete(f"/api/v1/businesses/{self.business.id}/surprise-deals/{deal.id}/")

        self.assertEqual(response.status_code, 400)
        self.assertTrue(SurpriseDeal.objects.filter(id=deal.id).exists())
