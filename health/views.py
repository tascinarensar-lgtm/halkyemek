from __future__ import annotations

import hmac
import os
import uuid

import redis
from datetime import timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from common.network import ip_in_allowlist
from common.network import invalid_allowlist_entries
from health.metrics import build_metrics_text
from health.services import (
    CRITICAL_JOB_HEARTBEATS,
    SCHEDULER_HEARTBEAT_NAME,
    heartbeat_snapshot,
    job_heartbeat_ttls,
)
from logs.utils import get_client_ip


def _database_ready() -> bool:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1;")
            cursor.fetchone()
        return True
    except Exception:
        return False


def _cache_ready() -> bool:
    cache_key = f"readiness:test:{uuid.uuid4().hex}"
    try:
        cache.set(cache_key, "ok", timeout=10)
        return cache.get(cache_key) == "ok"
    except Exception:
        return False
    finally:
        try:
            cache.delete(cache_key)
        except Exception:
            pass


def _migrations_pending() -> bool:
    try:
        executor = MigrationExecutor(connection)
        targets = executor.loader.graph.leaf_nodes()
        return bool(executor.migration_plan(targets))
    except Exception:
        return True


def _broker_ready() -> bool:
    if getattr(settings, "TESTING", False):
        return True
    try:
        from halkyemekproject.celery import app as celery_app

        timeout_seconds = float(getattr(settings, "READINESS_BROKER_TIMEOUT_SECONDS", 1.0))
        broker_url = str(getattr(settings, "CELERY_BROKER_URL", "") or "")
        broker_scheme = urlparse(broker_url).scheme
        if broker_scheme in {"redis", "rediss"}:
            redis_client = redis.Redis.from_url(
                broker_url,
                socket_connect_timeout=timeout_seconds,
                socket_timeout=timeout_seconds,
            )
            return bool(redis_client.ping())

        transport_options = dict(getattr(celery_app.conf, "broker_transport_options", {}) or {})
        transport_options["socket_connect_timeout"] = timeout_seconds
        transport_options["socket_timeout"] = timeout_seconds
        with celery_app.connection_for_read(
            connect_timeout=timeout_seconds,
            transport_options=transport_options,
        ) as connection:
            connection.ensure_connection(
                max_retries=1,
                timeout=timeout_seconds,
                interval_start=0,
                interval_step=0,
                interval_max=0,
            )
        return True
    except ModuleNotFoundError as exc:
        if exc.name == "celery":
            return False
        raise
    except Exception:
        return False


def _shared_cache_configured() -> bool:
    backend = settings.CACHES.get("default", {}).get("BACKEND", "")
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    return not backend.endswith("LocMemCache")


def _shared_result_backend_configured() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    backend = str(getattr(settings, "CELERY_RESULT_BACKEND", "") or "").strip().lower()
    if not backend:
        return False
    return not backend.startswith(("rpc://", "cache+memory://", "memory://", "amqp://"))


def _database_engine_supported() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    engine = str(getattr(settings, "DATABASES", {}).get("default", {}).get("ENGINE", "") or "").lower()
    return "postgresql" in engine


def _release_configured() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    release = str(getattr(settings, "RELEASE_VERSION", "") or "").strip().lower()
    return release not in {"", "dev", "local", "latest"}


def _secret_key_safe() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    secret_key = str(getattr(settings, "SECRET_KEY", "") or "").strip()
    lowered = secret_key.lower()
    return bool(secret_key) and lowered not in {"unsafe-dev-secret", "changeme", "change-me"} and len(secret_key) >= 32


def _hosts_configured() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    return bool(getattr(settings, "ALLOWED_HOSTS", []))


def _csrf_trusted_origins_configured() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    return bool(getattr(settings, "CSRF_TRUSTED_ORIGINS", []))


def _https_base_url_configured() -> bool:
    base_url = str(getattr(settings, "CANONICAL_API_BASE_URL", "") or "").strip()
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return bool(base_url or True)
    return base_url.startswith("https://")


def _sentry_configured() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    return bool(str(getattr(settings, "SENTRY_DSN", "") or "").strip())


