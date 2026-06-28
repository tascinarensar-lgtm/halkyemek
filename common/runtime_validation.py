from __future__ import annotations

import os
from email.utils import parseaddr
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings

from common.network import invalid_allowlist_entries


_PLACEHOLDER_TOKENS = {
    "",
    "...",
    "<required>",
    "<replace-me>",
    "replace-me",
    "changeme",
    "change-me",
    "your-value",
    "todo",
    "tbd",
}


def _non_dev_release(value: str) -> bool:
    return str(value or "").strip().lower() not in {"", "dev", "local", "latest"}


def _is_placeholder(value: object) -> bool:
    normalized = str(value or "").strip().strip('"').strip("'").lower()
    if normalized in _PLACEHOLDER_TOKENS:
        return True
    return normalized.startswith("change-me") or normalized.startswith("example-")


def _validate_configured_value(
    failures: list[str],
    *,
    label: str,
    value: object,
    reject_placeholders: bool = True,
    min_length: int = 0,
) -> None:
    normalized = str(value or "").strip()
    if not normalized:
        failures.append(f"{label} must be configured in staging/prod")
        return
    if reject_placeholders and _is_placeholder(normalized):
        failures.append(f"{label} cannot use placeholder/example values in staging/prod")
        return
    if min_length and len(normalized) < min_length:
        failures.append(f"{label} must be at least {min_length} characters long in staging/prod")


def _email_domain(value: object) -> str:
    _display_name, address = parseaddr(str(value or "").strip())
    if "@" not in address:
        return ""
    return address.rsplit("@", 1)[-1].strip().lower()


def _is_non_deliverable_email_domain(value: object) -> bool:
    domain = _email_domain(value)
    if not domain:
        return True
    return (
        domain.endswith(".local")
        or domain.endswith(".test")
        or domain.endswith(".invalid")
        or domain in {"example.com", "example.org", "example.net"}
    )


def _matches_iyzico_environment(*, app_env: str, iyzico_env: str, iyzico_base_url: str) -> list[str]:
    failures: list[str] = []
    normalized_env = str(iyzico_env or "").strip().lower()
    normalized_url = str(iyzico_base_url or "").strip().lower()
    if not normalized_url.startswith("https://"):
        failures.append("IYZICO_BASE_URL must use https in staging/prod")
        return failures

    sandbox_url = "sandbox-api.iyzipay.com" in normalized_url
    production_url = "api.iyzipay.com" in normalized_url and not sandbox_url

    if normalized_env not in {"sandbox", "production"}:
        failures.append("IYZICO_ENV must be either sandbox or production in staging/prod")
        return failures

    expected_env = "production" if app_env == "prod" else "sandbox"
    if normalized_env != expected_env:
        failures.append(f"IYZICO_ENV must be {expected_env} when APP_ENV={app_env}")

    if normalized_env == "sandbox" and not sandbox_url:
        failures.append("IYZICO_BASE_URL must point to sandbox-api.iyzipay.com when IYZICO_ENV=sandbox")
    if normalized_env == "production" and not production_url:
        failures.append("IYZICO_BASE_URL must point to api.iyzipay.com when IYZICO_ENV=production")
    return failures


def _validate_public_url_setting(*, label: str, value: str) -> list[str]:
    normalized = str(value or "").strip()
    if not normalized:
        return [f"{label} must be configured in staging/prod"]
    if normalized.startswith("/"):
        if not normalized.endswith("/"):
            return [f"{label} must end with / when configured as a path"]
        return []

    parsed = urlparse(normalized)
    if parsed.scheme != "https" or not parsed.netloc:
        return [f"{label} must be an https URL or an absolute path starting with /"]
    if not normalized.endswith("/"):
        return [f"{label} must end with /"]
    return []


def _uses_iyzico_money_provider() -> bool:
    topup_provider = str(getattr(settings, "TOPUP_PROVIDER", "manual") or "manual").strip().lower()
    payout_provider = str(getattr(settings, "PAYOUT_PROVIDER", "manual") or "manual").strip().lower()
    return topup_provider == "iyzico" or payout_provider in {"iyzico", "iyzico_marketplace"}


