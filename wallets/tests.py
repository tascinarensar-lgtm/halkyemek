import hashlib
import hmac
import json
from unittest.mock import patch

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.db import transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.models import User
from businesses.models import BusinessMember, BusinessProfile
from menus.models import Category, MenuItem
from orders.models import CheckoutSession, Order
from orders.services_checkout import consume_checkout_session
from orders.services_cart import CartService
from payments.models import PaymentIntent, ProviderEvent
from wallets.models import PendingWalletTransaction, Wallet, WalletTransaction
from wallets.services import WalletService


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


class WalletLedgerTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u1", password="pass")

    def test_purchase_creates_tx_and_updates_balance_once(self):
        WalletService.topup(user=self.user, amount=1000, description="seed")
        wallet = self.user.wallet
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, 1000)

        WalletService.purchase(user=self.user, amount=300, description="buy")
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, 700)

        txs = list(wallet.transactions.order_by("created_at", "id"))
        self.assertEqual(len(txs), 2)
        self.assertEqual(txs[0].amount, 1000)
        self.assertEqual(txs[1].amount, -300)
        self.assertEqual(txs[1].after_balance, 700)

    def test_wallettransaction_is_immutable(self):
        WalletService.topup(user=self.user, amount=500, description="seed")
        tx = self.user.wallet.transactions.first()
        tx.description = "hacked"
        with self.assertRaises(ValidationError):
            tx.save()
        with self.assertRaises(ValidationError):
            tx.delete()

    def test_db_enforces_type_sign_constraints(self):
        WalletService.topup(user=self.user, amount=1000, description="seed")
        wallet = self.user.wallet
        wallet.refresh_from_db()

        with self.assertRaises(IntegrityError):
            WalletTransaction.objects.create(
                wallet=wallet,
                transaction_type=WalletTransaction.Type.PURCHASE,
                amount=100,
                before_balance=1000,
                after_balance=1100,
                description="invalid purchase",
            )

    def test_unique_purchase_per_order(self):
        business_owner = User.objects.create_user(username="b1", password="pass")
        business = BusinessProfile.objects.create(
            contact_user=business_owner,
            business_name="Test Business",
            category="Food",
            adress="Addr",
            district=BusinessProfile.District.BEYLIKDUZU,
            is_approved=True,
            is_active=True,
            is_listed=True,
        )
        category = Category.objects.create(business=business, name="Main")
        menu_item = MenuItem.objects.create(
            business=business,
            category=category,
            name="M1",
            slug="m1",
            price_amount=100,
        )

        WalletService.topup(user=self.user, amount=1000, description="seed")
        order = Order.objects.create(user=self.user, business=business, menu=menu_item, amount=100, status=Order.Status.CREATED)

        WalletService.purchase(user=self.user, amount=100, description="buy", order=order)
        with self.assertRaises(ValidationError):
            WalletService.purchase(user=self.user, amount=100, description="double buy", order=order)


class PendingLedgerWebhookTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="u1", password="pass")
        Wallet.objects.get_or_create(user=self.user)

    def test_paid_event_creates_pending_ledger(self):
        intent = PaymentIntent.objects.create(
            user=self.user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=1000,
            status=PaymentIntent.Status.INITIATED,
        )

        payload = {
            "type": "payment.paid",
            "event_id": "evt_123",
            "data": {"intent_id": intent.pk, "provider_payment_id": "pay_1"},
        }
        body = json.dumps(payload).encode("utf-8")
        sig = sign(settings.PAYMENT_WEBHOOK_SECRET, body)

        resp = self.client.post(
            reverse("payments:provider-webhook"),
            data=body,
            content_type="application/json",
            HTTP_X_PROVIDER_EVENT_ID="evt_123",
            HTTP_X_PROVIDER_SIGNATURE=sig,
        )
        self.assertEqual(resp.status_code, 200)

        wallet = self.user.wallet
        wallet.refresh_from_db()
        self.assertEqual(wallet.pending_balance, 1000)

        tx = PendingWalletTransaction.objects.get(wallet=wallet, transaction_type=PendingWalletTransaction.Type.TOPUP_PENDING)
        self.assertEqual(tx.amount, 1000)
        self.assertIsNotNone(tx.provider_event)
        self.assertEqual(tx.provider_event.event_id, "evt_123")
        self.assertIsNotNone(tx.payment_intent)
        self.assertEqual(tx.payment_intent.id, intent.pk)

    def test_pending_topup_is_idempotent_per_payment_intent(self):
        intent = PaymentIntent.objects.create(
            user=self.user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=1000,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=self.user, amount=1000, payment_intent=intent)
        WalletService.topup_pending(user=self.user, amount=1000, payment_intent=intent)

        wallet = self.user.wallet
        wallet.refresh_from_db()
        self.assertEqual(wallet.pending_balance, 1000)
        self.assertEqual(
            PendingWalletTransaction.objects.filter(
                wallet=wallet,
                payment_intent=intent,
                transaction_type=PendingWalletTransaction.Type.TOPUP_PENDING,
            ).count(),
            1,
        )


class WalletTransactionAppendOnlyTests(TestCase):
    def test_update_is_blocked(self):
        user = User.objects.create_user(username="u1", password="pass")
        Wallet.objects.get_or_create(user=user)
        tx = WalletTransaction.objects.create(
            wallet=user.wallet,
            amount=100,
            transaction_type=WalletTransaction.Type.TOP_UP,
            before_balance=0,
            after_balance=100,
            description="seed",
        )
        tx.description = "changed"
        with self.assertRaises(ValidationError):
            tx.save()

    def test_delete_is_blocked(self):
        user = User.objects.create_user(username="u2", password="pass")
        Wallet.objects.get_or_create(user=user)
        tx = WalletTransaction.objects.create(
            wallet=user.wallet,
            amount=100,
            transaction_type=WalletTransaction.Type.TOP_UP,
            before_balance=0,
            after_balance=100,
            description="seed",
        )
        with self.assertRaises(ValidationError):
            tx.delete()


class PendingWalletTransactionAppendOnlyTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="pending-append", password="pass")
        self.intent = PaymentIntent.objects.create(
            user=self.user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=100,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=self.user, amount=100, payment_intent=self.intent)

    def test_update_is_blocked(self):
        tx = PendingWalletTransaction.objects.get(
            payment_intent=self.intent,
            transaction_type=PendingWalletTransaction.Type.TOPUP_PENDING,
        )
        tx.description = "changed"
        with self.assertRaises(ValidationError):
            tx.save()

    def test_delete_is_blocked(self):
        tx = PendingWalletTransaction.objects.get(
            payment_intent=self.intent,
            transaction_type=PendingWalletTransaction.Type.TOPUP_PENDING,
        )
        with self.assertRaises(ValidationError):
            tx.delete()