def _trusted_proxy_config_valid() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    if not bool(getattr(settings, "TRUST_X_FORWARDED_FOR", False)):
        return True
    return bool(getattr(settings, "TRUSTED_PROXY_IPS", []))


def _allowlists_valid() -> bool:
    checks = [
        invalid_allowlist_entries(list(getattr(settings, "TRUSTED_PROXY_IPS", []) or [])),
        invalid_allowlist_entries(list(getattr(settings, "METRICS_IP_ALLOWLIST", []) or [])),
        invalid_allowlist_entries(list(getattr(settings, "IYZICO_WEBHOOK_IP_ALLOWLIST", []) or [])),
    ]
    return all(not errors for errors in checks)


def _gunicorn_forwarded_allow_ips_valid() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    value = str(os.getenv("GUNICORN_FORWARDED_ALLOW_IPS", "") or "").strip()
    if not value:
        return True
    if value == "*":
        return False
    entries = [item.strip() for item in value.split(",") if item.strip()]
    return bool(entries) and not invalid_allowlist_entries(entries)


def _celery_eager_disabled() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    return not bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))


def _settlement_import_dirs_valid() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    keys = (
        "SETTLEMENT_IMPORT_INBOX_DIR",
        "SETTLEMENT_IMPORT_ARCHIVE_DIR",
        "SETTLEMENT_IMPORT_FAILED_DIR",
    )
    values = [str(getattr(settings, key, "") or "").strip() for key in keys]
    if not any(values):
        return True
    if not all(values):
        return False
    paths = [Path(value).expanduser().resolve() for value in values]
    normalized = [str(path) for path in paths]
    if len(set(normalized)) != len(normalized):
        return False
    for path in paths:
        if not path.exists() or not path.is_dir():
            return False
        if not os.access(path, os.W_OK | os.X_OK):
            return False
    return True


def _iyzico_runtime_config_valid() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    try:
        from payments.providers.iyzico_marketplace import IyzicoMarketplaceClient

        IyzicoMarketplaceClient()
        return True
    except Exception:
        return False


def _job_snapshot(job_name: str, ttl_seconds: int) -> dict[str, Any]:
    return heartbeat_snapshot(job_name, ttl_seconds)


def _celery_time_limits_valid() -> bool:
    soft = int(getattr(settings, "CELERY_TASK_SOFT_TIME_LIMIT", 0) or 0)
    hard = int(getattr(settings, "CELERY_TASK_TIME_LIMIT", 0) or 0)
    if hard <= 0:
        return False
    if soft <= 0:
        return True
    return soft < hard


def _celery_visibility_timeout_valid() -> bool:
    if getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False):
        return True
    options = dict(getattr(settings, "CELERY_BROKER_TRANSPORT_OPTIONS", {}) or {})
    visibility_timeout = int(options.get("visibility_timeout") or 0)
    hard = int(getattr(settings, "CELERY_TASK_TIME_LIMIT", 0) or 0)
    return visibility_timeout >= max(hard, 1)


def _request_size_limits_valid() -> bool:
    max_request = int(getattr(settings, "MAX_REQUEST_BODY_BYTES", 0) or 0)
    webhook_request = int(getattr(settings, "WEBHOOK_MAX_BODY_BYTES", 0) or 0)
    return max_request >= max(webhook_request, 1)


def _lock_ttls_valid() -> bool:
    shortest_expected = {
        "PROCESS_NOTIFICATIONS_LOCK_TTL_SECONDS": 60,
        "CLEANUP_CHECKOUT_SESSIONS_LOCK_TTL_SECONDS": 300,
        "DISPATCH_DUE_PAYOUTS_LOCK_TTL_SECONDS": 300,
        "SYNC_SENT_PAYOUT_STATUSES_LOCK_TTL_SECONDS": 300,
        "CREATE_PAYOUT_BATCH_LOCK_TTL_SECONDS": 900,
        "RUN_PAYOUT_ELIGIBILITY_LOCK_TTL_SECONDS": 3600,
        "SETTLEMENT_REPROCESS_LOCK_TTL_SECONDS": 900,
        "IMPORT_PENDING_SETTLEMENT_FILES_LOCK_TTL_SECONDS": 900,
        "VERIFY_FINANCIAL_INTEGRITY_LOCK_TTL_SECONDS": 3600,
        "REPORT_FINANCIAL_ANOMALIES_LOCK_TTL_SECONDS": 3600,
    }
    for key, minimum in shortest_expected.items():
        value = int(getattr(settings, key, 0) or 0)
        if value < minimum:
            return False
    return True


