from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from notifications.models import DeliveryAttempt, Device, Notification
from notifications.services import NotificationService
from notifications.tasks import process_notification_attempts_for_notification_task


class NotificationTaskHardeningTests(TestCase):
    def test_notification_fanout_respects_retry_schedule(self):
        user = User.objects.create_user(username="notif-hardening", password="pass", role=User.Role.CUSTOMER)
        device = Device.objects.create(
            user=user,
            platform="ANDROID",
            fcm_token="tok-hardening",
            permission_granted=True,
            is_active=True,
        )
        notification = Notification.objects.create(
            user=user,
            type=Notification.Type.SYSTEM_BROADCAST,
            title="Ops",
            body="Retry gate",
            status=Notification.Status.PENDING,
        )
        due_attempt = DeliveryAttempt.objects.create(
            notification=notification,
            device=device,
            status=DeliveryAttempt.Status.FAILED,
            retry_count=1,
            retry_at=timezone.now() - timedelta(minutes=1),
        )
        DeliveryAttempt.objects.create(
            notification=notification,
            device=device,
            status=DeliveryAttempt.Status.FAILED,
            retry_count=1,
            retry_at=timezone.now() + timedelta(minutes=10),
        )

        with patch("notifications.tasks.send_notification_attempt_task.delay") as delay_mock:
            result = process_notification_attempts_for_notification_task(notification_id=notification.pk, limit=10)

        self.assertEqual(result["attempt_count"], 1)
        delay_mock.assert_called_once_with(due_attempt.pk)

    @patch("notifications.fcm.send_fcm_message")
    def test_send_attempt_skips_when_retry_window_not_reached(self, send_mock):
        user = User.objects.create_user(username="notif-backoff", password="pass", role=User.Role.CUSTOMER)
        device = Device.objects.create(
            user=user,
            platform="ANDROID",
            fcm_token="tok-backoff",
            permission_granted=True,
            is_active=True,
        )
        notification = Notification.objects.create(
            user=user,
            type=Notification.Type.SYSTEM_BROADCAST,
            title="Ops",
            body="Retry gate",
            status=Notification.Status.PENDING,
        )
        attempt = DeliveryAttempt.objects.create(
            notification=notification,
            device=device,
            status=DeliveryAttempt.Status.FAILED,
            retry_count=1,
            retry_at=timezone.now() + timedelta(minutes=5),
        )

        NotificationService.send_attempt(attempt.pk)

        send_mock.assert_not_called()
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, DeliveryAttempt.Status.FAILED)

    @patch("notifications.tasks.send_notification_attempt_task.delay")
    def test_enqueue_deduplicates_same_attempt_with_cache_gate(self, delay_mock):
        enqueued_first = NotificationService.enqueue_attempt_delivery(42)
        enqueued_second = NotificationService.enqueue_attempt_delivery(42)

        self.assertTrue(enqueued_first)
        self.assertFalse(enqueued_second)
        delay_mock.assert_called_once_with(42)
