from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase


class ProcessNotificationsCommandTests(TestCase):
    @patch("notifications.management.commands.process_notifications.NotificationService.enqueue_due_attempts")
    def test_process_notifications_uses_canonical_enqueue_method(self, enqueue_mock):
        enqueue_mock.return_value = 3
        stdout = StringIO()

        call_command("process_notifications", "--limit", "25", "--worker", "test-suite", stdout=stdout)

        enqueue_mock.assert_called_once_with(limit=25)
        self.assertIn("Processed notification attempts: 3", stdout.getvalue())
