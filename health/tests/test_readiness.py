from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from health.services import SCHEDULER_HEARTBEAT_NAME
from health.models import JobHeartbeat


class ReadinessTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    @override_settings(
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
        IYZICO_API_KEY="sandbox-key",
        IYZICO_SECRET_KEY="sandbox-secret",
        PAYMENT_WEBHOOK_SECRET="test-secret",
        SECRET_KEY="test-secret-key-12345678901234567890",
        JOB_HEARTBEAT_TTL_SECONDS=900,
        INTEGRITY_HEARTBEAT_TTL_SECONDS=7200,
        ANOMALY_HEARTBEAT_TTL_SECONDS=7200,
    )
    def test_readiness_returns_json(self):
        now = timezone.now()
        for job_name in [
            "process_notifications",
            "cleanup_checkout_sessions",
            "create_payout_batch",
            "dispatch_due_payouts",
            "run_payout_eligibility",
            "sync_sent_payout_statuses",
            "reprocess_unmatched_settlement_records",
            "verify_financial_integrity",
            "report_financial_anomalies",
            SCHEDULER_HEARTBEAT_NAME,
        ]:
            JobHeartbeat.objects.create(job_name=job_name, last_success_at=now, status="SUCCESS")

        resp = self.client.get("/health/readiness/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("checks", resp.json())
        self.assertIn("notifications_job_recent", resp.json()["checks"])
        self.assertIn("checkout_cleanup_job_recent", resp.json()["checks"])
        self.assertIn("payout_batch_create_job_recent", resp.json()["checks"])
        self.assertIn("settlement_reprocess_job_recent", resp.json()["checks"])
        self.assertIn("scheduler_heartbeat_recent", resp.json()["checks"])
        self.assertIn(SCHEDULER_HEARTBEAT_NAME, resp.json()["details"]["ops"])

    @override_settings(
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
    )
    def test_readiness_strict_requires_job_freshness(self):
        resp = self.client.get("/health/readiness/?strict=1")
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.json()["ops_ok"])

    @override_settings(
        DEBUG=False,
        TESTING=False,
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
        IYZICO_API_KEY="sandbox-key",
        IYZICO_SECRET_KEY="sandbox-secret",
        PAYMENT_WEBHOOK_SECRET="test-secret",
        SECRET_KEY="test-secret-key-12345678901234567890",
        SENTRY_DSN="https://example@sentry.invalid/1",
        CANONICAL_API_BASE_URL="https://api.example.com",
        METRICS_TOKEN="secret",
        ALLOWED_HOSTS=["api.example.com", "testserver"],
        CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
        REDIS_CACHE_URL="redis://localhost:6379/1",
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.redis.RedisCache",
                "LOCATION": "redis://localhost:6379/1",
            }
        },
        CELERY_TASK_ALWAYS_EAGER=True,
    )
    def test_readiness_reports_celery_eager_misconfiguration(self):
        resp = self.client.get("/health/readiness/")
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.json()["checks"]["celery_eager_disabled"])

    @override_settings(
        DEBUG=False,
        TESTING=False,
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
        IYZICO_API_KEY="sandbox-key",
        IYZICO_SECRET_KEY="sandbox-secret",
        PAYMENT_WEBHOOK_SECRET="test-secret",
        SECRET_KEY="test-secret-key-12345678901234567890",
        SENTRY_DSN="https://example@sentry.invalid/1",
        CANONICAL_API_BASE_URL="https://api.example.com",
        METRICS_TOKEN="secret",
        ALLOWED_HOSTS=["api.example.com", "testserver"],
        CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
        REDIS_CACHE_URL="redis://localhost:6379/1",
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.redis.RedisCache",
                "LOCATION": "redis://localhost:6379/1",
            }
        },
        SETTLEMENT_IMPORT_INBOX_DIR="/var/lib/halkyemek/settlement/inbox",
        SETTLEMENT_IMPORT_ARCHIVE_DIR="",
        SETTLEMENT_IMPORT_FAILED_DIR="/var/lib/halkyemek/settlement/failed",
    )
    def test_readiness_reports_partial_settlement_directory_configuration(self):
        resp = self.client.get("/health/readiness/")
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.json()["checks"]["settlement_import_dirs_valid"])

    @override_settings(
        DEBUG=False,
        TESTING=False,
        APP_ENV="staging",
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
        IYZICO_API_KEY="sandbox-key",
        IYZICO_SECRET_KEY="sandbox-secret",
        IYZICO_ENV="production",
        IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
        PAYMENT_WEBHOOK_SECRET="test-secret",
        SECRET_KEY="test-secret-key-12345678901234567890",
        SENTRY_DSN="https://example@sentry.invalid/1",
        CANONICAL_API_BASE_URL="https://api.example.com",
        METRICS_TOKEN="secret",
        ALLOWED_HOSTS=["api.example.com", "testserver"],
        CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.redis.RedisCache",
                "LOCATION": "redis://localhost:6379/1",
            }
        },
    )
    def test_readiness_reports_iyzico_runtime_mismatch(self):
        resp = self.client.get("/health/readiness/")
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.json()["checks"]["iyzico_runtime_config_valid"])

    @override_settings(
        DEBUG=False,
        TESTING=False,
        APP_ENV="staging",
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
        IYZICO_API_KEY="sandbox-key",
        IYZICO_SECRET_KEY="sandbox-secret",
        IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
        PAYMENT_WEBHOOK_SECRET="test-secret",
        SECRET_KEY="test-secret-key-12345678901234567890",
        SENTRY_DSN="https://example@sentry.invalid/1",
        CANONICAL_API_BASE_URL="https://api.example.com",
        METRICS_TOKEN="secret",
        TRUST_X_FORWARDED_FOR=True,
        TRUSTED_PROXY_IPS=[],
        ALLOWED_HOSTS=["api.example.com", "testserver"],
        CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.redis.RedisCache",
                "LOCATION": "redis://localhost:6379/1",
            }
        },
    )
    def test_readiness_reports_missing_trusted_proxy_configuration(self):
        resp = self.client.get("/health/readiness/")
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.json()["checks"]["trusted_proxy_config_valid"])

    @override_settings(
        DEBUG=False,
        TESTING=False,
        APP_ENV="staging",
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
        IYZICO_API_KEY="sandbox-key",
        IYZICO_SECRET_KEY="sandbox-secret",
        IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
        PAYMENT_WEBHOOK_SECRET="test-secret",
        SECRET_KEY="test-secret-key-12345678901234567890",
        SENTRY_DSN="https://example@sentry.invalid/1",
        CANONICAL_API_BASE_URL="https://api.example.com",
        METRICS_TOKEN="secret",
        TRUST_X_FORWARDED_FOR=True,
        TRUSTED_PROXY_IPS=["10.0.0.0/8"],
        METRICS_IP_ALLOWLIST=["bad-cidr"],
        ALLOWED_HOSTS=["api.example.com", "testserver"],
        CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.redis.RedisCache",
                "LOCATION": "redis://localhost:6379/1",
            }
        },
    )
    def test_readiness_reports_invalid_allowlist_configuration(self):
        resp = self.client.get("/health/readiness/")
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.json()["checks"]["allowlists_valid"])

    @override_settings(
        DEBUG=False,
        TESTING=False,
        APP_ENV="staging",
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
        IYZICO_API_KEY="sandbox-key",
        IYZICO_SECRET_KEY="sandbox-secret",
        IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
        PAYMENT_WEBHOOK_SECRET="test-secret",
        SECRET_KEY="test-secret-key-12345678901234567890",
        SENTRY_DSN="https://example@sentry.invalid/1",
        CANONICAL_API_BASE_URL="https://api.example.com",
        METRICS_TOKEN="secret",
        TRUST_X_FORWARDED_FOR=True,
        TRUSTED_PROXY_IPS=["10.0.0.0/8"],
        ALLOWED_HOSTS=["api.example.com", "testserver"],
        CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.redis.RedisCache",
                "LOCATION": "redis://localhost:6379/1",
            }
        },
        CELERY_TASK_TIME_LIMIT=600,
        CELERY_TASK_SOFT_TIME_LIMIT=600,
    )
    def test_readiness_reports_invalid_celery_time_limits(self):
        resp = self.client.get("/health/readiness/")
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.json()["checks"]["celery_time_limits_valid"])

    @override_settings(
        DEBUG=False,
        TESTING=False,
        APP_ENV="staging",
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
        IYZICO_API_KEY="sandbox-key",
        IYZICO_SECRET_KEY="sandbox-secret",
        IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
        PAYMENT_WEBHOOK_SECRET="test-secret",
        SECRET_KEY="test-secret-key-12345678901234567890",
        SENTRY_DSN="https://example@sentry.invalid/1",
        CANONICAL_API_BASE_URL="https://api.example.com",
        METRICS_TOKEN="secret",
        TRUST_X_FORWARDED_FOR=True,
        TRUSTED_PROXY_IPS=["10.0.0.0/8"],
        ALLOWED_HOSTS=["api.example.com", "testserver"],
        CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.redis.RedisCache",
                "LOCATION": "redis://localhost:6379/1",
            }
        },
        MAX_REQUEST_BODY_BYTES=1024,
        WEBHOOK_MAX_BODY_BYTES=2048,
    )
    def test_readiness_reports_invalid_request_size_limits(self):
        resp = self.client.get("/health/readiness/")
        self.assertEqual(resp.status_code, 503)
        self.assertFalse(resp.json()["checks"]["request_size_limits_valid"])

    @override_settings(
        DEBUG=False,
        TESTING=False,
        APP_ENV="prod",
        GOOGLE_OAUTH_CLIENT_ID="x.apps.googleusercontent.com",
        FCM_PROJECT_ID="proj",
        FCM_CLIENT_EMAIL="a@b.com",
        FCM_PRIVATE_KEY="dummy",
        IYZICO_API_KEY="sandbox-key",
        IYZICO_SECRET_KEY="sandbox-secret",
        PAYMENT_WEBHOOK_SECRET="test-secret",
        SECRET_KEY="test-secret-key-12345678901234567890",
        SENTRY_DSN="https://example@sentry.invalid/1",
        CANONICAL_API_BASE_URL="https://api.example.com",
        METRICS_TOKEN="secret",
        ALLOWED_HOSTS=["api.example.com", "testserver"],
        CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
        CACHES={
            "default": {
                "BACKEND": "django.core.cache.backends.redis.RedisCache",
                "LOCATION": "redis://localhost:6379/1",
            }
        },
    )
    def test_readiness_hides_details_in_production(self):
        resp = self.client.get("/health/readiness/")
        self.assertIn(resp.status_code, {200, 503})
        self.assertEqual(resp.json(), {"ok": resp.status_code == 200, "strict": False})
