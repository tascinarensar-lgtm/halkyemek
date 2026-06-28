from django.test import TestCase
from django.test import override_settings
from django.core import mail

from accounts.models import User
from notifications.models import Device, EmailDeliveryAttempt, Notification, DeliveryAttempt
from notifications.services import NotificationService

"""
Bu test dosyası NotificationService.enqueue() fonksiyonunun doğru çalıştığını doğrulamak için yazılmıştır.
Yani testler şu iki kritik özelliği kontrol ediyor:

enqueue çağrıldığında gerçekten bildirim oluşuyor mu? 2 Aynı bildirim tekrar enqueue edilirse idempotent davranıyor mu (duplicate oluşturmuyor mu)?
"""

class NotificationEnqueueTests(TestCase):
    def test_enqueue_creates_attempts_for_active_devices(self):
        user = User.objects.create_user(username="u1", password="pass", role=User.Role.CUSTOMER)
        Device.objects.create(
            user=user,
            platform="ANDROID",
            fcm_token="tok1",
            permission_granted=True,
            is_active=True,
        )
        notif = NotificationService.enqueue(
            user=user,
            type=Notification.Type.ORDER_PAID,
            title="Ödeme alındı",
            body="Tamam",
            payload={"x": 1},
            dedupe_key="d1",
        )
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(DeliveryAttempt.objects.filter(notification=notif).count(), 1)

    def test_enqueue_is_idempotent_by_dedupe_key(self):
        user = User.objects.create_user(username="u2", password="pass", role=User.Role.CUSTOMER)
        Device.objects.create(
            user=user,
            platform="ANDROID",
            fcm_token="tok2",
            permission_granted=True,
            is_active=True,
        )

        NotificationService.enqueue(
            user=user,
            type=Notification.Type.ORDER_PAID,
            title="Ödeme alındı",
            body="Tamam",
            payload={},
            dedupe_key="same-key",
        )
        NotificationService.enqueue(
            user=user,
            type=Notification.Type.ORDER_PAID,
            title="Ödeme alındı",
            body="Tamam",
            payload={},
            dedupe_key="same-key",
        )

        self.assertEqual(Notification.objects.count(), 1)

    def test_enqueue_without_dedupe_key_creates_distinct_notifications(self):
        user = User.objects.create_user(username="u3", password="pass", role=User.Role.CUSTOMER)
        Device.objects.create(
            user=user,
            platform="ANDROID",
            fcm_token="tok3",
            permission_granted=True,
            is_active=True,
        )

        first = NotificationService.enqueue(
            user=user,
            type=Notification.Type.SYSTEM_BROADCAST,
            title="Duyuru",
            body="Bir",
            payload={},
        )
        second = NotificationService.enqueue(
            user=user,
            type=Notification.Type.SYSTEM_BROADCAST,
            title="Duyuru",
            body="İki",
            payload={},
        )

        self.assertNotEqual(first.id, second.id)
        self.assertEqual(Notification.objects.count(), 2)
        self.assertEqual(DeliveryAttempt.objects.count(), 2)

    @override_settings(EMAIL_NOTIFICATIONS_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
    def test_enqueue_creates_email_attempt_for_verified_google_email(self):
        user = User.objects.create_user(
            username="u4",
            password="pass",
            role=User.Role.CUSTOMER,
            google_email="customer@example.com",
            google_email_verified=True,
        )

        notif = NotificationService.enqueue(
            user=user,
            type=Notification.Type.SYSTEM_BROADCAST,
            title="Duyuru",
            body="Yeni bildirim",
            payload={"url": "/bildirimler"},
            dedupe_key="email-key",
        )

        attempt = EmailDeliveryAttempt.objects.get(notification=notif)
        self.assertEqual(attempt.email_to, "customer@example.com")

        NotificationService.send_email_attempt(attempt.id)
        attempt.refresh_from_db()
        notif.refresh_from_db()

        self.assertEqual(attempt.status, EmailDeliveryAttempt.Status.SENT)
        self.assertEqual(notif.status, Notification.Status.SENT)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["customer@example.com"])

    @override_settings(EMAIL_NOTIFICATIONS_ENABLED=True)
    def test_enqueue_skips_email_attempt_for_unverified_google_email(self):
        user = User.objects.create_user(
            username="u5",
            password="pass",
            role=User.Role.CUSTOMER,
            google_email="unverified@example.com",
            google_email_verified=False,
        )

        NotificationService.enqueue(
            user=user,
            type=Notification.Type.SYSTEM_BROADCAST,
            title="Duyuru",
            body="Yeni bildirim",
            payload={},
            dedupe_key="email-unverified",
        )

        self.assertEqual(EmailDeliveryAttempt.objects.count(), 0)