def collect_runtime_validation_failures(*, include_runtime_checks: bool = False) -> list[str]:
    failures: list[str] = []
    app_env = str(getattr(settings, "APP_ENV", "dev") or "dev").strip().lower()
    if app_env not in {"staging", "prod"}:
        return failures

    if getattr(settings, "DEBUG", False):
        failures.append("DEBUG must be False in staging/prod")

    if not _non_dev_release(getattr(settings, "RELEASE_VERSION", "")):
        failures.append("RELEASE_VERSION must be an immutable non-dev value")
    elif _is_placeholder(getattr(settings, "RELEASE_VERSION", "")):
        failures.append("RELEASE_VERSION cannot use placeholder/example values")

    secret_key = str(getattr(settings, "SECRET_KEY", "") or "").strip()
    if len(secret_key) < 32 or secret_key.lower() in {"unsafe-dev-secret", "changeme", "change-me", "secret", "dev-secret"}:
        failures.append("DJANGO_SECRET_KEY must be long, random and non-default")

    database_engine = str(getattr(settings, "DATABASES", {}).get("default", {}).get("ENGINE", "") or "").lower()
    if "sqlite" in database_engine:
        failures.append("DATABASE_URL must use PostgreSQL in staging/prod")

    cache_backend = str(getattr(settings, "CACHES", {}).get("default", {}).get("BACKEND", "") or "")
    if cache_backend.endswith("LocMemCache"):
        failures.append("REDIS_CACHE_URL or another shared cache backend is required in staging/prod")

    if not getattr(settings, "CELERY_BROKER_URL", ""):
        failures.append("CELERY_BROKER_URL must be configured")
    if not getattr(settings, "CELERY_RESULT_BACKEND", ""):
        failures.append("CELERY_RESULT_BACKEND must be configured")

    result_backend = str(getattr(settings, "CELERY_RESULT_BACKEND", "") or "").strip().lower()
    if result_backend.startswith(("rpc://", "cache+memory://", "memory://", "amqp://")):
        failures.append("CELERY_RESULT_BACKEND must be a shared durable backend in staging/prod")

    if bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False)):
        failures.append("CELERY_TASK_ALWAYS_EAGER must be False in staging/prod")

    celery_soft_time_limit = int(getattr(settings, "CELERY_TASK_SOFT_TIME_LIMIT", 0) or 0)
    celery_time_limit = int(getattr(settings, "CELERY_TASK_TIME_LIMIT", 0) or 0)
    if celery_time_limit <= 0:
        failures.append("CELERY_TASK_TIME_LIMIT must be a positive integer")
    elif celery_soft_time_limit and celery_soft_time_limit >= celery_time_limit:
        failures.append("CELERY_TASK_SOFT_TIME_LIMIT must be lower than CELERY_TASK_TIME_LIMIT")

    broker_transport_options = dict(getattr(settings, "CELERY_BROKER_TRANSPORT_OPTIONS", {}) or {})
    visibility_timeout = int(broker_transport_options.get("visibility_timeout") or 0)
    if visibility_timeout < max(celery_time_limit, 1):
        failures.append("CELERY_BROKER_TRANSPORT_OPTIONS.visibility_timeout must be >= CELERY_TASK_TIME_LIMIT")

    if int(getattr(settings, "MAX_REQUEST_BODY_BYTES", 0) or 0) < int(getattr(settings, "WEBHOOK_MAX_BODY_BYTES", 0) or 0):
        failures.append("MAX_REQUEST_BODY_BYTES must be >= WEBHOOK_MAX_BODY_BYTES")

    if app_env == "prod" and not getattr(settings, "SENTRY_DSN", ""):
        failures.append("SENTRY_DSN must be configured in prod")
    elif app_env == "prod" and _is_placeholder(getattr(settings, "SENTRY_DSN", "")):
        failures.append("SENTRY_DSN cannot use placeholder/example values in prod")

    if not getattr(settings, "ALLOWED_HOSTS", []):
        failures.append("ALLOWED_HOSTS must be configured in staging/prod")
    if not getattr(settings, "CSRF_TRUSTED_ORIGINS", []):
        failures.append("CSRF_TRUSTED_ORIGINS must be configured in staging/prod")
    if not getattr(settings, "CORS_ALLOWED_ORIGINS", []):
        failures.append("CORS_ALLOWED_ORIGINS must be configured in staging/prod")

    canonical_api_base_url = str(getattr(settings, "CANONICAL_API_BASE_URL", "") or "").strip()
    if not canonical_api_base_url:
        failures.append("CANONICAL_API_BASE_URL must be configured")
    elif not canonical_api_base_url.startswith("https://"):
        failures.append("CANONICAL_API_BASE_URL must use https")
    elif _is_placeholder(canonical_api_base_url):
        failures.append("CANONICAL_API_BASE_URL cannot use placeholder/example values")

    canonical_host = urlparse(canonical_api_base_url).hostname if canonical_api_base_url else ""
    allowed_hosts = {str(value).strip().lower() for value in getattr(settings, "ALLOWED_HOSTS", []) if str(value).strip()}
    if canonical_host and allowed_hosts and canonical_host.lower() not in allowed_hosts:
        failures.append("CANONICAL_API_BASE_URL host must be present in ALLOWED_HOSTS")

    canonical_origin = canonical_api_base_url.rstrip("/").lower()
    csrf_trusted_origins = {str(value).strip().rstrip("/").lower() for value in getattr(settings, "CSRF_TRUSTED_ORIGINS", []) if str(value).strip()}
    if canonical_origin and csrf_trusted_origins and canonical_origin not in csrf_trusted_origins:
        failures.append("CANONICAL_API_BASE_URL origin must be present in CSRF_TRUSTED_ORIGINS")

    frontend_app_url = str(getattr(settings, "FRONTEND_APP_URL", "") or "").strip()
    if not frontend_app_url:
        failures.append("FRONTEND_APP_URL must be configured")
    elif not frontend_app_url.startswith("https://"):
        failures.append("FRONTEND_APP_URL must use https")
    elif _is_placeholder(frontend_app_url):
        failures.append("FRONTEND_APP_URL cannot use placeholder/example values")

    failures.extend(_validate_public_url_setting(label="STATIC_URL", value=getattr(settings, "STATIC_URL", "")))
    failures.extend(_validate_public_url_setting(label="MEDIA_URL", value=getattr(settings, "MEDIA_URL", "")))

    static_root = Path(str(getattr(settings, "STATIC_ROOT", "") or "")).expanduser()
    media_root = Path(str(getattr(settings, "MEDIA_ROOT", "") or "")).expanduser()
    if not static_root:
        failures.append("STATIC_ROOT must be configured")
    if not media_root:
        failures.append("MEDIA_ROOT must be configured")
    if static_root and media_root and static_root.resolve() == media_root.resolve():
        failures.append("STATIC_ROOT and MEDIA_ROOT must be different directories")
    if int(getattr(settings, "MEDIA_ASSET_MAX_BYTES", 0) or 0) <= 0:
        failures.append("MEDIA_ASSET_MAX_BYTES must be a positive integer")

    forwarded_allow_ips = str(os.getenv("GUNICORN_FORWARDED_ALLOW_IPS", "") or "").strip()
    if app_env == "prod" and not forwarded_allow_ips:
        failures.append("GUNICORN_FORWARDED_ALLOW_IPS must be explicitly configured in prod")
    if forwarded_allow_ips == "*":
        failures.append("GUNICORN_FORWARDED_ALLOW_IPS cannot be '*' in staging/prod")
    invalid_forwarded_allow_ips = invalid_allowlist_entries([item.strip() for item in forwarded_allow_ips.split(",") if item.strip()])
    if invalid_forwarded_allow_ips:
        failures.append("Invalid GUNICORN_FORWARDED_ALLOW_IPS entries: " + ", ".join(invalid_forwarded_allow_ips))

    if bool(getattr(settings, "TRUST_X_FORWARDED_FOR", False)) and not getattr(settings, "TRUSTED_PROXY_IPS", []):
        failures.append("TRUSTED_PROXY_IPS must be configured when TRUST_X_FORWARDED_FOR=True")

    allowlists = {
        "TRUSTED_PROXY_IPS": list(getattr(settings, "TRUSTED_PROXY_IPS", []) or []),
        "METRICS_IP_ALLOWLIST": list(getattr(settings, "METRICS_IP_ALLOWLIST", []) or []),
        "IYZICO_WEBHOOK_IP_ALLOWLIST": list(getattr(settings, "IYZICO_WEBHOOK_IP_ALLOWLIST", []) or []),
    }
    for key, values in allowlists.items():
        invalid = invalid_allowlist_entries(values)
        if invalid:
            failures.append(f"Invalid {key} entries: {', '.join(invalid)}")

    if app_env == "prod" and bool(getattr(settings, "METRICS_ALLOW_QUERY_TOKEN", False)):
        failures.append("METRICS_ALLOW_QUERY_TOKEN must be False in prod")
    if not getattr(settings, "METRICS_TOKEN", "") and not getattr(settings, "METRICS_IP_ALLOWLIST", []):
        failures.append("Metrics must be protected by METRICS_TOKEN and/or METRICS_IP_ALLOWLIST")
    elif getattr(settings, "METRICS_TOKEN", "") and _is_placeholder(getattr(settings, "METRICS_TOKEN", "")):
        failures.append("METRICS_TOKEN cannot use placeholder/example values in staging/prod")
    elif getattr(settings, "METRICS_TOKEN", "") and len(str(getattr(settings, "METRICS_TOKEN", ""))) < 16:
        failures.append("METRICS_TOKEN must be at least 16 characters long in staging/prod")

    _validate_configured_value(failures, label="GOOGLE_OAUTH_CLIENT_ID", value=getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ""))
    _validate_configured_value(failures, label="FCM_PROJECT_ID", value=getattr(settings, "FCM_PROJECT_ID", ""))
    _validate_configured_value(failures, label="FCM_CLIENT_EMAIL", value=getattr(settings, "FCM_CLIENT_EMAIL", ""))
    _validate_configured_value(failures, label="FCM_PRIVATE_KEY", value=getattr(settings, "FCM_PRIVATE_KEY", ""), min_length=32)
    if getattr(settings, "FCM_PRIVATE_KEY", "") and "BEGIN PRIVATE KEY" not in str(getattr(settings, "FCM_PRIVATE_KEY", "")):
        failures.append("FCM_PRIVATE_KEY must contain a PEM private key")

    email_backend = str(getattr(settings, "EMAIL_BACKEND", "") or "")
    if bool(getattr(settings, "EMAIL_NOTIFICATIONS_ENABLED", False)):
        if email_backend.endswith((".console.EmailBackend", ".locmem.EmailBackend", ".dummy.EmailBackend", ".filebased.EmailBackend")):
            failures.append("EMAIL_BACKEND must be a real SMTP/provider backend when EMAIL_NOTIFICATIONS_ENABLED=True")
        _validate_configured_value(
            failures,
            label="EMAIL_HOST",
            value=getattr(settings, "EMAIL_HOST", ""),
            reject_placeholders=False,
        )
        if int(getattr(settings, "EMAIL_PORT", 0) or 0) <= 0:
            failures.append("EMAIL_PORT must be a positive integer when EMAIL_NOTIFICATIONS_ENABLED=True")
        _validate_configured_value(
            failures,
            label="DEFAULT_FROM_EMAIL",
            value=getattr(settings, "DEFAULT_FROM_EMAIL", ""),
            reject_placeholders=False,
        )
        if _is_non_deliverable_email_domain(getattr(settings, "DEFAULT_FROM_EMAIL", "")):
            failures.append("DEFAULT_FROM_EMAIL must use a deliverable verified sender domain when EMAIL_NOTIFICATIONS_ENABLED=True")
        _validate_configured_value(
            failures,
            label="NOTIFICATION_EMAIL_FROM",
            value=getattr(settings, "NOTIFICATION_EMAIL_FROM", ""),
            reject_placeholders=False,
        )
        if _is_non_deliverable_email_domain(getattr(settings, "NOTIFICATION_EMAIL_FROM", "")):
            failures.append("NOTIFICATION_EMAIL_FROM must use a deliverable verified sender domain when EMAIL_NOTIFICATIONS_ENABLED=True")
        if bool(getattr(settings, "EMAIL_USE_TLS", False)) and bool(getattr(settings, "EMAIL_USE_SSL", False)):
            failures.append("EMAIL_USE_TLS and EMAIL_USE_SSL cannot both be True")

    topup_provider = str(getattr(settings, "TOPUP_PROVIDER", "manual") or "manual").strip().lower()
    if topup_provider not in {"manual", "halkyemek", "mock", "iyzico"}:
        failures.append("TOPUP_PROVIDER must be manual or iyzico")
    if topup_provider in {"manual", "halkyemek", "mock"}:
        _validate_configured_value(
            failures,
            label="MANUAL_TOPUP_ACCOUNT_NAME",
            value=getattr(settings, "MANUAL_TOPUP_ACCOUNT_NAME", ""),
            reject_placeholders=False,
        )

    if _uses_iyzico_money_provider():
        _validate_configured_value(failures, label="IYZICO_API_KEY", value=getattr(settings, "IYZICO_API_KEY", ""), min_length=8)
        _validate_configured_value(failures, label="IYZICO_SECRET_KEY", value=getattr(settings, "IYZICO_SECRET_KEY", ""), min_length=8)
        _validate_configured_value(failures, label="IYZICO_BASE_URL", value=getattr(settings, "IYZICO_BASE_URL", ""), reject_placeholders=False)
        failures.extend(
            _matches_iyzico_environment(
                app_env=app_env,
                iyzico_env=getattr(settings, "IYZICO_ENV", ""),
                iyzico_base_url=getattr(settings, "IYZICO_BASE_URL", ""),
            )
        )
    _validate_configured_value(
        failures,
        label="PAYMENT_WEBHOOK_SECRET",
        value=getattr(settings, "PAYMENT_WEBHOOK_SECRET", ""),
        min_length=16,
    )

    settlement_dir_keys = [
        "SETTLEMENT_IMPORT_INBOX_DIR",
        "SETTLEMENT_IMPORT_ARCHIVE_DIR",
        "SETTLEMENT_IMPORT_FAILED_DIR",
    ]
    settlement_dirs = [str(getattr(settings, key, "") or "").strip() for key in settlement_dir_keys]
    if any(settlement_dirs) and not all(settlement_dirs):
        failures.append("Settlement import directories must be configured together (inbox/archive/failed)")
    non_empty_settlement_dirs = [Path(value).as_posix() for value in settlement_dirs if value]
    if len(non_empty_settlement_dirs) != len(set(non_empty_settlement_dirs)):
        failures.append("Settlement import directories must be different from each other")
    if non_empty_settlement_dirs and not all(Path(path).is_absolute() for path in non_empty_settlement_dirs):
        failures.append("Settlement import directories must be absolute paths")

    settlement_upload_dir = str(getattr(settings, "SETTLEMENT_IMPORT_UPLOAD_DIR", "") or "").strip()
    if settlement_upload_dir:
        upload_path = Path(settlement_upload_dir).as_posix()
        if not Path(upload_path).is_absolute():
            failures.append("SETTLEMENT_IMPORT_UPLOAD_DIR must be an absolute path when configured")
        if upload_path in set(non_empty_settlement_dirs):
            failures.append("SETTLEMENT_IMPORT_UPLOAD_DIR must be different from inbox/archive/failed directories")

    if int(getattr(settings, "SCHEDULER_HEARTBEAT_TTL_SECONDS", 0) or 0) <= int(getattr(settings, "CELERY_BEAT_MAX_LOOP_INTERVAL", 0) or 0):
        failures.append("SCHEDULER_HEARTBEAT_TTL_SECONDS must be greater than CELERY_BEAT_MAX_LOOP_INTERVAL")

    if include_runtime_checks:
        from health.views import _runtime_core_checks

        for name, ok in _runtime_core_checks().items():
            if not ok:
                failures.append(f"runtime check failed: {name}")

    return failures


def assert_runtime_configuration_ready() -> None:
    failures = collect_runtime_validation_failures(include_runtime_checks=False)
    if failures:
        raise RuntimeError("; ".join(failures))
