from django.test import TestCase, override_settings
from unittest.mock import patch
from rest_framework.test import APIClient

from accounts.models import User
from notifications.models import DeliveryAttempt, Device, Notification
from notifications.services import SystemBroadcastService


class AdminBroadcastPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin", password="pass", role=User.Role.ADMIN)
        self.customer = User.objects.create_user(username="customer", password="pass", role=User.Role.CUSTOMER)

    def test_customer_cannot_use_admin_broadcast_endpoint(self):
        self.client.force_authenticate(self.customer)
        response = self.client.post(
            "/api/v1/notifications/admin/broadcast/",
            {"title": "Duyuru", "body": "Test"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_system_broadcast_estimate_counts_only_active_push_devices(self):
        Device.objects.create(user=self.customer, platform="WEB", fcm_token="active-token", permission_granted=True, is_active=True)
        no_device_user = User.objects.create_user(username="no-device", password="pass", role=User.Role.CUSTOMER)
        Device.objects.create(user=no_device_user, platform="WEB", fcm_token="inactive-token", permission_granted=True, is_active=False)

        self.assertEqual(SystemBroadcastService.estimate_recipients(), 1)

    @patch("notifications.tasks.send_admin_system_broadcast_task.delay")
    def test_admin_can_use_admin_broadcast_endpoint(self, delay):
        delay.return_value.id = "system-task-123"
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/notifications/admin/broadcast/",
            {"title": "Duyuru", "body": "Test"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("queued", response.data)
        self.assertEqual(response.data["task_id"], "system-task-123")
        self.assertTrue(response.data["queued_async"])
        delay.assert_called_once()

    @patch("notifications.tasks.send_admin_system_broadcast_task.delay", side_effect=TimeoutError("broker timeout"))
    def test_admin_broadcast_returns_503_when_broker_unavailable(self, delay):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            "/api/v1/notifications/admin/broadcast/",
            {"title": "Duyuru", "body": "Test"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="system-broadcast-test",
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["error"]["code"], "broadcast_queue_unavailable")
        self.assertEqual(Notification.objects.filter(type=Notification.Type.SYSTEM_BROADCAST).count(), 0)
        self.assertEqual(DeliveryAttempt.objects.count(), 0)
        delay.assert_called_once()

    @override_settings(ADMIN_BROADCAST_LOCAL_FALLBACK_ENABLED=True)
    @patch("notifications.services._start_admin_broadcast_local_fallback", return_value="local-system-task")
    @patch("notifications.tasks.send_admin_system_broadcast_task.delay", side_effect=TimeoutError("broker timeout"))
    def test_admin_broadcast_uses_local_fallback_when_enabled(self, delay, local_fallback):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            "/api/v1/notifications/admin/broadcast/",
            {"title": "Duyuru", "body": "Test"},
            format="json",
            HTTP_IDEMPOTENCY_KEY="system-broadcast-local-fallback-test",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["task_id"], "local-system-task")
        self.assertTrue(response.data["queued_async"])
        delay.assert_called_once()
        local_fallback.assert_called_once()
