from __future__ import annotations

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from businesses.models import BusinessMember, BusinessProfile
from orders.models import CheckoutSession, Order
from payouts.models import BusinessEarning
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from test_support import add_membership, create_business, create_user, seed_wallet


class OpsSurpriseDealApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_user(username=f"ops-sdeal-admin-{self._testMethodName}", role=User.Role.ADMIN, is_staff=True)
        self.customer = create_user(username=f"ops-sdeal-customer-{self._testMethodName}")
        self.owner = create_user(username=f"ops-sdeal-owner-{self._testMethodName}")
        self.cashier = create_user(username=f"ops-sdeal-cashier-{self._testMethodName}")
        self.business = create_business(name=f"Ops Surprise Biz {self._testMethodName}", district=BusinessProfile.District.BEYLIKDUZU)
        self.other_business = create_business(name=f"Other Surprise Biz {self._testMethodName}", district=BusinessProfile.District.BEYLIKDUZU)
        add_membership(business=self.business, user=self.owner, role=BusinessMember.Role.OWNER)
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)

    def _window(self, *, offset_hours: int = 1):
        now = timezone.now()
        return now + timedelta(hours=offset_hours), now + timedelta(hours=offset_hours + 2)

    def _deal(
        self,
        *,
        business=None,
        title: str = "Ops Sürpriz Paketi",
        status: str = SurpriseDeal.Status.ACTIVE,
        quantity_total: int = 3,
        quantity_remaining: int | None = None,
        quantity_reserved: int = 0,
    ) -> SurpriseDeal:
        start, end = self._window()
        return SurpriseDeal.objects.create(
            business=business or self.business,
            title=title,
            description="Ops kontrol paketi.",
            original_value_amount=20000,
            sale_price_amount=9000,
            quantity_total=quantity_total,
            quantity_remaining=quantity_total if quantity_remaining is None else quantity_remaining,
            quantity_reserved=quantity_reserved,
            pickup_window_start=start,
            pickup_window_end=end,
            status=status,
            min_contents_note="En az 2 ürün",
            published_at=timezone.now() if status == SurpriseDeal.Status.ACTIVE else None,
        )

    def _create_reserved_checkout(self, *, deal: SurpriseDeal) -> tuple[CheckoutSession, SurpriseDealReservation]:
        seed_wallet(user=self.customer, amount=50000)
        self.client.force_authenticate(self.customer)
        response = self.client.post(f"/api/v1/surprise-deals/{deal.id}/checkout-session/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return (
            CheckoutSession.objects.get(id=response.data["checkout_session"]["id"]),
            SurpriseDealReservation.objects.get(id=response.data["reservation"]["id"]),
        )

    def _consume(self, *, session: CheckoutSession):
        self.client.force_authenticate(self.cashier)
        return self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{session.token}/consume/",
            {},
            format="json",
        )

    def test_non_admin_cannot_access_ops_surprise_deal_list(self):
        self._deal()
        self.client.force_authenticate(self.customer)

        response = self.client.get("/api/v1/ops/surprise-deals/")

        self.assertEqual(response.status_code, 403)

    def test_admin_can_list_and_filter_surprise_deals(self):
        active = self._deal(title="Beylikdüzü aktif paket")
        self._deal(business=self.other_business, title="Esenyurt paket", status=SurpriseDeal.Status.PAUSED)

        self.client.force_authenticate(self.admin)
        response = self.client.get(
            "/api/v1/ops/surprise-deals/",
            {"status": SurpriseDeal.Status.ACTIVE, "district": BusinessProfile.District.BEYLIKDUZU, "has_remaining": "true"},
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["ok"], True)
        self.assertEqual(response.data["data"]["count"], 1)
        row = response.data["data"]["results"][0]
        self.assertEqual(row["id"], active.id)
        self.assertEqual(row["business_name"], self.business.business_name)
        self.assertEqual(row["district"], BusinessProfile.District.BEYLIKDUZU)
        self.assertEqual(row["reservation_count"], 0)

    def test_ops_detail_returns_reservation_summary_and_related_order(self):
        deal = self._deal()
        session, reservation = self._create_reserved_checkout(deal=deal)
        consume_response = self._consume(session=session)
        self.assertEqual(consume_response.status_code, 200, consume_response.data)
        order = Order.objects.get(id=consume_response.data["order_id"])

        self.client.force_authenticate(self.admin)
        response = self.client.get(f"/api/v1/ops/surprise-deals/{deal.id}/")

        self.assertEqual(response.status_code, 200, response.data)
        data = response.data["data"]
        self.assertEqual(data["deal"]["id"], deal.id)
        self.assertEqual(data["reservation_summary"]["committed"], 1)
        self.assertEqual(data["recent_reservations"][0]["id"], reservation.id)
        self.assertEqual(data["recent_reservations"][0]["order_id"], order.id)
        self.assertEqual(data["recent_orders"][0]["id"], order.id)

    def test_ops_close_surprise_deal(self):
        deal = self._deal(status=SurpriseDeal.Status.PAUSED, quantity_remaining=3)

        self.client.force_authenticate(self.admin)
        response = self.client.post(f"/api/v1/ops/surprise-deals/{deal.id}/close/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        deal.refresh_from_db()
        self.assertEqual(deal.status, SurpriseDeal.Status.CLOSED)
        self.assertIsNotNone(deal.closed_at)
        self.assertEqual(response.data["data"]["status"], SurpriseDeal.Status.CLOSED)

    def test_ops_close_is_blocked_when_active_reservation_exists(self):
        deal = self._deal()
        self._create_reserved_checkout(deal=deal)

        self.client.force_authenticate(self.admin)
        response = self.client.post(f"/api/v1/ops/surprise-deals/{deal.id}/close/", {}, format="json")

        self.assertEqual(response.status_code, 400)
        deal.refresh_from_db()
        self.assertEqual(deal.status, SurpriseDeal.Status.ACTIVE)
        self.assertEqual(BusinessEarning.objects.count(), 0)
