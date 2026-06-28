from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError


DEV_EMAIL_BACKENDS = (
    "django.core.mail.backends.console.EmailBackend",
    "django.core.mail.backends.locmem.EmailBackend",
    "django.core.mail.backends.dummy.EmailBackend",
    "django.core.mail.backends.filebased.EmailBackend",
)


class Command(BaseCommand):
    help = "Send a one-off operational test email using the configured email backend."

    def add_arguments(self, parser):
        parser.add_argument("--to", required=True, help="Recipient email address for the test.")
        parser.add_argument(
            "--subject",
            default="HalkYemek e-posta testi",
            help="Email subject.",
        )
        parser.add_argument(
            "--message",
            default="HalkYemek e-posta bildirim altyapisi calisiyor.",
            help="Plain text email body.",
        )
        parser.add_argument(
            "--allow-dev-backend",
            action="store_true",
            help="Allow console/locmem/dummy/file backends for local verification.",
        )

    def handle(self, *args, **options):
        recipient = str(options["to"] or "").strip()
        if not recipient or "@" not in recipient:
            raise CommandError("--to must be a valid email address")

        backend = str(getattr(settings, "EMAIL_BACKEND", "") or "")
        if backend in DEV_EMAIL_BACKENDS and not options["allow_dev_backend"]:
            raise CommandError(
                "EMAIL_BACKEND is not a real delivery backend. Configure SMTP/provider settings "
                "or pass --allow-dev-backend for local-only verification."
            )

        from_email = str(
            getattr(settings, "NOTIFICATION_EMAIL_FROM", "")
            or getattr(settings, "DEFAULT_FROM_EMAIL", "")
            or ""
        ).strip()
        if not from_email:
            raise CommandError("NOTIFICATION_EMAIL_FROM or DEFAULT_FROM_EMAIL must be configured")

        sent_count = send_mail(
            subject=str(options["subject"]),
            message=str(options["message"]),
            from_email=from_email,
            recipient_list=[recipient],
            fail_silently=False,
        )
        if sent_count != 1:
            raise CommandError(f"Email backend reported sent_count={sent_count}")

        self.stdout.write(self.style.SUCCESS(f"Test email sent to {recipient} via {backend}"))
