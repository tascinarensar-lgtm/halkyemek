from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import User
from notifications.models import EmailDeliveryAttempt, Notification
from notifications.services import UserReminderService
from notifications.tasks import send_user_reminder_emails_task
from orders.models import Order
from test_support import create_business, create_menu_item


def _verified_user(username: str) -> User:
    return User.objects.create_user(
        username=username,
        password="pass",
        role=User.Role.CUSTOMER,
        google_email=f"{username}@example.com",
        google_email_verified=True,
    )


def _order_for_user(*, user: User, created_at, paid_at=None, used_at=None) -> Order:
    business = create_business(contact_user=user)
    menu = create_menu_item(business=business)
    order = Order.objects.create(
        user=user,
        business=business,
        menu=menu,
        amount=menu.price_amount,
        subtotal_amount=menu.price_amount,
        total_charged_amount=menu.price_amount,
        business_net_amount=menu.price_amount,
        status=Order.Status.USED if used_at else Order.Status.PAID,
        qr_token=f"qr-{user.username}",
        paid_at=paid_at,
        used_at=used_at,
    )
    Order.objects.filter(pk=order.pk).update(created_at=created_at)
    order.refresh_from_db()
    return order


@override_settings(
    EMAIL_NOTIFICATIONS_ENABLED=True,
    USER_REMINDER_EMAILS_ENABLED=True,
    USER_REMINDER_INTERVAL_DAYS=5,
    USER_REMINDER_BATCH_SIZE=100,
)
class UserReminderServiceTests(TestCase):
    def test_verified_google_user_without_order_receives_reminder(self):
        user = _verified_user("inactive")

        count = UserReminderService.enqueue_due_reminders()

        self.assertEqual(count, 1)
        notification = Notification.objects.get(user=user)
        self.assertEqual(notification.type, Notification.Type.USER_REMINDER)
        self.assertTrue(notification.dedupe_key.startswith(f"user-reminder:{user.pk}:"))
        self.assertEqual(EmailDeliveryAttempt.objects.get(notification=notification).email_to, user.google_email)

    def test_recent_order_activity_skips_user(self):
        user = _verified_user("recent")
        now = timezone.now()
        _order_for_user(
            user=user,
            created_at=now - timedelta(days=10),
            paid_at=now - timedelta(days=10),
            used_at=now - timedelta(days=1),
        )

        count = UserReminderService.enqueue_due_reminders()

        self.assertEqual(count, 0)
        self.assertEqual(Notification.objects.count(), 0)
        self.assertEqual(EmailDeliveryAttempt.objects.count(), 0)

    def test_old_order_activity_receives_reminder(self):
        user = _verified_user("old")
        now = timezone.now()
        _order_for_user(
            user=user,
            created_at=now - timedelta(days=9),
            paid_at=now - timedelta(days=6),
            used_at=None,
        )

        count = UserReminderService.enqueue_due_reminders()

        self.assertEqual(count, 1)
        self.assertEqual(Notification.objects.filter(user=user, type=Notification.Type.USER_REMINDER).count(), 1)

    def test_unverified_google_email_is_skipped(self):
        User.objects.create_user(
            username="unverified",
            password="pass",
            role=User.Role.CUSTOMER,
            google_email="unverified@example.com",
            google_email_verified=False,
        )

        count = UserReminderService.enqueue_due_reminders()

        self.assertEqual(count, 0)
        self.assertEqual(Notification.objects.count(), 0)
        self.assertEqual(EmailDeliveryAttempt.objects.count(), 0)

    def test_recent_reminder_is_not_sent_again(self):
        user = _verified_user("dedupe")

        first = UserReminderService.enqueue_due_reminders()
        second = UserReminderService.enqueue_due_reminders()

        self.assertEqual(first, 1)
        self.assertEqual(second, 0)
        self.assertEqual(Notification.objects.filter(user=user, type=Notification.Type.USER_REMINDER).count(), 1)

    def test_task_uses_batch_limit(self):
        _verified_user("task-user")

        result = send_user_reminder_emails_task(limit=100)

        self.assertEqual(result["reminder_count"], 1)
        self.assertEqual(result["limit"], 100)
