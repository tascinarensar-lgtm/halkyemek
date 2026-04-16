from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from notifications.gate import evaluate_notification_readiness
from notifications.models import Device


class WebPushReadinessTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="push-user", password="pass", role=User.Role.CUSTOMER)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_demo_only_device_is_not_treated_as_ready(self):
        Device.objects.create(
            user=self.user,
            platform=Device.Platform.WEB,
            fcm_token="demo-customer-token",
            permission_granted=True,
            is_active=True,
        )

        readiness = evaluate_notification_readiness(user=self.user)

        self.assertFalse(readiness.notification_ready)
        self.assertEqual(readiness.code, "demo_device_only")

    def test_real_web_registration_deactivates_demo_device(self):
        Device.objects.create(
            user=self.user,
            platform=Device.Platform.WEB,
            fcm_token="demo-customer-token",
            permission_granted=True,
            is_active=True,
        )

        response = self.client.post(
            "/api/v1/notifications/devices/",
            {
                "platform": "WEB",
                "fcm_token": "real-fcm-token-123",
                "permission_granted": True,
                "device_id": "browser-device-1",
                "app_version": "frontend-web",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Device.objects.filter(user=self.user, is_active=True).count(), 1)
        self.assertFalse(Device.objects.get(fcm_token="demo-customer-token").is_active)
