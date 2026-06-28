from __future__ import annotations

from io import StringIO

from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings


class SendTestEmailCommandTests(SimpleTestCase):
    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
        NOTIFICATION_EMAIL_FROM="HalkYemek <bildirim@example.com>",
    )
    def test_command_sends_with_dev_backend_when_explicitly_allowed(self) -> None:
        out = StringIO()

        call_command(
            "send_test_email",
            "--to",
            "ops@example.com",
            "--allow-dev-backend",
            stdout=out,
        )

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["ops@example.com"])
        self.assertIn("Test email sent to ops@example.com", out.getvalue())

    @override_settings(
        EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend",
        NOTIFICATION_EMAIL_FROM="HalkYemek <bildirim@example.com>",
    )
    def test_command_rejects_dev_backend_by_default(self) -> None:
        with self.assertRaises(CommandError) as exc:
            call_command("send_test_email", "--to", "ops@example.com")

        self.assertIn("EMAIL_BACKEND is not a real delivery backend", str(exc.exception))
