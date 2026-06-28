from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from businesses.models import BusinessMember
from notifications.models import Device
from orders.models import CheckoutSession
from orders.services_cart import CartService
from payments.models import PaymentIntent
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, seed_wallet


class PushDeviceEnforcementTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username="notif-customer")
        self.cashier = create_user(username="notif-cashier")
        self.business = create_business(name="Notif Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=1700)
        seed_wallet(user=self.customer, amount=5000)

    @staticmethod
    def _create_intent_mock(*, user, amount, callback_url):
        intent = PaymentIntent.objects.create(
            user=user,
            purpose=PaymentIntent.Purpose.TOPUP,
            amount=int(amount),
            gross_price=int(amount),
            provider=PaymentIntent.Provider.IYZICO,
            status=PaymentIntent.Status.INITIATED,
            provider_page_url=str(callback_url),
        )
        intent.marketplace_conversation_id = f"HY-PI-{intent.pk}"
        intent.save(update_fields=["marketplace_conversation_id", "updated_at"])
        return intent

    def test_checkout_create_allows_user_without_active_push_device(self):
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        self.client.force_authenticate(self.customer)
        response = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="notif-enforce-checkout-create",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], CheckoutSession.Status.PENDING)

    def test_topup_create_allows_user_without_active_push_device(self):
        self.client.force_authenticate(self.customer)

        with patch("payments.api.views.create_topup_payment_intent", side_effect=self._create_intent_mock) as create_mock:
            response = self.client.post(
                "/api/v1/payments/topup/intents/",
                {"amount": 1000},
                format="json",
                HTTP_IDEMPOTENCY_KEY="notif-enforce-topup-create",
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(create_mock.call_count, 1)

    def test_wallet_endpoints_allow_user_without_active_push_device(self):
        self.client.force_authenticate(self.customer)
        for endpoint in (
            "/api/v1/wallet/",
            "/api/v1/wallet/transactions/",
            "/api/v1/wallet/pending-transactions/",
        ):
            response = self.client.get(endpoint)
            self.assertEqual(response.status_code, 200)

    def test_cart_endpoints_allow_draft_cart_without_active_push_device(self):
        self.client.force_authenticate(self.customer)

        add_item = self.client.post(
            "/api/v1/cart/items/",
            {"menu_item_id": self.menu_item.id, "quantity": 1},
            format="json",
        )
        self.assertEqual(add_item.status_code, 200)
        self.assertEqual(add_item.data["item_count"], 1)

        response = self.client.get("/api/v1/cart/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["items"][0]["menu_item_id"], self.menu_item.id)

    def test_admin_bypass_allows_wallet_access_without_device(self):
        admin = create_user(username="notif-admin", role=User.Role.ADMIN, is_staff=True)
        self.client.force_authenticate(admin)

        response = self.client.get("/api/v1/wallet/")

        self.assertEqual(response.status_code, 200)

    def test_checkout_consume_not_gated_for_cashier_without_device(self):
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
            cart_snapshot={
                "item_count": 1,
                "items": [
                    {
                        "menu_item_id": self.menu_item.id,
                        "name": self.menu_item.name,
                        "quantity": 1,
                        "unit_price_amount": self.menu_item.price_amount,
                        "line_total_amount": self.menu_item.price_amount,
                        "sort_order": 1,
                    }
                ],
            },
            expires_at=CheckoutSession.default_expiry(),
        )

        self.client.force_authenticate(self.cashier)
        response = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{session.token}/consume/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
