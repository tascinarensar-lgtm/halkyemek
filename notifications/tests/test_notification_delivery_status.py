from django.test import TestCase
from unittest.mock import patch

from accounts.models import User
from notifications.models import DeliveryAttempt, Device, Notification
from notifications.services import NotificationService


class NotificationDeliveryStatusTests(TestCase):
    def test_notification_becomes_sent_if_any_device_succeeds(self):
        user = User.objects.create_user(username="multi", password="pass", role=User.Role.CUSTOMER)
        Device.objects.create(user=user, platform="ANDROID", fcm_token="tok-ok", permission_granted=True, is_active=True)
        Device.objects.create(user=user, platform="ANDROID", fcm_token="tok-fail", permission_granted=True, is_active=True)

        notification = NotificationService.enqueue(
            user=user,
            type=Notification.Type.ORDER_PAID,
            title="Ödeme",
            body="Tamam",
            payload={},
            dedupe_key="multi-device",
        )

        attempts = list(notification.attempts.select_related("device").order_by("id"))
        self.assertEqual(len(attempts), 2)

        def fake_send(*, token, title, body, data):
            if token == "tok-fail":
                raise RuntimeError("temporary-failure")
            return {"name": "projects/test/messages/1"}

        with patch("notifications.fcm.send_fcm_message", side_effect=fake_send):
            for attempt in attempts:
                NotificationService.send_attempt(attempt.id)

        notification.refresh_from_db()
        self.assertEqual(notification.status, Notification.Status.SENT)
        self.assertEqual(notification.attempts.filter(status=DeliveryAttempt.Status.SENT).count(), 1)
        self.assertEqual(notification.attempts.filter(status=DeliveryAttempt.Status.FAILED).count(), 1)

    def test_invalid_fcm_registration_token_disables_device_immediately(self):
        user = User.objects.create_user(username="invalid-token", password="pass", role=User.Role.CUSTOMER)
        device = Device.objects.create(user=user, platform="WEB", fcm_token="bad-token", permission_granted=True, is_active=True)
        notification = NotificationService.enqueue(
            user=user,
            type=Notification.Type.SYSTEM_BROADCAST,
            title="Duyuru",
            body="Test",
            payload={},
            dedupe_key="invalid-token-broadcast",
        )
        attempt = notification.attempts.get()

        with patch(
            "notifications.fcm.send_fcm_message",
            side_effect=RuntimeError("FCM gönderimi reddedildi (400): INVALID_ARGUMENT: The registration token is not a valid FCM registration token"),
        ):
            NotificationService.send_attempt(attempt.id)

        attempt.refresh_from_db()
        device.refresh_from_db()
        self.assertEqual(attempt.status, DeliveryAttempt.Status.FAILED)
        self.assertEqual(attempt.retry_count, NotificationService.MAX_RETRY_COUNT)
        self.assertFalse(device.is_active)
        self.assertIn("auto-disabled-invalid-token", device.last_error)
