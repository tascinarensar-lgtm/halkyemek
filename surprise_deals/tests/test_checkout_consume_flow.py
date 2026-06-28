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
from test_support import add_membership, create_business, create_user, seed_wallet
from wallets.models import Wallet, WalletTransaction


def _window():
    now = timezone.now()
    return now + timedelta(hours=1), now + timedelta(hours=3)


def _deal(*, business, quantity_total: int = 2, sale_price_amount: int = 9000) -> SurpriseDeal:
    start, end = _window()
    return SurpriseDeal.objects.create(
        business=business,
        title="Aksam Surpriz Paketi",
        description="Gun sonu secili urunlerden olusan paket.",
        original_value_amount=20000,
        sale_price_amount=sale_price_amount,
        quantity_total=quantity_total,
        quantity_remaining=quantity_total,
        quantity_reserved=0,
        pickup_window_start=start,
        pickup_window_end=end,
        status=SurpriseDeal.Status.ACTIVE,
        min_contents_note="En az 2 urun",
    )


class SurpriseDealCheckoutConsumeFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username=f"surprise-customer-{self._testMethodName}")
        self.cashier = create_user(username=f"surprise-cashier-{self._testMethodName}")
        self.other_cashier = create_user(username=f"surprise-other-cashier-{self._testMethodName}")
        self.business = create_business(name=f"Surprise Biz {self._testMethodName}")
        self.other_business = create_business(name=f"Other Surprise Biz {self._testMethodName}")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        add_membership(business=self.other_business, user=self.other_cashier, role=BusinessMember.Role.CASHIER)
        self.deal = _deal(business=self.business)

    def _create_surprise_checkout(self, *, wallet_amount: int = 50000, deal: SurpriseDeal | None = None):
        seed_wallet(user=self.customer, amount=wallet_amount)
        deal = deal or self.deal
        self.client.force_authenticate(self.customer)
        response = self.client.post(f"/api/v1/surprise-deals/{deal.id}/checkout-session/", {}, format="json")
        self.assertEqual(response.status_code, 201)
        return response

    def _consume(self, *, token: str, business_id: int | None = None, cashier=None):
        self.client.force_authenticate(cashier or self.cashier)
        return self.client.post(
            f"/api/v1/businesses/{business_id or self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )

    def test_business_user_consumes_surprise_deal_qr_and_session_is_consumed(self):
        checkout = self._create_surprise_checkout()

        response = self._consume(token=checkout.data["checkout_session"]["token"])

        self.assertEqual(response.status_code, 200)
        session = CheckoutSession.objects.get(id=checkout.data["checkout_session"]["id"])
        self.assertEqual(session.status, CheckoutSession.Status.CONSUMED)
        self.assertIsNotNone(session.consumed_at)
        self.assertEqual(session.consumed_by_id, self.cashier.id)

    def test_reservation_is_committed_after_successful_consume(self):
        checkout = self._create_surprise_checkout()

        response = self._consume(token=checkout.data["checkout_session"]["token"])

        self.assertEqual(response.status_code, 200)
        reservation = SurpriseDealReservation.objects.get(id=checkout.data["reservation"]["id"])
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.COMMITTED)
        self.assertIsNotNone(reservation.committed_at)
        self.deal.refresh_from_db()
        self.assertEqual(self.deal.quantity_remaining, 1)
        self.assertEqual(self.deal.quantity_reserved, 0)

    def test_wallet_order_order_item_and_business_earning_are_created(self):
        checkout = self._create_surprise_checkout(wallet_amount=50000)
        wallet_before = Wallet.objects.get(user=self.customer).balance

        response = self._consume(token=checkout.data["checkout_session"]["token"])

        self.assertEqual(response.status_code, 200)
        order = Order.objects.get(id=response.data["order_id"])
        wallet_after = Wallet.objects.get(user=self.customer).balance
        item = OrderItem.objects.get(order=order)
        earning = BusinessEarning.objects.get(order=order)
        tx = WalletTransaction.objects.get(order=order, transaction_type=WalletTransaction.Type.PURCHASE)

        self.assertEqual(order.status, Order.Status.USED)
        self.assertEqual(order.checkout_session_id, checkout.data["checkout_session"]["id"])
        self.assertEqual(order.menu_id, None)
        self.assertEqual(order.amount, self.deal.sale_price_amount)
        self.assertEqual(wallet_after, wallet_before - self.deal.sale_price_amount)
        self.assertEqual(tx.amount, -self.deal.sale_price_amount)
        self.assertEqual(item.menu_item_id, None)
        self.assertEqual(item.menu_item_name, self.deal.title)
        self.assertEqual(item.quantity, 1)
        self.assertEqual(item.unit_price_amount, self.deal.sale_price_amount)
        self.assertEqual(item.line_total_amount, self.deal.sale_price_amount)
        self.assertEqual(item.menu_item_snapshot["source_type"], "SURPRISE_DEAL")
        self.assertEqual(item.menu_item_snapshot["surprise_deal_id"], self.deal.id)
        self.assertEqual(earning.business_id, self.business.id)
        self.assertEqual(earning.gross_amount, self.deal.sale_price_amount)

        serialized = OrderSerializer(order).data
        serialized_item = serialized["order_items"][0]
        self.assertEqual(serialized["source"]["source_type"], CheckoutSession.SourceType.SURPRISE_DEAL)
        self.assertEqual(serialized_item["item_type"], "SURPRISE_DEAL")
        self.assertEqual(serialized_item["display_name"], self.deal.title)
        self.assertEqual(serialized_item["surprise_deal_id"], self.deal.id)
        self.assertEqual(serialized_item["original_value_amount"], self.deal.original_value_amount)
        self.assertEqual(serialized_item["pickup_window_start"], self.deal.pickup_window_start.isoformat())

    def test_double_consume_does_not_debit_wallet_twice(self):
        checkout = self._create_surprise_checkout(wallet_amount=50000)
        token = checkout.data["checkout_session"]["token"]

        first = self._consume(token=token)
        wallet_after_first = Wallet.objects.get(user=self.customer).balance
        second = self._consume(token=token)
        wallet_after_second = Wallet.objects.get(user=self.customer).balance

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(wallet_after_second, wallet_after_first)
        self.assertEqual(WalletTransaction.objects.filter(transaction_type=WalletTransaction.Type.PURCHASE).count(), 1)

    def test_business_mismatch_cannot_consume(self):
        checkout = self._create_surprise_checkout()

        response = self._consume(
            token=checkout.data["checkout_session"]["token"],
            business_id=self.other_business.id,
            cashier=self.other_cashier,
        )

        self.assertEqual(response.status_code, 403)
        reservation = SurpriseDealReservation.objects.get(id=checkout.data["reservation"]["id"])
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.RESERVED)

    def test_expired_session_cannot_consume_and_releases_reservation_stock(self):
        checkout = self._create_surprise_checkout()
        session = CheckoutSession.objects.get(id=checkout.data["checkout_session"]["id"])
        CheckoutSession.objects.filter(id=session.id).update(expires_at=timezone.now() - timedelta(minutes=1))

        response = self._consume(token=checkout.data["checkout_session"]["token"])

        self.assertEqual(response.status_code, 410)
        session.refresh_from_db()
        reservation = SurpriseDealReservation.objects.get(id=checkout.data["reservation"]["id"])
        self.deal.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.Status.EXPIRED)
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.EXPIRED)
        self.assertEqual(self.deal.quantity_remaining, 2)
        self.assertEqual(self.deal.quantity_reserved, 0)

    def test_insufficient_balance_at_consume_cancels_session_and_releases_stock(self):
        checkout = self._create_surprise_checkout(wallet_amount=50000)
        Wallet.objects.filter(user=self.customer).update(balance=0)

        response = self._consume(token=checkout.data["checkout_session"]["token"])

        self.assertEqual(response.status_code, 400)
        session = CheckoutSession.objects.get(id=checkout.data["checkout_session"]["id"])
        reservation = SurpriseDealReservation.objects.get(id=checkout.data["reservation"]["id"])
        self.deal.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.Status.CANCELLED)
        self.assertEqual(reservation.status, SurpriseDealReservation.Status.CANCELLED)
        self.assertEqual(self.deal.quantity_remaining, 2)
        self.assertEqual(self.deal.quantity_reserved, 0)
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(WalletTransaction.objects.filter(transaction_type=WalletTransaction.Type.PURCHASE).count(), 0)
        self.assertEqual(BusinessEarning.objects.count(), 0)
