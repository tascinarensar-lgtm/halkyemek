from django.test import TestCase
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from orders.services_cart import CartService
from orders.models import CheckoutSession
from test_support import add_membership, create_business, create_category, create_menu_item, create_user, enable_push_device, expired_time, seed_wallet


class CheckoutConsumePreviewApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer = create_user(username="preview-customer")
        self.cashier = create_user(username="preview-cashier")
        self.business = create_business(name="Preview Biz")
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=1800)
        seed_wallet(user=self.customer, amount=10000)
        enable_push_device(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

    def _create_session_token(self, idem_key: str) -> str:
        self.client.force_authenticate(self.customer)
        response = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY=idem_key,
        )
        self.assertEqual(response.status_code, 201)
        return response.data["token"]

    def test_preview_returns_consumable_true_for_valid_session(self):
        token = self._create_session_token("preview-valid")
        self.client.force_authenticate(self.cashier)

        response = self.client.get(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/preview/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["can_consume"])
        self.assertEqual(response.data["failure_reason"], "")
        self.assertTrue(response.data["cashier_code"])

    def test_lookup_returns_preview_for_cashier_code(self):
        token = self._create_session_token("preview-lookup")
        session = CheckoutSession.objects.get(token=token)

        self.client.force_authenticate(self.cashier)
        response = self.client.get(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/lookup/",
            {"query": session.cashier_code},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["token"], token)
        self.assertEqual(response.data["cashier_code"], session.cashier_code)

    def test_lookup_requires_non_empty_query(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.get(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/lookup/",
            {"query": ""},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "checkout_session_lookup_invalid")

    def test_preview_returns_duplicate_reason_after_consume(self):
        token = self._create_session_token("preview-duplicate")

        self.client.force_authenticate(self.cashier)
        first_consume = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )
        self.assertEqual(first_consume.status_code, 200)

        preview = self.client.get(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/preview/"
        )
        self.assertEqual(preview.status_code, 200)
        self.assertFalse(preview.data["can_consume"])
        self.assertEqual(preview.data["failure_reason"], "already_consumed")
        self.assertEqual(preview.data["existing_order_id"], first_consume.data["order_id"])

    def test_preview_returns_expired_reason(self):
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
            expires_at=expired_time(),
        )

        self.client.force_authenticate(self.cashier)
        response = self.client.get(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{session.token}/preview/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["can_consume"])
        self.assertEqual(response.data["failure_reason"], "expired")

    def test_preview_invalid_token_returns_not_found_error_code(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.get(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/does-not-exist/preview/"
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "checkout_session_not_found")
