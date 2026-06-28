from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User
from notifications.models import DeliveryAttempt, EmailDeliveryAttempt, Notification
from notifications.tasks import send_admin_email_broadcast_task
from test_support import add_membership, create_business, enable_push_device


EMAIL_BROADCAST_URL = "/api/v1/notifications/admin/email-broadcast/"


def _verified_user(username: str, *, role: str = User.Role.CUSTOMER, email: str | None = None) -> User:
    email = email or f"{username}@example.com"
    return User.objects.create_user(
        username=username,
        password="pass",
        role=role,
        email=email,
        google_email=email,
        google_email_verified=True,
    )


class AdminEmailBroadcastTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin", password="pass", role=User.Role.ADMIN)
        self.customer = _verified_user("customer")

    def test_customer_cannot_use_email_broadcast_endpoint(self):
        self.client.force_authenticate(self.customer)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "Duyuru", "message": "Test"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_admin_can_dry_run_email_broadcast(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "Duyuru", "message": "Test", "dry_run": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["dry_run"])
        self.assertEqual(response.data["estimated_count"], 1)
        self.assertTrue(response.data["broadcast_id"])

    def test_dry_run_does_not_create_notifications_or_email_attempts(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "Duyuru", "message": "Test", "dry_run": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Notification.objects.count(), 0)
        self.assertEqual(EmailDeliveryAttempt.objects.count(), 0)

    def test_unverified_and_blank_google_email_users_are_not_targets(self):
        User.objects.create_user(
            username="unverified",
            password="pass",
            role=User.Role.CUSTOMER,
            google_email="unverified@example.com",
            google_email_verified=False,
        )
        User.objects.create_user(
            username="blank-email",
            password="pass",
            role=User.Role.CUSTOMER,
            google_email="",
            google_email_verified=True,
        )
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "Duyuru", "message": "Test", "dry_run": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["estimated_count"], 1)

    def test_customers_audience_counts_only_customer_role(self):
        _verified_user("ops-user", role=User.Role.ADMIN)
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "Duyuru", "message": "Test", "audience": "CUSTOMERS", "dry_run": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["estimated_count"], 1)

    def test_business_members_and_district_filter_work(self):
        member = _verified_user("business-member")
        other_member = _verified_user("other-member")
        business = create_business(contact_user=member, district="BEYLIKDUZU")
        other_business = create_business(contact_user=other_member, district="ESENYURT")
        add_membership(business=business, user=member)
        add_membership(business=other_business, user=other_member)
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {
                "subject": "Duyuru",
                "message": "Test",
                "audience": "BUSINESS_MEMBERS",
                "district": "BEYLIKDUZU",
                "dry_run": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["estimated_count"], 1)

    def test_subject_and_message_validation(self):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "x" * 161, "message": "Test", "dry_run": True},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "<script></script>", "message": "<script></script>", "dry_run": True},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    @patch("notifications.tasks.send_admin_email_broadcast_task.delay")
    def test_non_dry_run_queues_celery_task(self, delay):
        delay.return_value.id = "task-123"
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "Duyuru", "message": "Test", "dry_run": False},
            format="json",
            HTTP_IDEMPOTENCY_KEY="email-broadcast-test",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["dry_run"])
        self.assertEqual(response.data["task_id"], "task-123")
        delay.assert_called_once()

    @override_settings(EMAIL_NOTIFICATIONS_ENABLED=True)
    @patch("notifications.tasks.send_admin_email_broadcast_task.delay", side_effect=TimeoutError("broker timeout"))
    def test_non_dry_run_returns_503_when_broker_unavailable(self, delay):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "Duyuru", "message": "Test", "dry_run": False},
            format="json",
            HTTP_IDEMPOTENCY_KEY="email-broadcast-fallback-test",
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["error"]["code"], "broadcast_queue_unavailable")
        self.assertEqual(Notification.objects.filter(type=Notification.Type.EMAIL_BROADCAST).count(), 0)
        self.assertEqual(EmailDeliveryAttempt.objects.count(), 0)
        self.assertEqual(DeliveryAttempt.objects.count(), 0)
        delay.assert_called_once()

    @override_settings(EMAIL_NOTIFICATIONS_ENABLED=True, ADMIN_BROADCAST_LOCAL_FALLBACK_ENABLED=True)
    @patch("notifications.services._start_admin_broadcast_local_fallback", return_value="local-email-task")
    @patch("notifications.tasks.send_admin_email_broadcast_task.delay", side_effect=TimeoutError("broker timeout"))
    def test_non_dry_run_uses_local_fallback_when_enabled(self, delay, local_fallback):
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            EMAIL_BROADCAST_URL,
            {"subject": "Duyuru", "message": "Test", "dry_run": False},
            format="json",
            HTTP_IDEMPOTENCY_KEY="email-broadcast-local-fallback-test",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["dry_run"])
        self.assertEqual(response.data["task_id"], "local-email-task")
        delay.assert_called_once()
        local_fallback.assert_called_once()

    @override_settings(EMAIL_NOTIFICATIONS_ENABLED=True)
    def test_task_creates_email_only_notifications_with_dedupe(self):
        enable_push_device(user=self.customer)

        result = send_admin_email_broadcast_task(
            broadcast_id="broadcast-1",
            subject="Duyuru",
            message="Test",
            audience="ALL",
            district="",
            batch_size=100,
        )
        second = send_admin_email_broadcast_task(
            broadcast_id="broadcast-1",
            subject="Duyuru",
            message="Test",
            audience="ALL",
            district="",
            batch_size=100,
        )

        self.assertEqual(result["queued"], 1)
        self.assertEqual(second["queued"], 0)
        self.assertEqual(second["skipped_duplicate"], 1)
        self.assertEqual(Notification.objects.filter(type=Notification.Type.EMAIL_BROADCAST).count(), 1)
        self.assertEqual(EmailDeliveryAttempt.objects.count(), 1)
        self.assertEqual(DeliveryAttempt.objects.count(), 0)
