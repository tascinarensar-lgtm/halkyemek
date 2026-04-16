from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from common.throttles import DeviceUpsertThrottle
from notifications.models import Device
"""
Bu testin amacı device registration (cihaz kaydı) endpoint’inin doğru çalıştığını doğrulamaktır.
Yani mobil uygulama backend’e FCM token gönderdiğinde gerçekten Device kaydı oluşuyor mu bunu test eder.
Bu endpoint mobil uygulamaların push bildirim alabilmesi için en kritik endpointlerden biridir.
"""

class DeviceUpsertTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="u1", password="pass", role=User.Role.CUSTOMER)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_device_upsert(self):
        resp = self.client.post(
            "/api/v1/notifications/devices/",
            {
                "platform": "ANDROID",
                "fcm_token": "tok-abc",
                "permission_granted": True,
                "device_id": "dev1",
                "app_version": "1.0.0",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(Device.objects.count(), 1)
        self.assertIn("notification_readiness", resp.data)

    def test_token_rotation_deactivates_previous_device_on_same_device_id(self):
        first = self.client.post(
            "/api/v1/notifications/devices/",
            {
                "platform": "ANDROID",
                "fcm_token": "tok-rotation-1",
                "permission_granted": True,
                "device_id": "same-device",
                "app_version": "1.0.0",
            },
            format="json",
        )
        self.assertEqual(first.status_code, 200)

        second = self.client.post(
            "/api/v1/notifications/devices/",
            {
                "platform": "ANDROID",
                "fcm_token": "tok-rotation-2",
                "permission_granted": True,
                "device_id": "same-device",
                "app_version": "1.0.1",
            },
            format="json",
        )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data["token_rotated_deactivated_count"], 1)
        self.assertEqual(Device.objects.filter(user=self.user, is_active=True).count(), 1)

    def test_device_upsert_throttle_is_enforced(self):
        payload = {
            "platform": "ANDROID",
            "fcm_token": "tok-throttle-abc",
            "permission_granted": True,
            "device_id": "dev-thr",
            "app_version": "1.0.0",
        }

        with patch.object(DeviceUpsertThrottle, "rate", "1/min", create=True):
            first = self.client.post("/api/v1/notifications/devices/", payload, format="json")
            second = self.client.post(
                "/api/v1/notifications/devices/",
                {**payload, "fcm_token": "tok-throttle-def"},
                format="json",
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)

    def tearDown(self):
        if hasattr(DeviceUpsertThrottle, "rate"):
            DeviceUpsertThrottle.rate = None
        cache.clear()
