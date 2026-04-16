from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from notifications.models import Device

"""
notification gate mantığının doğru çalıştığını doğrulamak.
Yani senin sisteminde şu soru test ediliyor:
“Bu kullanıcı şu anda bildirim almaya hazır mı?”

"""

class NotificationGateTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="u1", password="pass", role=User.Role.CUSTOMER)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_readiness_false_without_device(self):
        resp = self.client.get("/api/v1/notifications/readiness/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["notification_ready"])
        self.assertEqual(resp.data["code"], "no_registered_device")
        self.assertEqual(resp.data["active_permitted_device_count"], 0)

    def test_readiness_true_with_active_permitted_device(self):
        Device.objects.create(
            user=self.user,
            platform="ANDROID",
            fcm_token="tok-123",
            permission_granted=True,
            is_active=True,
        )
        resp = self.client.get("/api/v1/notifications/readiness/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["notification_ready"])
        self.assertEqual(resp.data["code"], "ready")

    def test_readiness_false_when_permission_not_granted(self):
        Device.objects.create(
            user=self.user,
            platform="ANDROID",
            fcm_token="tok-no-perm",
            permission_granted=False,
            is_active=True,
        )
        resp = self.client.get("/api/v1/notifications/readiness/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["notification_ready"])
        self.assertEqual(resp.data["code"], "permission_not_granted")

    def test_readiness_false_when_only_inactive_device_exists(self):
        Device.objects.create(
            user=self.user,
            platform="ANDROID",
            fcm_token="tok-inactive",
            permission_granted=True,
            is_active=False,
        )
        resp = self.client.get("/api/v1/notifications/readiness/")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["notification_ready"])
        self.assertEqual(resp.data["code"], "no_active_device")
