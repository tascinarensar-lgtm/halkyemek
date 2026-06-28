from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from django.test import SimpleTestCase, override_settings
from django.core.management.base import CommandError

from common.management.commands.validate_env_examples import Command


class ValidateEnvExamplesCommandTests(SimpleTestCase):
    def setUp(self) -> None:
        self.command = Command()
        self.temp_dir = Path(tempfile.mkdtemp(prefix="env-examples-"))
        self.addCleanup(lambda: shutil.rmtree(self.temp_dir, ignore_errors=True))

        env_example = self.temp_dir / ".env.example"
        staging_example = self.temp_dir / ".env.staging.example"
        prod_example = self.temp_dir / ".env.prod.example"

        base_content = """APP_NAME=halkyemek
APP_ENV=staging
RELEASE_VERSION=2026.04.02-rc1
DEBUG=0
DJANGO_SECRET_KEY=change-me-long-random-secret
ALLOWED_HOSTS=api.example.com
CSRF_TRUSTED_ORIGINS=https://api.example.com
CORS_ALLOWED_ORIGINS=https://app.example.com
CANONICAL_API_BASE_URL=https://api.example.com
FRONTEND_APP_URL=https://app.example.com
STATIC_URL=/static/
STATIC_ROOT=/app/staticfiles
MEDIA_URL=/media/
MEDIA_ROOT=/app/media
MEDIA_ASSET_MAX_BYTES=8388608
DATABASE_URL=postgres://user:pass@db:5432/app
REDIS_CACHE_URL=redis://redis:6379/1
GOOGLE_OAUTH_CLIENT_ID=client-id
FCM_PROJECT_ID=project
FCM_CLIENT_EMAIL=bot@example.com
FCM_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----
FCM_WEB_VAPID_KEY=vapid-key
EMAIL_NOTIFICATIONS_ENABLED=False
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_HOST_USER=
EMAIL_HOST_PASSWORD=
EMAIL_USE_TLS=True
EMAIL_USE_SSL=False
DEFAULT_FROM_EMAIL=HalkYemek <bildirim@example.com>
NOTIFICATION_EMAIL_FROM=HalkYemek <bildirim@example.com>
NOTIFICATION_EMAIL_REQUIRE_VERIFIED_GOOGLE=True
TOPUP_PROVIDER=manual
MANUAL_TOPUP_ACCOUNT_NAME=HalkYemek
MANUAL_TOPUP_IBAN=
MANUAL_TOPUP_INSTRUCTIONS=Odeme aciklamasina yukleme referansini yazin.
IYZICO_API_KEY=api-key
IYZICO_SECRET_KEY=secret-key
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
IYZICO_ENV=sandbox
PAYMENT_WEBHOOK_SECRET=secret
METRICS_TOKEN=metrics-secret
TRUST_X_FORWARDED_FOR=True
TRUSTED_PROXY_IPS=10.0.0.0/8
CELERY_BROKER_URL=redis://redis:6379/1
CELERY_RESULT_BACKEND=redis://redis:6379/1
RUN_DB_MIGRATIONS=False
RUN_COLLECTSTATIC=False
RUN_FINAL_PREFLIGHT=False
RUN_VALIDATE_ENV_EXAMPLES=False
FINAL_PREFLIGHT_FAIL_ON_LOCK_SKIP=False
RUN_BOOTSTRAP_MARKETPLACE=False
RUN_VERIFY_BOOTSTRAP_MARKETPLACE=False
BOOTSTRAP_MARKETPLACE_DISTRICT=BEYLIKDUZU
GUNICORN_FORWARDED_ALLOW_IPS=127.0.0.1
STRICT_READINESS_RETRIES=24
STRICT_READINESS_INTERVAL_SECONDS=10
"""
        env_example.write_text(base_content, encoding="utf-8")
        staging_example.write_text(base_content, encoding="utf-8")
        prod_example.write_text(base_content.replace("APP_ENV=staging", "APP_ENV=prod"), encoding="utf-8")


    def test_command_accepts_consistent_env_examples(self) -> None:
        with override_settings(BASE_DIR=self.temp_dir):
            self.command.handle()

    def test_command_rejects_duplicate_keys(self) -> None:
        target = self.temp_dir / ".env.prod.example"
        target.write_text(target.read_text(encoding="utf-8") + "APP_NAME=duplicate\n", encoding="utf-8")
        with override_settings(BASE_DIR=self.temp_dir):
            with self.assertRaises(CommandError) as exc:
                self.command.handle()
        self.assertIn("duplicates env key: APP_NAME", str(exc.exception))

    def test_command_rejects_missing_required_key(self) -> None:
        target = self.temp_dir / ".env.staging.example"
        content = target.read_text(encoding="utf-8").replace("RUN_VERIFY_BOOTSTRAP_MARKETPLACE=False\n", "")
        target.write_text(content, encoding="utf-8")
        with override_settings(BASE_DIR=self.temp_dir):
            with self.assertRaises(CommandError) as exc:
                self.command.handle()
        self.assertIn("missing required keys: RUN_VERIFY_BOOTSTRAP_MARKETPLACE", str(exc.exception))
