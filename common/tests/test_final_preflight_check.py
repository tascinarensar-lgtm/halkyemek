from __future__ import annotations

import os
from unittest import mock

from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from common.management.commands.final_preflight_check import Command


REQUIRED_BEAT_JOBS = {
    "record_scheduler_heartbeat_every_minute": {},
    "process_notifications_every_minute": {},
    "cleanup_checkout_sessions_every_five_minutes": {},
    "run_payout_eligibility_hourly": {},
    "create_payout_batch_every_fifteen_minutes": {},
    "dispatch_due_payouts_every_five_minutes": {},
    "sync_sent_payout_statuses_every_five_minutes": {},
    "reprocess_unmatched_settlement_records_every_fifteen_minutes": {},
    "import_pending_settlement_files_every_fifteen_minutes": {},
    "verify_financial_integrity_hourly": {},
    "report_financial_anomalies_hourly": {},
}


@override_settings(
    APP_ENV="staging",
    DEBUG=False,
    RELEASE_VERSION="2026.03.31-rc1",
    SECRET_KEY="x" * 64,
    DATABASES={"default": {"ENGINE": "django.db.backends.postgresql", "NAME": "halkyemek"}},
    CELERY_BROKER_URL="redis://redis:6379/1",
    CELERY_RESULT_BACKEND="redis://redis:6379/2",
    CELERY_TASK_ALWAYS_EAGER=False,
    TRUST_X_FORWARDED_FOR=False,
    TRUSTED_PROXY_IPS=[],
    METRICS_TOKEN="metrics-secret-token",
    METRICS_IP_ALLOWLIST=[],
    METRICS_ALLOW_QUERY_TOKEN=False,
    CANONICAL_API_BASE_URL="https://api.example.com",
    FRONTEND_APP_URL="https://app.example.com",
    CACHES={"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": "redis://redis:6379/3"}},
    ALLOWED_HOSTS=["api.example.com"],
    CSRF_TRUSTED_ORIGINS=["https://api.example.com"],
    CORS_ALLOWED_ORIGINS=["https://app.example.com"],
    GOOGLE_OAUTH_CLIENT_ID="google-client-id",
    FCM_PROJECT_ID="fcm-project",
    FCM_CLIENT_EMAIL="fcm@example.com",
    FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    EMAIL_NOTIFICATIONS_ENABLED=True,
    EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
    EMAIL_HOST="smtp.example-mail.com",
    EMAIL_PORT=587,
    EMAIL_USE_TLS=True,
    EMAIL_USE_SSL=False,
    DEFAULT_FROM_EMAIL="HalkYemek <bildirim@halkyemek.com>",
    NOTIFICATION_EMAIL_FROM="HalkYemek <bildirim@halkyemek.com>",
    IYZICO_API_KEY="iyzico-key",
    IYZICO_SECRET_KEY="iyzico-secret",
    IYZICO_BASE_URL="https://sandbox-api.iyzipay.com",
    PAYMENT_WEBHOOK_SECRET="webhook-secret-123",
    SCHEDULER_HEARTBEAT_TTL_SECONDS=180,
    CELERY_BEAT_MAX_LOOP_INTERVAL=60,
    CELERY_BEAT_SCHEDULE=REQUIRED_BEAT_JOBS,
)
class FinalPreflightConfigurationTests(SimpleTestCase):
    def setUp(self) -> None:
        self.command = Command()
        self.runtime_checks_patcher = mock.patch(
            "health.views._runtime_core_checks",
            return_value={"database": True, "cache": True, "celery_broker": True, "pending_migrations": True},
        )
        self.iyzico_client_patcher = mock.patch(
            "common.management.commands.final_preflight_check.IyzicoMarketplaceClient",
            return_value=object(),
        )
        self.runtime_checks_patcher.start()
        self.iyzico_client_patcher.start()
        self.addCleanup(self.runtime_checks_patcher.stop)
        self.addCleanup(self.iyzico_client_patcher.stop)
        self.env_patcher = mock.patch.dict(os.environ, {"GUNICORN_FORWARDED_ALLOW_IPS": "10.0.0.1"}, clear=False)
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    def test_runtime_validation_requires_payment_webhook_secret(self) -> None:
        with override_settings(PAYMENT_WEBHOOK_SECRET=""):
            with self.assertRaises(CommandError) as exc:
                self.command._validate_runtime_configuration()

        self.assertIn("PAYMENT_WEBHOOK_SECRET must be configured in staging/prod", str(exc.exception))

    def test_runtime_validation_requires_allowed_hosts(self) -> None:
        with override_settings(ALLOWED_HOSTS=[]):
            with self.assertRaises(CommandError) as exc:
                self.command._validate_runtime_configuration()

        self.assertIn("ALLOWED_HOSTS must be configured in staging/prod", str(exc.exception))

    def test_runtime_validation_requires_csrf_trusted_origins(self) -> None:
        with override_settings(CSRF_TRUSTED_ORIGINS=[]):
            with self.assertRaises(CommandError) as exc:
                self.command._validate_runtime_configuration()

        self.assertIn("CSRF_TRUSTED_ORIGINS must be configured in staging/prod", str(exc.exception))

    def test_runtime_validation_requires_cors_allowed_origins(self) -> None:
        with override_settings(CORS_ALLOWED_ORIGINS=[]):
            with self.assertRaises(CommandError) as exc:
                self.command._validate_runtime_configuration()

        self.assertIn("CORS_ALLOWED_ORIGINS must be configured in staging/prod", str(exc.exception))


    def test_runtime_validation_requires_canonical_host_in_allowed_hosts(self) -> None:
        with override_settings(ALLOWED_HOSTS=["other.example.com"]):
            with self.assertRaises(CommandError) as exc:
                self.command._validate_runtime_configuration()

        self.assertIn("CANONICAL_API_BASE_URL host must be present in ALLOWED_HOSTS", str(exc.exception))

    def test_runtime_validation_requires_canonical_origin_in_csrf_trusted_origins(self) -> None:
        with override_settings(CSRF_TRUSTED_ORIGINS=["https://other.example.com"]):
            with self.assertRaises(CommandError) as exc:
                self.command._validate_runtime_configuration()

        self.assertIn("CANONICAL_API_BASE_URL origin must be present in CSRF_TRUSTED_ORIGINS", str(exc.exception))

    def test_runtime_validation_rejects_invalid_celery_time_window(self) -> None:
        with override_settings(CELERY_TASK_SOFT_TIME_LIMIT=900, CELERY_TASK_TIME_LIMIT=900):
            with self.assertRaises(CommandError) as exc:
                self.command._validate_runtime_configuration()
        self.assertIn("CELERY_TASK_SOFT_TIME_LIMIT must be lower than CELERY_TASK_TIME_LIMIT", str(exc.exception))

    def test_runtime_validation_rejects_small_lock_ttl(self) -> None:
        with override_settings(DISPATCH_DUE_PAYOUTS_LOCK_TTL_SECONDS=120):
            with self.assertRaises(CommandError) as exc:
                self.command._validate_runtime_configuration()
        self.assertIn("DISPATCH_DUE_PAYOUTS_LOCK_TTL_SECONDS must be >= 300", str(exc.exception))

    def test_runtime_validation_accepts_complete_staging_configuration(self) -> None:
        self.command._validate_runtime_configuration()


    @mock.patch.object(Command, "_safe_heartbeat_success")
    @mock.patch("common.management.commands.final_preflight_check.call_command")
    @mock.patch.object(Command, "_validate_operational_artifacts")
    @mock.patch.object(Command, "_validate_runtime_configuration")
    def test_handle_runs_env_example_validation_before_deploy_checks(self, mock_runtime, mock_artifacts, mock_call_command, mock_heartbeat_success) -> None:
        def _side_effect(name, *args, **kwargs):
            if name in {"verify_financial_integrity", "report_financial_anomalies"}:
                stdout = kwargs.get("stdout")
                if stdout is not None:
                    stdout.write("OK\n")
            return None

        mock_call_command.side_effect = _side_effect

        self.command.handle(fail_on_lock_skip=False)

        ordered_commands = [call.args[0] for call in mock_call_command.call_args_list]
        self.assertEqual(ordered_commands[0], "validate_env_examples")
        self.assertEqual(ordered_commands[1], "check")
        self.assertIn("verify_bootstrap_marketplace", ordered_commands)
