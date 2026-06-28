from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from businesses.models import BusinessMember
from menus.models import BusinessOffer
from orders.services_cart import CartService
from orders.models import CheckoutSession, Order
from test_support import (
    add_membership,
    create_business,
    create_category,
    create_menu_item,
    create_user,
    enable_push_device,
    seed_wallet,
)


class BusinessOperationsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_user(username="ops-admin", role="ADMIN", is_staff=True)
        self.owner = create_user(username="ops-owner")
        self.manager = create_user(username="ops-manager")
        self.cashier = create_user(username="ops-cashier")
        self.outsider = create_user(username="ops-outsider")
        self.customer = create_user(username="ops-customer")

        self.business = create_business(name="Ops Biz")
        self.other_business = create_business(name="Ops Other Biz")

        add_membership(business=self.business, user=self.owner, role=BusinessMember.Role.OWNER)
        add_membership(business=self.business, user=self.manager, role=BusinessMember.Role.MANAGER)
        add_membership(business=self.business, user=self.cashier, role=BusinessMember.Role.CASHIER)
        add_membership(business=self.other_business, user=self.outsider, role=BusinessMember.Role.CASHIER)

        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=1500)

        seed_wallet(user=self.customer, amount=10000)
        enable_push_device(user=self.customer)
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)

        self.order = self._consume_order()

    def _consume_order(self):
        self.client.force_authenticate(self.customer)
        create_resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="ops-biz-checkout-create",
        )
        self.assertEqual(create_resp.status_code, 201)
        token = create_resp.data["token"]

        self.client.force_authenticate(self.cashier)
        consume_resp = self.client.post(
            f"/api/v1/businesses/{self.business.id}/checkout-sessions/{token}/consume/",
            {},
            format="json",
        )
        self.assertEqual(consume_resp.status_code, 200)
        return Order.objects.get(id=consume_resp.data["order_id"])

    def test_dashboard_access_and_role_aware_finance_payload(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.get(f"/api/v1/businesses/{self.business.id}/operations/dashboard-summary/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["business"]["member_role"], BusinessMember.Role.CASHIER)
        self.assertNotIn("outstanding_net_amount", response.data["data"]["finance"]["earning"])

    def test_dashboard_pending_qr_excludes_expired_and_cancelled_sessions(self):
        CartService.add_item(user=self.customer, menu_item=self.menu_item, quantity=1)
        self.client.force_authenticate(self.customer)
        active_resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="ops-biz-active-checkout-create",
        )
        self.assertEqual(active_resp.status_code, 201)
        active_session = CheckoutSession.objects.get(token=active_resp.data["token"])

        expired_session = CheckoutSession.objects.create(
            user=self.customer,
            business=self.business,
            cart=active_session.cart,
            token=CheckoutSession.generate_token(),
            cashier_code=CheckoutSession.generate_cashier_code(),
            status=CheckoutSession.Status.PENDING,
            amount=active_session.amount,
            subtotal_amount=active_session.subtotal_amount,
            customer_fee_amount=active_session.customer_fee_amount,
            business_fee_amount=active_session.business_fee_amount,
            business_net_amount=active_session.business_net_amount,
            platform_total_fee_amount=active_session.platform_total_fee_amount,
            item_count=active_session.item_count,
            currency=active_session.currency,
            business_name=active_session.business_name,
            pricing_snapshot=active_session.pricing_snapshot,
            cart_snapshot=active_session.cart_snapshot,
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        cancelled_session = CheckoutSession.objects.create(
            user=self.customer,
            business=self.business,
            cart=active_session.cart,
            token=CheckoutSession.generate_token(),
            cashier_code=CheckoutSession.generate_cashier_code(),
            status=CheckoutSession.Status.CANCELLED,
            amount=active_session.amount,
            subtotal_amount=active_session.subtotal_amount,
            customer_fee_amount=active_session.customer_fee_amount,
            business_fee_amount=active_session.business_fee_amount,
            business_net_amount=active_session.business_net_amount,
            platform_total_fee_amount=active_session.platform_total_fee_amount,
            item_count=active_session.item_count,
            currency=active_session.currency,
            business_name=active_session.business_name,
            pricing_snapshot=active_session.pricing_snapshot,
            cart_snapshot=active_session.cart_snapshot,
            expires_at=timezone.now() + timedelta(minutes=10),
            cancelled_at=timezone.now(),
        )

        self.client.force_authenticate(self.cashier)
        response = self.client.get(f"/api/v1/businesses/{self.business.id}/operations/dashboard-summary/")

        self.assertEqual(response.status_code, 200)
        tokens = {item["token"] for item in response.data["data"]["sessions"]["pending"]}
        self.assertIn(active_session.token, tokens)
        self.assertNotIn(expired_session.token, tokens)
        self.assertNotIn(cancelled_session.token, tokens)
        self.assertTrue(response.data["data"]["sessions"]["pending"][0]["cashier_code"])

    def test_dashboard_rejects_non_member(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.get(f"/api/v1/businesses/{self.business.id}/operations/dashboard-summary/")
        self.assertEqual(response.status_code, 403)

    def test_consume_history_scoped_to_authorized_business(self):
        self.client.force_authenticate(self.cashier)
        response = self.client.get(f"/api/v1/businesses/{self.business.id}/operations/consume-history/")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["order"]["id"], self.order.id)

        self.client.force_authenticate(self.outsider)
        forbidden = self.client.get(f"/api/v1/businesses/{self.business.id}/operations/consume-history/")
        self.assertEqual(forbidden.status_code, 403)

    def test_business_order_detail_scoping(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(f"/api/v1/businesses/{self.business.id}/operations/orders/{self.order.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["id"], self.order.id)

        self.client.force_authenticate(self.outsider)
        forbidden = self.client.get(f"/api/v1/businesses/{self.business.id}/operations/orders/{self.order.id}/")
        self.assertEqual(forbidden.status_code, 403)

    def test_business_profile_patch_role_boundaries(self):
        self.client.force_authenticate(self.manager)
        response = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/operations/profile/",
            {"short_description": "Yeni aciklama"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        forbidden = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/operations/profile/",
            {"listing_type": "VOLUNTEER"},
            format="json",
        )
        self.assertEqual(forbidden.status_code, 403)

        self.client.force_authenticate(self.admin)
        admin_response = self.client.patch(
            f"/api/v1/businesses/{self.business.id}/operations/profile/",
            {"listing_type": "VOLUNTEER", "is_featured": True},
            format="json",
        )
        self.assertEqual(admin_response.status_code, 200)

    def test_offer_management_permission_matrix(self):
        payload = {
            "title": "Ogle Menusu",
            "menu_item": self.menu_item.id,
            "offer_price_amount": 1300,
            "starts_at": timezone.now().isoformat(),
            "ends_at": (timezone.now() + timedelta(hours=2)).isoformat(),
        }

        self.client.force_authenticate(self.cashier)
        forbidden = self.client.post(
            f"/api/v1/businesses/{self.business.id}/offers/",
            payload,
            format="json",
        )
        self.assertEqual(forbidden.status_code, 403)

        self.client.force_authenticate(self.owner)
        created = self.client.post(
            f"/api/v1/businesses/{self.business.id}/offers/",
            payload,
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(BusinessOffer.objects.filter(business=self.business).count(), 1)
