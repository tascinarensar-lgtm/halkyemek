from __future__ import annotations

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from orders.api.serializers import OrderSerializer
from orders.models import CheckoutSession, Order, OrderItem
from payouts.models import BusinessEarning
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from surprise_deals.services import expire_due_surprise_deal_reservations
from test_support import add_membership, create_business, create_user, seed_wallet
from wallets.models import Wallet, WalletTransaction


class SurpriseDealSmokeFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = create_user(username=f"surprise-smoke-owner-{self._testMethodName}")
        self.cashier = create_user(username=f"surprise-smoke-cashier-{self._testMethodName}")
        self.customer = create_user(username=f"surprise-smoke-customer-{self._testMethodName}")
        self.business = create_business(name=f"Surprise Smoke Biz {self._testMethodName}")
        self.business.supports_halktasarruf = True
        self.business.save(update_fields=["supports_halktasarruf"])
        owner_membership = add_membership(business=self.business, user=self.owner, role=BusinessMember.Role.OWNER)
        owner_membership.access_halktasarruf = True
        owner_membership.save(update_fields=["access_halktasarruf"])
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)

    def _window(self):
        now = timezone.now()
        return now + timedelta(hours=1), now + timedelta(hours=3)

    def _create_active_deal_via_business_api(
        self,
        *,
        quantity_total: int = 2,
        sale_price_amount: int = 9000,
        original_value_amount: int = 20000,
    ) -> SurpriseDeal:
        start, end = self._window()
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/surprise-deals/",
            {
                "title": "Smoke Sürpriz Paketi",
                "description": "Gün sonu seçili ürünlerden oluşan smoke paketi.",
                "original_value_amount": original_value_amount,
                "sale_price_amount": sale_price_amount,
                "quantity_total": quantity_total,
                "pickup_window_start": start.isoformat(),
                "pickup_window_end": end.isoformat(),
                "min_contents_note": "En az 2 ürün",
                "allergens_note": "Alerjen bilgisi işletmeden teyit edilir.",
                "status": SurpriseDeal.Status.ACTIVE,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], SurpriseDeal.Status.ACTIVE)
        self.assertEqual(response.data["quantity_remaining"], quantity_total)
        self.assertEqual(response.data["quantity_reserved"], 0)
        self.assertIsNotNone(response.data["published_at"])
        return SurpriseDeal.objects.get(id=response.data["id"])

    def _create_checkout(self, *, deal: SurpriseDeal, user=None):
        self.client.force_authenticate(user or self.customer)
        return self.client.post(
            f"/api/v1/surprise-deals/{deal.id}/checkout-session/",
            {},
            format="json",
        )

    def _consume(self, *, token: str):
        self.client.force_authenticate(self.cashier)
        return self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )

    def test_smoke_successful_surprise_deal_checkout_consume_and_order_history_flow(self):
        seed_wallet(user=self.customer, amount=50000)
        deal = self._create_active_deal_via_business_api()

        public_response = self.client.get("/api/v1/surprise-deals/")
        self.assertEqual(public_response.status_code, 200)
        public_ids = {row["id"] for row in public_response.data["results"]}
        self.assertIn(deal.id, public_ids)

        wallet_before = Wallet.objects.get(user=self.customer).balance
        checkout_response = self._create_checkout(deal=deal)
        self.assertEqual(checkout_response.status_code, 201, checkout_response.data)

        session = CheckoutSession.objects.get(id=checkout_response.data["checkout_session"]["id"])
        reservation = SurpriseDealReservation.objects.get(id=checkout_response.data["reservation"]["id"])
        deal.refresh_from_db()
        self.assertEqual(session.source_type, CheckoutSession.SourceType.SURPRISE_DEAL)
        self.assertEqual(session.status, CheckoutSession.Status.PENDING)
        self.assertEqual(session.amount, deal.sale_price_amount)
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.RESERVED)
        self.assertEqual(reservation.checkout_session_id, session.id)
        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 1)

        self.client.force_authenticate(self.cashier)
        preview_response = self.client.get(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{session.token}/preview/"
        )
        self.assertEqual(preview_response.status_code, 200, preview_response.data)
        self.assertTrue(preview_response.data["can_consume"])
        self.assertEqual(preview_response.data["items"][0]["source_type"], "SURPRISE_DEAL")

        consume_response = self._consume(token=session.token)
        self.assertEqual(consume_response.status_code, 200, consume_response.data)

        session.refresh_from_db()
        reservation.refresh_from_db()
        deal.refresh_from_db()
        wallet_after = Wallet.objects.get(user=self.customer).balance
        order = Order.objects.get(id=consume_response.data["order_id"])
        order_item = OrderItem.objects.get(order=order)
        earning = BusinessEarning.objects.get(order=order)
        purchase_tx = WalletTransaction.objects.get(order=order, transaction_type=WalletTransaction.Type.PURCHASE)

        self.assertEqual(session.status, CheckoutSession.Status.CONSUMED)
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.COMMITTED)
        self.assertEqual(deal.quantity_remaining, 1)
        self.assertEqual(deal.quantity_reserved, 0)
        self.assertEqual(wallet_after, wallet_before - deal.sale_price_amount)
        self.assertEqual(order.status, Order.Status.USED)
        self.assertEqual(order.amount, deal.sale_price_amount)
        self.assertEqual(order.checkout_session_id, session.id)
        self.assertEqual(order_item.menu_item_id, None)
        self.assertEqual(order_item.menu_item_snapshot["source_type"], "SURPRISE_DEAL")
        self.assertEqual(order_item.menu_item_snapshot["surprise_deal_id"], deal.id)
        self.assertEqual(order_item.menu_item_snapshot["title"], deal.title)
        self.assertEqual(earning.business_id, self.business.id)
        self.assertEqual(earning.gross_amount, deal.sale_price_amount)
        self.assertEqual(purchase_tx.amount, -deal.sale_price_amount)

        self.client.force_authenticate(self.customer)
        orders_response = self.client.get("/api/v1/orders/")
        self.assertEqual(orders_response.status_code, 200, orders_response.data)
        serialized_order = orders_response.data["results"][0]
        serialized_item = serialized_order["order_items"][0]
        self.assertEqual(serialized_order["source"]["source_type"], CheckoutSession.SourceType.SURPRISE_DEAL)
        self.assertEqual(serialized_item["item_type"], "SURPRISE_DEAL")
        self.assertEqual(serialized_item["display_name"], deal.title)
        self.assertEqual(serialized_item["surprise_deal_id"], deal.id)
        self.assertEqual(serialized_item["original_value_amount"], deal.original_value_amount)
        self.assertEqual(serialized_item["pickup_window_start"], deal.pickup_window_start.isoformat())

        direct_serializer_payload = OrderSerializer(order).data
        self.assertEqual(direct_serializer_payload["order_items"][0]["display_name"], deal.title)

    def test_smoke_expired_surprise_deal_reservation_releases_stock_without_financial_side_effects(self):
        seed_wallet(user=self.customer, amount=50000)
        deal = self._create_active_deal_via_business_api()
        checkout_response = self._create_checkout(deal=deal)
        self.assertEqual(checkout_response.status_code, 201, checkout_response.data)

        session = CheckoutSession.objects.get(id=checkout_response.data["checkout_session"]["id"])
        reservation = SurpriseDealReservation.objects.get(id=checkout_response.data["reservation"]["id"])
        due_at = timezone.now() - timedelta(minutes=1)
        reserved_at = due_at - timedelta(minutes=10)
        CheckoutSession.objects.filter(id=session.id).update(expires_at=due_at)
        SurpriseDealReservation.objects.filter(id=reservation.id).update(reserved_at=reserved_at, expires_at=due_at)

        expired_count = expire_due_surprise_deal_reservations()

        self.assertEqual(expired_count, 1)
        session.refresh_from_db()
        reservation.refresh_from_db()
        deal.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.Status.EXPIRED)
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.EXPIRED)
        self.assertEqual(deal.quantity_remaining, 2)
        self.assertEqual(deal.quantity_reserved, 0)
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(BusinessEarning.objects.count(), 0)
        self.assertEqual(WalletTransaction.objects.filter(transaction_type=WalletTransaction.Type.PURCHASE).count(), 0)

    def test_smoke_insufficient_balance_does_not_create_session_or_reservation_or_change_stock(self):
        seed_wallet(user=self.customer, amount=1000)
        deal = self._create_active_deal_via_business_api()

        checkout_response = self._create_checkout(deal=deal)

        self.assertEqual(checkout_response.status_code, 400)
        self.assertEqual(CheckoutSession.objects.count(), 0)
        self.assertEqual(SurpriseDealReservation.objects.count(), 0)
        deal.refresh_from_db()
        self.assertEqual(deal.quantity_remaining, 2)
        self.assertEqual(deal.quantity_reserved, 0)

    def test_smoke_double_consume_does_not_double_debit_or_create_duplicate_order_or_earning(self):
        seed_wallet(user=self.customer, amount=50000)
        deal = self._create_active_deal_via_business_api()
        checkout_response = self._create_checkout(deal=deal)
        self.assertEqual(checkout_response.status_code, 201, checkout_response.data)
        token = checkout_response.data["checkout_session"]["token"]

        first_response = self._consume(token=token)
        wallet_after_first = Wallet.objects.get(user=self.customer).balance
        second_response = self._consume(token=token)
        wallet_after_second = Wallet.objects.get(user=self.customer).balance

        self.assertEqual(first_response.status_code, 200, first_response.data)
        self.assertEqual(second_response.status_code, 409, second_response.data)
        self.assertEqual(wallet_after_second, wallet_after_first)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(BusinessEarning.objects.count(), 1)
        self.assertEqual(WalletTransaction.objects.filter(transaction_type=WalletTransaction.Type.PURCHASE).count(), 1)
