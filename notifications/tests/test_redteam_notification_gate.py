from django.test import TestCase
from rest_framework.test import APIClient

from notifications.models import Device
from orders.services_cart import CartService
from test_support import create_business, create_category, create_menu_item, create_user, seed_wallet


class NotificationGateRedTeamTests(TestCase):
    def setUp(self):
        self.user = create_user(username="u1")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.business = create_business(name="Biz")
        self.category = create_category(business=self.business, name="Main")
        self.menu_item = create_menu_item(business=self.business, category=self.category, price_amount=2000)
        seed_wallet(user=self.user, amount=5000)
        CartService.add_item(user=self.user, menu_item=self.menu_item, quantity=1)

    def test_notification_readiness_reports_false_without_active_permitted_device(self):
        resp = self.client.get("/api/v1/notifications/readiness/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["notification_ready"], False)

    def test_checkout_session_creation_is_not_blocked_without_push_device(self):
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="notif-gate-create",
        )
        self.assertEqual(resp.status_code, 201)

    def test_checkout_session_creation_still_succeeds_with_active_permitted_device(self):
        Device.objects.create(
            user=self.user,
            platform=Device.Platform.ANDROID,
            fcm_token="tok-redteam-create-1",
            permission_granted=True,
            is_active=True,
        )
        resp = self.client.post(
            "/api/v1/checkout-sessions/",
            {},
            format="json",
            HTTP_IDEMPOTENCY_KEY="notif-gate-create-allowed",
        )
        self.assertEqual(resp.status_code, 201)

    def test_notification_readiness_turns_true_with_active_permitted_device(self):
        Device.objects.create(
            user=self.user,
            platform=Device.Platform.ANDROID,
            fcm_token="tok-redteam-1",
            permission_granted=True,
            is_active=True,
        )
        resp = self.client.get("/api/v1/notifications/readiness/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["notification_ready"], True)
