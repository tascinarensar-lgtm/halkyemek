from unittest.mock import patch

from idempotency.models import IdempotencyRecord
from django.test import TestCase
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from notifications.models import Notification
from orders.models import CheckoutSession, Order
from orders.services_cart import CartService
from payouts.models import BusinessEarning
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device, expired_time, seed_wallet
from wallets.models import Wallet, WalletTransaction


class CheckoutApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        test_name = self._testMethodName
        self.customer = create_user(username=f"customer-{test_name}")
        self.cashier = create_user(username=f"cashier-{test_name}")
        self.other_user = create_user(username=f"other-{test_name}")
        self.business = create_business(name="Biz")
        self.other_business = create_business(name="Other Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Burger")
        self.menu_item = create_menu_item(business=self.business, category=self.category, name="Classic Burger", slug="classic-burger")
        seed_wallet(user=self.customer, amount=200000)
        enable_push_device(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

    def _create_manual_cart_backed_session(self, *, user, expires_at=None):
        cart = CartService.get_or_create_active_cart(user=user, business=self.business)
        CartService.clear_active_cart(user=user)
        CartService.add_item(user=user, menu_item=self.menu_item, quantity=1)
        cart.refresh_from_db()
        pricing = (cart.snapshot or {}).get("pricing") or {}
        return CheckoutSession.objects.create(
            user=user,
            business=self.business,
            cart=cart,
            token=CheckoutSession.generate_token(),
            status=CheckoutSession.Status.PENDING,
            amount=int(pricing.get("total_payable_amount") or 0),
            subtotal_amount=int(pricing.get("subtotal_amount") or 0),
            customer_fee_amount=int(pricing.get("customer_fee_amount") or 0),
            business_fee_amount=int(pricing.get("business_fee_amount") or 0),
            business_net_amount=int(pricing.get("business_net_amount") or 0),
            platform_total_fee_amount=int(pricing.get("platform_total_fee_amount") or 0),
            item_count=int((cart.snapshot or {}).get("item_count") or 0),
            currency="TRY",
            business_name=self.business.business_name,
            pricing_snapshot=pricing,
            cart_snapshot=cart.snapshot,
            expires_at=expires_at or CheckoutSession.default_expiry(),
        )

    def _create_session(self, user=None):
        self.client.force_authenticate(user or self.customer)
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-create-default",
        )
        self.assertEqual(resp.status_code, 201)
        return resp

    def test_create_rejects_removed_legacy_payload(self):
        self.client.force_authenticate(self.customer)
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {"menu_item_id": self.menu_item.id},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-legacy-payload-blocked",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Deprecated contract removed", str(resp.data))

    def test_checkout_detail_exposes_cart_contract_not_legacy_menu_fields(self):
        resp = self._create_session()
        self.assertIn("items", resp.data)
        self.assertIn("cart", resp.data)
        self.assertNotIn("menu_item_id", resp.data)
        self.assertNotIn("menu_item_name", resp.data)

    def test_authenticated_user_can_create_checkout_session(self):
        resp = self._create_session()
        self.assertEqual(resp.data["status"], "PENDING")
        self.assertEqual(resp.data["amount"], self.menu_item.price_amount + 1000)
        self.assertEqual(resp["Idempotency-Replayed"], "false")

    def test_authenticated_user_without_push_device_can_create_checkout_session(self):
        no_push_user = create_user(username="customer-no-push")
        seed_wallet(user=no_push_user, amount=200000)
        CartService.add_item(user=no_push_user, menu_item=self.menu_item, quantity=1)

        self.client.force_authenticate(no_push_user)
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-create-no-push-device",
        )

        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["status"], CheckoutSession.Status.PENDING)

    def test_checkout_session_create_does_not_debit_wallet_until_business_consume(self):
        wallet_before = Wallet.objects.get(user=self.customer).balance

        create_resp = self._create_session()
        token = create_resp.data["token"]

        wallet_after_create = Wallet.objects.get(user=self.customer).balance
        self.assertEqual(wallet_after_create, wallet_before)
        self.assertFalse(
            WalletTransaction.objects.filter(
                wallet__user=self.customer,
                transaction_type=WalletTransaction.Type.PURCHASE,
            ).exists()
        )

        self.client.force_authenticate(self.cashier)
        consume_resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )

        self.assertEqual(consume_resp.status_code, 200)
        wallet_after_consume = Wallet.objects.get(user=self.customer).balance
        self.assertEqual(wallet_before - wallet_after_consume, create_resp.data["amount"])
        self.assertEqual(
            WalletTransaction.objects.filter(
                wallet__user=self.customer,
                transaction_type=WalletTransaction.Type.PURCHASE,
                order_id=consume_resp.data["order_id"],
            ).count(),
            1,
        )

    def test_order_api_exposes_checkout_session_timeline_fields(self):
        create_resp = self._create_session()
        token = create_resp.data["token"]
        session = CheckoutSession.objects.get(token=token)

        self.client.force_authenticate(self.cashier)
        consume_resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )
        self.assertEqual(consume_resp.status_code, 200)

        self.client.force_authenticate(self.customer)
        order_resp = self.client.get(f"/api/v1/orders/{consume_resp.data['order_id']}/")
        self.assertEqual(order_resp.status_code, 200)
        self.assertEqual(order_resp.data["checkout_session_created_at"], session.created_at)
        self.assertEqual(order_resp.data["checkout_session_expires_at"], session.expires_at)
        self.assertIsNotNone(order_resp.data["checkout_session_consumed_at"])
        self.assertEqual(order_resp.data["source"]["checkout_session_created_at"], order_resp.data["checkout_session_created_at"])

    def test_create_checkout_session_rejects_insufficient_wallet_balance(self):
        poor_user = create_user(username="poor-create")
        enable_push_device(user=poor_user)
        CartService.add_item(user=poor_user, menu_item=self.menu_item, quantity=1)
        self.client.force_authenticate(poor_user)

        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-create-insufficient-wallet",
        )

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data["error"]["code"], "checkout_session_invalid")
        self.assertIn("Insufficient", str(resp.data["error"]["message"]))

    def test_anonymous_user_cannot_create_checkout_session(self):
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-anon-create",
        )
        self.assertEqual(resp.status_code, 401)

    def test_create_requires_idempotency_key_header(self):
        self.client.force_authenticate(self.customer)
        resp = self.client.post("/api/v1/checkout-sessions/", {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_replays_for_same_idempotency_key(self):
        self.client.force_authenticate(self.customer)
        first = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-replay-1",
        )
        second = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-replay-1",
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first.data["token"], second.data["token"])
        self.assertEqual(first["Idempotency-Replayed"], "false")
        self.assertEqual(second["Idempotency-Replayed"], "true")
        self.assertEqual(CheckoutSession.objects.count(), 1)

    def test_create_same_key_with_different_payload_returns_conflict(self):
        other_menu = create_menu_item(
            business=self.business,
            category=self.category,
            name="Veggie",
            slug="veggie-burger",
            price_amount=1700,
        )
        self.client.force_authenticate(self.customer)
        first = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-conflict-1",
        )
        first_session = CheckoutSession.objects.get(token=first.data["token"])
        if first_session.cart_id:
            first_session.cart.status = first_session.cart.Status.ABANDONED
            first_session.cart.abandoned_at = timezone.now()
            first_session.cart.save(update_fields=["status", "abandoned_at", "updated_at"])
        CartService.add_item(user=self.customer, menu_item=other_menu, quantity=1)
        second = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-conflict-1",
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second["Idempotency-Replayed"], "true")
        self.assertEqual(second.data["token"], first.data["token"])
        self.assertEqual(IdempotencyRecord.objects.filter(scope="orders.checkout_session_create").count(), 1)

    def test_create_reuses_active_pending_checkout_session(self):
        first = self._create_session()
        second = self._create_session()
        self.assertEqual(first.data["token"], second.data["token"])
        self.assertEqual(CheckoutSession.objects.count(), 1)

    def test_can_get_checkout_session_detail_by_token(self):
        create_resp = self._create_session()
        token = create_resp.data["token"]
        self.client.force_authenticate(self.customer)
        resp = self.client.get(f"/api/v1/checkout-sessions/{token}/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["token"], token)

    def test_can_get_latest_reusable_checkout_session(self):
        create_resp = self._create_session()
        token = create_resp.data["token"]
        self.client.force_authenticate(self.customer)
        resp = self.client.get("/api/v1/checkout-sessions/latest/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["token"], token)

    def test_checkout_session_list_returns_only_own_qr_sessions(self):
        own_token = self._create_session().data["token"]
        other_user = create_user(username="qr-list-other")
        enable_push_device(user=other_user)
        seed_wallet(user=other_user, amount=200000)
        CartService.add_item(user=other_user, menu_item=self.menu_item, quantity=1)
        self.client.force_authenticate(other_user)
        other_token = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-list-other",
        ).data["token"]

        self.client.force_authenticate(self.customer)
        resp = self.client.get("/api/v1/checkout-sessions/")

        self.assertEqual(resp.status_code, 200)
        tokens = [item["token"] for item in resp.data["results"]]
        self.assertIn(own_token, tokens)
        self.assertNotIn(other_token, tokens)

    def test_checkout_session_list_filters_active_and_expired(self):
        active_token = self._create_session().data["token"]
        expired_session = self._create_manual_cart_backed_session(user=self.customer, expires_at=expired_time())

        self.client.force_authenticate(self.customer)
        active_resp = self.client.get("/api/v1/checkout-sessions/?status=active")
        expired_resp = self.client.get("/api/v1/checkout-sessions/?status=expired")

        self.assertEqual(active_resp.status_code, 200)
        self.assertEqual(expired_resp.status_code, 200)
        self.assertIn(active_token, [item["token"] for item in active_resp.data["results"]])
        self.assertNotIn(expired_session.token, [item["token"] for item in active_resp.data["results"]])
        expired_items = {item["token"]: item for item in expired_resp.data["results"]}
        self.assertIn(expired_session.token, expired_items)
        self.assertEqual(expired_items[expired_session.token]["status"], CheckoutSession.Status.EXPIRED)

    def test_expired_pending_checkout_restores_cart_as_active(self):
        create_resp = self._create_session()
        session = CheckoutSession.objects.get(token=create_resp.data["token"])
        session.expires_at = expired_time()
        session.save(update_fields=["expires_at", "updated_at"])

        self.client.force_authenticate(self.customer)
        cart_resp = self.client.get("/api/v1/cart/")
        self.assertEqual(cart_resp.status_code, 200)
        self.assertEqual(cart_resp.data["item_count"], 1)

        session.refresh_from_db()
        self.assertEqual(session.status, CheckoutSession.Status.EXPIRED)

        session.cart.refresh_from_db()
        self.assertEqual(session.cart.status, session.cart.Status.ACTIVE)

    def test_customer_can_cancel_checkout_session_and_restore_cart(self):
        create_resp = self._create_session()
        token = create_resp.data["token"]

        self.client.force_authenticate(self.customer)
        cancel_resp = self.client.post(f"/api/v1/checkout-sessions/{token}/cancel/", {}, format="json")
        self.assertEqual(cancel_resp.status_code, 200)
        self.assertEqual(cancel_resp.data["status"], CheckoutSession.Status.CANCELLED)

        session = CheckoutSession.objects.get(token=token)
        self.assertEqual(session.status, CheckoutSession.Status.CANCELLED)
        self.assertIsNotNone(session.cancelled_at)

        session.cart.refresh_from_db()
        self.assertEqual(session.cart.status, session.cart.Status.ACTIVE)

        cart_resp = self.client.get("/api/v1/cart/")
        self.assertEqual(cart_resp.status_code, 200)
        self.assertEqual(cart_resp.data["item_count"], 1)

    def test_other_user_cannot_cancel_checkout_session(self):
        token = self._create_session().data["token"]

        self.client.force_authenticate(self.other_user)
        cancel_resp = self.client.post(f"/api/v1/checkout-sessions/{token}/cancel/", {}, format="json")
        self.assertEqual(cancel_resp.status_code, 403)
        self.assertEqual(cancel_resp.data["error"]["code"], "checkout_session_forbidden")

    def test_consumed_checkout_session_cannot_be_cancelled(self):
        token = self._create_session().data["token"]

        self.client.force_authenticate(self.cashier)
        consume_resp = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.assertEqual(consume_resp.status_code, 200)

        self.client.force_authenticate(self.customer)
        cancel_resp = self.client.post(f"/api/v1/checkout-sessions/{token}/cancel/", {}, format="json")
        self.assertEqual(cancel_resp.status_code, 409)
        self.assertEqual(cancel_resp.data["error"]["code"], "checkout_session_already_consumed")
        self.assertEqual(cancel_resp.data["error"]["details"]["order_id"], consume_resp.data["order_id"])

    @patch("orders.services_checkout.NotificationService.enqueue")
    def test_checkout_consume_success(self, m_enqueue):
        token = self._create_session().data["token"]
        self.client.force_authenticate(self.cashier)
        resp = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], "CONSUMED")
        order = Order.objects.get(id=resp.data["order_id"])
        self.assertEqual(order.business_id, self.business.id)
        self.assertEqual(order.status, Order.Status.USED)
        self.assertIsNotNone(order.paid_at)
        self.assertIsNotNone(order.used_at)
        self.assertEqual(order.subtotal_amount, self.menu_item.price_amount)
        self.assertEqual(order.total_charged_amount, self.menu_item.price_amount + 1000)
        self.assertEqual(order.order_items.count(), 1)
        first_item = order.order_items.first()
        self.assertIsNotNone(first_item)
        self.assertEqual(first_item.menu_item_name, self.menu_item.name)
        self.assertEqual(first_item.line_total_amount, self.menu_item.price_amount)
        self.assertTrue(m_enqueue.called)
        emitted_types = [call.kwargs.get("type") for call in m_enqueue.call_args_list]
        self.assertIn(Notification.Type.ORDER_PAID, emitted_types)
        self.assertIn(Notification.Type.ORDER_CONSUMED, emitted_types)

    def test_non_member_cannot_consume_checkout_session(self):
        token = self._create_session().data["token"]
        self.client.force_authenticate(self.other_user)
        resp = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_insufficient_balance_blocked(self):
        poor_user = create_user(username="poor")
        session = self._create_manual_cart_backed_session(user=poor_user)
        self.client.force_authenticate(self.cashier)
        resp = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{session.token}/consume/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Insufficient", str(resp.data))

    def test_double_consume_blocked(self):
        token = self._create_session().data["token"]
        self.client.force_authenticate(self.cashier)
        first = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.assertEqual(first.status_code, 200)
        second = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.data["error"]["code"], "checkout_session_already_consumed")
        self.assertEqual(second.data["error"]["details"]["order_id"], first.data["order_id"])

    def test_wrong_business_blocked(self):
        token = self._create_session().data["token"]
        other_cashier = create_user(username="other_cashier")
        add_membership(business=self.other_business, user=other_cashier, role=BusinessMember.Role.CASHIER)
        self.client.force_authenticate(other_cashier)
        resp = self.client.post(f"/api/v1/businesses/{self.other_business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_create_without_menu_item_uses_active_cart(self):
        CartService.clear_active_cart(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=2)

        self.client.force_authenticate(self.customer)
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-cart-backed-create",
        )

        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["item_count"], 1)
        self.assertEqual(resp.data["subtotal_amount"], self.menu_item.price_amount * 2)
        self.assertEqual(resp.data["amount"], self.menu_item.price_amount * 2 + 1000)

    def test_consume_multi_item_cart_creates_items_and_debits_total_payable(self):
        second_item = create_menu_item(
            business=self.business,
            category=self.category,
            name="Pilav",
            slug="pilav",
            price_amount=13000,
        )
        CartService.clear_active_cart(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        CartService.add_item(user=self.customer, menu_item=second_item, quantity=2)

        wallet_before = Wallet.objects.get(user=self.customer).balance

        self.client.force_authenticate(self.customer)
        create_resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-multi-item-create",
        )
        self.assertEqual(create_resp.status_code, 201)
        token = create_resp.data["token"]

        self.client.force_authenticate(self.cashier)
        consume_resp = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.assertEqual(consume_resp.status_code, 200)

        order = Order.objects.get(id=consume_resp.data["order_id"])
        self.assertEqual(order.order_items.count(), 2)
        self.assertEqual(order.subtotal_amount, self.menu_item.price_amount + second_item.price_amount * 2)
        self.assertEqual(order.total_charged_amount, order.subtotal_amount + 1000)
        self.assertEqual(order.business_fee_amount, 1000)
        self.assertEqual(order.business_net_amount, order.subtotal_amount - 1000)

        wallet_after = Wallet.objects.get(user=self.customer).balance
        self.assertEqual(wallet_before - wallet_after, order.total_charged_amount)

        purchase_tx = WalletTransaction.objects.filter(order=order, transaction_type=WalletTransaction.Type.PURCHASE).first()
        self.assertIsNotNone(purchase_tx)
        self.assertEqual(abs(int(purchase_tx.amount)), int(order.total_charged_amount))

        earning = BusinessEarning.objects.get(order=order)
        self.assertEqual(earning.gross_amount, order.subtotal_amount)
        self.assertEqual(earning.platform_fee_amount, 1000)
        self.assertEqual(earning.net_amount, order.subtotal_amount - 1000)

    def test_create_without_push_device_still_succeeds(self):
        customer_no_device = create_user(username="customer-no-device")
        seed_wallet(user=customer_no_device, amount=50000)
        CartService.add_item(user=customer_no_device, menu_item=self.menu_item, quantity=1)

        self.client.force_authenticate(customer_no_device)
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-push-device-required",
        )
        self.assertEqual(resp.status_code, 201)

    def test_marketplace_hidden_business_cannot_create_checkout_session(self):
        self.business.marketplace_is_visible = False
        self.business.save(update_fields=["marketplace_is_visible"])

        self.client.force_authenticate(self.customer)
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="checkout-marketplace-hidden",
        )
        self.assertEqual(resp.status_code, 400)

    def test_expired_token_blocked(self):
        session = self._create_manual_cart_backed_session(user=self.customer, expires_at=expired_time())
        self.client.force_authenticate(self.cashier)
        resp = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{session.token}/consume/", {}, format="json")
        self.assertEqual(resp.status_code, 410)

    def test_business_earning_created_correctly(self):
        token = self._create_session().data["token"]
        self.client.force_authenticate(self.cashier)
        resp = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        order = Order.objects.get(id=resp.data["order_id"])
        earning = BusinessEarning.objects.get(order=order)
        self.assertEqual(earning.business_id, self.business.id)
        self.assertEqual(earning.gross_amount, self.menu_item.price_amount)
        self.assertEqual(earning.net_amount, self.menu_item.price_amount - 1000)

    @override_settings(BUSINESS_PLATFORM_FEE_BPS=1000)
    def test_order_pricing_snapshot_matches_earning_breakdown_when_fee_enabled(self):
        token = self._create_session().data["token"]
        self.client.force_authenticate(self.cashier)
        resp = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.assertEqual(resp.status_code, 200)

        order = Order.objects.get(id=resp.data["order_id"])
        earning = BusinessEarning.objects.get(order=order)

        self.assertEqual(order.business_fee_amount, earning.platform_fee_amount)
        self.assertEqual(order.business_net_amount, earning.net_amount)

    def test_financial_integrity_verification_passes_after_consume(self):
        token = self._create_session().data["token"]
        before = Wallet.objects.get(user=self.customer).balance
        self.client.force_authenticate(self.cashier)
        resp = self.client.post(f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/", {}, format="json")
        self.assertEqual(resp.status_code, 200)
        wallet = Wallet.objects.get(user=self.customer)
        last_tx = WalletTransaction.objects.filter(wallet=wallet).order_by("-id").first()
        self.assertIsNotNone(last_tx)
        self.assertEqual(int(last_tx.after_balance), int(wallet.balance))
        self.assertEqual(int(before) + int(last_tx.amount), int(last_tx.after_balance))