class CheckoutWalletIntegrationTests(TestCase):
    def setUp(self):
        self.customer = User.objects.create_user(username="customer", password="pass")
        self.cashier = User.objects.create_user(username="cashier", password="pass")
        self.owner = User.objects.create_user(username="owner", password="pass")

        self.business = BusinessProfile.objects.create(
            contact_user=self.owner,
            business_name="Biz",
            category="Food",
            adress="Addr",
            district=BusinessProfile.District.BEYLIKDUZU,
            is_active=True,
            is_approved=True,
            is_listed=True,
        )
        BusinessMember.objects.create(
            business=self.business,
            user=self.cashier,
            role=BusinessMember.Role.CASHIER,
            is_active=True,
            granted_by=self.owner,
        )
        self.category = Category.objects.create(business=self.business, name="Main")
        self.menu_item = MenuItem.objects.create(
            business=self.business,
            category=self.category,
            name="Kofte",
            slug="kofte",
            price_amount=2500,
            is_active=True,
            is_visible=True,
            is_available=True,
        )

    def test_consume_checkout_session_deducts_wallet_once(self):
        WalletService.topup(user=self.customer, amount=10000, description="seed")
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        cart = self.customer.carts.get(status="ACTIVE")
        pricing = (cart.snapshot or {}).get("pricing") or {}
        session = CheckoutSession.objects.create(
            user=self.customer,
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
            expires_at=CheckoutSession.default_expiry(),
        )

        result = consume_checkout_session(token=session.token, actor_user=self.cashier, business_id=self.business.id)
        self.assertEqual(result.amount, int(pricing.get("total_payable_amount") or 0))

        wallet = self.customer.wallet
        wallet.refresh_from_db()
        self.assertEqual(wallet.balance, 10000 - int(pricing.get("total_payable_amount") or 0))
        self.assertEqual(
            WalletTransaction.objects.filter(order=result.order, transaction_type=WalletTransaction.Type.PURCHASE).count(),
            1,
        )

        with self.assertRaisesMessage(Exception, "already consumed"):
            consume_checkout_session(token=session.token, actor_user=self.cashier, business_id=self.business.id)


