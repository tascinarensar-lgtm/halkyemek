from __future__ import annotations

import os
import tempfile
from unittest import mock
from pathlib import Path

from django.test import SimpleTestCase, override_settings

from common.runtime_validation import collect_runtime_validation_failures


TEMP_ROOT = Path(tempfile.gettempdir()).resolve()


@override_settings(
    APP_ENV="staging",
    DEBUG=False,
    RELEASE_VERSION="2026.04.02-rc1",
    SECRET_KEY="x" * 64,
    DATABASES={"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "halkyemek"}},
    CACHES={"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": "redis://redis:6379/1"}},
    CELERY_BROKER_URL="redis://redis:6379/1",
    CELERY_RESULT_BACKEND="redis://redis:6379/1",
    CELERY_TASK_ALWAYS_EAGER=False,
    CELERY_TASK_SOFT_TIME_LIMIT=300,
    CELERY_TASK_TIME_LIMIT=600,
    CELERY_BROKER_TRANSPORT_OPTIONS={"visibility_timeout": 600},
    MAX_REQUEST_BODY_BYTES=1024 * 1024,
    WEBHOOK_MAX_BODY_BYTES=256 * 1024,
    ALLOWED_HOSTS=["api.example.com"],
    CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
    CORS_ALLOWED_ORIGINS=["https://app.example.com"],
    CANONICAL_API_BASE_URL="https://api.example.com",
    TRUST_X_FORWARDED_FOR=True,
    TRUSTED_PROXY_IPS=["10.0.0.0/8"],
    METRICS_TOKEN="metrics-secret-token",
    METRICS_IP_ALLOWLIST=[],
    METRICS_ALLOW_QUERY_TOKEN=False,
    GOOGLE_OAUTH_CLIENT_ID="google-client-id",
    FCM_PROJECT_ID="fcm-project",
    FCM_CLIENT_EMAIL="fcm@example.com",
    FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    IYZICO_API_KEY="iyzico-key",
    IYZICO_SECRET_KEY="iyzico-secret",
    IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
    PAYMENT_WEBHOOK_SECRET="webhook-secret-123",
    SETTLEMENT_IMPORT_INBOX_DIR=str(TEMP_ROOT / "inbox"),
    SETTLEMENT_IMPORT_ARCHIVE_DIR=str(TEMP_ROOT / "archive"),
    SETTLEMENT_IMPORT_FAILED_DIR=str(TEMP_ROOT / "failed"),
    SCHEDULER_HEARTBEAT_TTL_SECONDS=180,
    CELERY_BEAT_MAX_LOOP_INTERVAL=60,
)
class RuntimeValidationTests(SimpleTestCase):
    def setUp(self) -> None:
        self.env_patcher = mock.patch.dict(os.environ, {"GUNICORN_FORWARDED_ALLOW_IPS": "10.0.0.1"}, clear=False)
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    def test_complete_staging_config_passes(self) -> None:
        self.assertEqual(collect_runtime_validation_failures(), [])

    def test_cache_backend_must_be_shared(self) -> None:
        with override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "x"}}):
            failures = collect_runtime_validation_failures()
        self.assertIn("REDIS_CACHE_URL or another shared cache backend is required in staging/prod", failures)

    def test_cors_allowed_origins_must_be_configured(self) -> None:
        with override_settings(CORS_ALLOWED_ORIGINS=[]):
            failures = collect_runtime_validation_failures()
        self.assertIn("CORS_ALLOWED_ORIGINS must be configured in staging/prod", failures)

    def test_settlement_directories_must_be_complete(self) -> None:
        with override_settings(SETTLEMENT_IMPORT_ARCHIVE_DIR=""):
            failures = collect_runtime_validation_failures()
        self.assertIn("Settlement import directories must be configured together (inbox/archive/failed)", failures)


    def test_placeholder_google_client_id_is_rejected(self) -> None:
        with override_settings(GOOGLE_OAUTH_CLIENT_ID="..."):
            failures = collect_runtime_validation_failures()
        self.assertIn("GOOGLE_OAUTH_CLIENT_ID cannot use placeholder/example values in staging/prod", failures)

    def test_settlement_upload_dir_must_not_overlap_with_archive_dirs(self) -> None:
        with override_settings(SETTLEMENT_IMPORT_UPLOAD_DIR=str(TEMP_ROOT / "inbox")):
            failures = collect_runtime_validation_failures()
        self.assertIn("SETTLEMENT_IMPORT_UPLOAD_DIR must be different from inbox/archive/failed directories", failures)

    def test_metrics_token_must_be_long_enough(self) -> None:
        with override_settings(METRICS_TOKEN="short-token"):
            failures = collect_runtime_validation_failures()
        self.assertIn("METRICS_TOKEN must be at least 16 characters long in staging/prod", failures)

    def test_iyzico_environment_must_match_staging(self) -> None:
        with override_settings(IYZICO_ENV="production", IYZICO_BASE_URL="https://api.iyzipay.com"):
            failures = collect_runtime_validation_failures()
        self.assertIn("IYZICO_ENV must be sandbox when APP_ENV=staging", failures)

    def test_payment_webhook_secret_must_be_long_enough(self) -> None:
        with override_settings(PAYMENT_WEBHOOK_SECRET="too-short"):
            failures = collect_runtime_validation_failures()
        self.assertIn("PAYMENT_WEBHOOK_SECRET must be at least 16 characters long in staging/prod", failures)