def _runtime_core_checks(*, include_active_checks: bool = True) -> dict[str, bool]:
    metrics_token = bool(getattr(settings, "METRICS_TOKEN", ""))
    metrics_ip_allowlist = bool(getattr(settings, "METRICS_IP_ALLOWLIST", []))
    passive_checks = {
        "database_engine_supported": _database_engine_supported(),
        "shared_cache_configured": _shared_cache_configured(),
        "shared_result_backend_configured": _shared_result_backend_configured(),
        "release_version_configured": _release_configured(),
        "secret_key_safe": _secret_key_safe(),
        "allowed_hosts_configured": _hosts_configured(),
        "csrf_trusted_origins_configured": _csrf_trusted_origins_configured(),
        "canonical_api_base_url_https": _https_base_url_configured(),
        "google_oauth_configured": bool(getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")),
        "fcm_configured": all([
            bool(getattr(settings, "FCM_PROJECT_ID", "")),
            bool(getattr(settings, "FCM_CLIENT_EMAIL", "")),
            bool(getattr(settings, "FCM_PRIVATE_KEY", "")),
        ]),
        "iyzico_configured": all([
            bool(getattr(settings, "IYZICO_API_KEY", "")),
            bool(getattr(settings, "IYZICO_SECRET_KEY", "")),
            bool(getattr(settings, "IYZICO_BASE_URL", "")),
        ]),
        "iyzico_runtime_config_valid": _iyzico_runtime_config_valid(),
        "payment_webhook_secret_configured": bool(getattr(settings, "PAYMENT_WEBHOOK_SECRET", "")),
        "sentry_configured": _sentry_configured(),
        "trusted_proxy_config_valid": _trusted_proxy_config_valid(),
        "gunicorn_forwarded_allow_ips_valid": _gunicorn_forwarded_allow_ips_valid(),
        "allowlists_valid": _allowlists_valid(),
        "celery_eager_disabled": _celery_eager_disabled(),
        "celery_time_limits_valid": _celery_time_limits_valid(),
        "celery_visibility_timeout_valid": _celery_visibility_timeout_valid(),
        "request_size_limits_valid": _request_size_limits_valid(),
        "lock_ttls_valid": _lock_ttls_valid(),
        "settlement_import_dirs_valid": _settlement_import_dirs_valid(),
        "metrics_protected": metrics_token or metrics_ip_allowlist or bool(getattr(settings, "DEBUG", False)) or bool(getattr(settings, "TESTING", False)),
    }
    if not include_active_checks:
        return passive_checks

    return {
        "database": _database_ready(),
        "cache": _cache_ready(),
        "celery_broker": _broker_ready(),
        "pending_migrations": not _migrations_pending(),
        **passive_checks,
    }


def _runtime_ops_checks() -> dict[str, bool]:
    job_ttls = job_heartbeat_ttls()
    return {
        "notifications_job_recent": bool(_job_snapshot("process_notifications", job_ttls["process_notifications"])["ok"]),
        "checkout_cleanup_job_recent": bool(_job_snapshot("cleanup_checkout_sessions", job_ttls["cleanup_checkout_sessions"])["ok"]),
        "payout_batch_create_job_recent": bool(_job_snapshot("create_payout_batch", job_ttls["create_payout_batch"])["ok"]),
        "payout_dispatch_job_recent": bool(_job_snapshot("dispatch_due_payouts", job_ttls["dispatch_due_payouts"])["ok"]),
        "payout_eligibility_job_recent": bool(_job_snapshot("run_payout_eligibility", job_ttls["run_payout_eligibility"])["ok"]),
        "payout_sync_job_recent": bool(_job_snapshot("sync_sent_payout_statuses", job_ttls["sync_sent_payout_statuses"])["ok"]),
        "settlement_reprocess_job_recent": bool(_job_snapshot("reprocess_unmatched_settlement_records", job_ttls["reprocess_unmatched_settlement_records"])["ok"]),
        "settlement_import_job_recent": bool(_job_snapshot("import_pending_settlement_files", job_ttls["import_pending_settlement_files"])["ok"]),
        "financial_integrity_job_recent": bool(_job_snapshot("verify_financial_integrity", job_ttls["verify_financial_integrity"])["ok"]),
        "anomaly_report_job_recent": bool(_job_snapshot("report_financial_anomalies", job_ttls["report_financial_anomalies"])["ok"]),
        "scheduler_heartbeat_recent": bool(_job_snapshot(SCHEDULER_HEARTBEAT_NAME, job_ttls[SCHEDULER_HEARTBEAT_NAME])["ok"]),
    }


def _runtime_ops_details() -> dict[str, dict[str, object]]:
    job_ttls = job_heartbeat_ttls()
    return {job_name: _job_snapshot(job_name, ttl_seconds) for job_name, ttl_seconds in job_ttls.items()}


def _is_public_production_readiness() -> bool:
    app_env = str(getattr(settings, "APP_ENV", "dev") or "dev").strip().lower()
    return app_env in {"prod", "production"} and not bool(getattr(settings, "DEBUG", False)) and not bool(getattr(settings, "TESTING", False))


def healthz(request):
    return JsonResponse({
        "ok": True,
        "ts": timezone.now().isoformat(),
        "env": getattr(settings, "APP_ENV", "unknown"),
        "release": getattr(settings, "RELEASE_VERSION", "unknown"),
    })


def readyz(request):
    core_checks = _runtime_core_checks()
    ops_checks = _runtime_ops_checks()
    ops_details = _runtime_ops_details()

    strict = request.GET.get("strict") in {"1", "true", "True"}
    core_ok = all(core_checks.values())
    ops_ok = all(ops_checks.values())
    ok = core_ok and (ops_ok if strict else True)
    status_code = 200 if ok else 503

    if _is_public_production_readiness():
        return JsonResponse(
            {
                "ok": ok,
                "strict": strict,
            },
            status=status_code,
        )

    payload = {
        "ok": ok,
        "core_ok": core_ok,
        "ops_ok": ops_ok,
        "strict": strict,
        "env": getattr(settings, "APP_ENV", "unknown"),
        "release": getattr(settings, "RELEASE_VERSION", "unknown"),
        "checks": {**core_checks, **ops_checks},
        "failing_checks": {
            "core": [name for name, check_ok in core_checks.items() if not check_ok],
            "ops": [name for name, check_ok in ops_checks.items() if not check_ok],
        },
        "details": {
            "core": core_checks,
            "ops": ops_details,
        },
    }
    return JsonResponse(payload, status=status_code)


@extend_schema(exclude=True)
class MetricsAPIView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        allowed_ips = list(getattr(settings, "METRICS_IP_ALLOWLIST", []))
        metrics_token = getattr(settings, "METRICS_TOKEN", "")
        client_ip = get_client_ip(request)
        auth_header = request.headers.get("Authorization", "")
        query_token = request.query_params.get("token", "")
        allow_query_token = bool(getattr(settings, "METRICS_ALLOW_QUERY_TOKEN", False))

        token_ok = False
        if metrics_token:
            expected = f"Bearer {metrics_token}"
            header_ok = hmac.compare_digest(auth_header, expected)
            query_ok = allow_query_token and hmac.compare_digest(query_token, metrics_token)
            token_ok = header_ok or query_ok

        ip_ok = bool(allowed_ips) and ip_in_allowlist(client_ip, allowed_ips)

        if settings.DEBUG or getattr(settings, "TESTING", False):
            permitted = True
        else:
            permitted = token_ok or ip_ok

        if not permitted:
            return JsonResponse({"detail": "Metrics endpoint is protected."}, status=403)

        return HttpResponse(build_metrics_text(), content_type="text/plain; version=0.0.4")