class WalletServiceRobustnessTests(TestCase):
    def test_service_methods_create_wallet_when_missing(self):
        user = User.objects.create_user(username="late-wallet", password="pass")
        Wallet.objects.filter(user=user).delete()

        WalletService.topup(user=user, amount=250, description="seed")

        wallet = Wallet.objects.get(user=user)
        self.assertEqual(int(wallet.balance), 250)

    def test_reconcile_rebuilds_balances_from_ledger_sums(self):
        user = User.objects.create_user(username="reconcile-user", password="pass")
        WalletService.topup(user=user, amount=1000, description="seed")
        WalletService.topup_pending(user=user, amount=400, description="pending")

        wallet = Wallet.objects.get(user=user)
        wallet.balance = 1
        wallet.pending_balance = 2
        wallet.save(update_fields=["balance", "pending_balance", "updated_at"])

        snapshot = WalletService.reconcile(user=user)
        wallet.refresh_from_db()

        self.assertEqual(int(wallet.balance), 1000)
        self.assertEqual(int(wallet.pending_balance), 400)
        self.assertTrue(snapshot["wallet_in_sync"])
        self.assertTrue(snapshot["pending_in_sync"])

    def test_get_wallet_for_update_handles_first_create_integrity_race(self):
        user = User.objects.create_user(username="race-user", password="pass")

        def _racing_create(**kwargs):
            Wallet._base_manager.create(**kwargs)
            raise IntegrityError("simulated concurrent wallet create")

        with patch("wallets.services.Wallet.objects.create", side_effect=_racing_create):
            with transaction.atomic():
                wallet = WalletService._get_wallet_for_update(user=user)

        self.assertEqual(wallet.user_id, user.id)
        self.assertEqual(Wallet.objects.filter(user=user).count(), 1)

    def test_reverse_available_funds_is_idempotent_per_provider_event_and_intent(self):
        user = User.objects.create_user(username="reversal-idem", password="pass")
        WalletService.topup(user=user, amount=500, description="seed")
        intent = PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=500,
            status=PaymentIntent.Status.PAID,
        )
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-reversal-1",
            event_type="payment.reversal",
            payload={},
            signature_ok=True,
        )

        first = WalletService.reverse_available_funds(
            user=user,
            amount=120,
            provider_event=provider_event,
            payment_intent=intent,
        )
        second = WalletService.reverse_available_funds(
            user=user,
            amount=120,
            provider_event=provider_event,
            payment_intent=intent,
        )

        wallet = Wallet.objects.get(user=user)
        self.assertEqual(first.tx.id, second.tx.id)
        self.assertEqual(int(wallet.balance), 380)

    def test_wallet_drift_blocks_write_until_reconciled(self):
        user = User.objects.create_user(username="wallet-drift", password="pass")
        WalletService.topup(user=user, amount=500, description="seed")

        wallet = Wallet.objects.get(user=user)
        wallet.balance = 499
        wallet.save(update_fields=["balance", "updated_at"])

        with self.assertRaisesMessage(ValidationError, "Ledger drift detected"):
            WalletService.purchase(user=user, amount=50, description="should fail")

        WalletService.reconcile(user=user)
        WalletService.purchase(user=user, amount=50, description="works after reconcile")

        wallet.refresh_from_db()
        self.assertEqual(int(wallet.balance), 450)

    def test_pending_drift_blocks_settlement_until_reconciled(self):
        user = User.objects.create_user(username="pending-drift", password="pass")
        intent = PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=200,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=user, amount=200, payment_intent=intent)

        wallet = Wallet.objects.get(user=user)
        wallet.pending_balance = 199
        wallet.save(update_fields=["pending_balance", "updated_at"])

        with self.assertRaisesMessage(ValidationError, "Pending ledger drift detected"):
            WalletService.settle_pending_to_available(user=user, amount=200, payment_intent=intent)

        WalletService.reconcile(user=user)
        WalletService.settle_pending_to_available(user=user, amount=200, payment_intent=intent)

        wallet.refresh_from_db()
        self.assertEqual(int(wallet.pending_balance), 0)
        self.assertEqual(int(wallet.balance), 200)

    def test_reverse_topup_payment_intent_is_idempotent_for_same_provider_event(self):
        user = User.objects.create_user(username="topup-reversal-idem", password="pass")
        intent = PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=user, amount=200, payment_intent=intent)
        WalletService.topup(user=user, amount=100, payment_intent=intent, description="available")
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-topup-reversal-idem-1",
            event_type="payment.reversal",
            payload={},
            signature_ok=True,
        )

        first = WalletService.reverse_topup_payment_intent(
            user=user,
            amount=250,
            payment_intent=intent,
            provider_event=provider_event,
        )
        second = WalletService.reverse_topup_payment_intent(
            user=user,
            amount=250,
            payment_intent=intent,
            provider_event=provider_event,
        )

        wallet = Wallet.objects.get(user=user)
        self.assertEqual(first, second)
        self.assertEqual(int(wallet.pending_balance), 0)
        self.assertEqual(int(wallet.balance), 50)
        self.assertEqual(
            PendingWalletTransaction.objects.filter(
                payment_intent=intent,
                provider_event=provider_event,
                transaction_type=PendingWalletTransaction.Type.REVERSAL_OUT,
            ).count(),
            1,
        )
        self.assertEqual(
            WalletTransaction.objects.filter(
                payment_intent=intent,
                provider_event=provider_event,
                transaction_type=WalletTransaction.Type.REVERSAL,
            ).count(),
            1,
        )

    def test_reverse_topup_payment_intent_rejects_amount_mismatch_for_same_provider_event(self):
        user = User.objects.create_user(username="topup-reversal-mismatch", password="pass")
        intent = PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=300,
            status=PaymentIntent.Status.PAID,
        )
        WalletService.topup_pending(user=user, amount=300, payment_intent=intent)
        provider_event = ProviderEvent.objects.create(
            provider=ProviderEvent.Provider.IYZICO,
            event_id="evt-topup-reversal-mismatch-1",
            event_type="payment.reversal",
            payload={},
            signature_ok=True,
        )
        WalletService.reverse_topup_payment_intent(
            user=user,
            amount=200,
            payment_intent=intent,
            provider_event=provider_event,
        )

        with self.assertRaisesMessage(ValidationError, "provider event reversal amount mismatch"):
            WalletService.reverse_topup_payment_intent(
                user=user,
                amount=150,
                payment_intent=intent,
                provider_event=provider_event,
            )
