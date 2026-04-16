from __future__ import annotations

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from common.network import invalid_allowlist_entries


"""Uygulama canlıya çıkarken kritik ayarlar eksikse sistem başlamasın."""


def _is_unsafe_secret(secret: str) -> bool:
    lowered = (secret or "").strip().lower()
    return not lowered or lowered in {"unsafe-dev-secret", "change-me", "secret", "dev-secret"}


def assert_production_security_ready() -> None:
    required = {
        "GOOGLE_OAUTH_CLIENT_ID": getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", ""),
        "FCM_PROJECT_ID": getattr(settings, "FCM_PROJECT_ID", ""),
        "FCM_CLIENT_EMAIL": getattr(settings, "FCM_CLIENT_EMAIL", ""),
        "FCM_PRIVATE_KEY": getattr(settings, "FCM_PRIVATE_KEY", ""),
        "DJANGO_SECRET_KEY": getattr(settings, "SECRET_KEY", ""),
        "CSRF_TRUSTED_ORIGINS": getattr(settings, "CSRF_TRUSTED_ORIGINS", []),
    }

    missing = [key for key, value in required.items() if not value]
    if missing:
        raise ImproperlyConfigured(
            f"Missing required production settings: {', '.join(missing)}"
        )

    if _is_unsafe_secret(getattr(settings, "SECRET_KEY", "")):
        raise ImproperlyConfigured("Production SECRET_KEY is missing or unsafe.")

    release_version = str(getattr(settings, "RELEASE_VERSION", "") or "").strip().lower()
    if release_version in {"", "dev", "local", "latest"}:
        raise ImproperlyConfigured("Production RELEASE_VERSION must be an immutable non-dev value.")

    canonical_api_base_url = str(getattr(settings, "CANONICAL_API_BASE_URL", "") or "").strip()
    if not canonical_api_base_url.startswith("https://"):
        raise ImproperlyConfigured("Production CANONICAL_API_BASE_URL must be configured with https://.")

    default_db = settings.DATABASES.get("default", {})
    if default_db.get("ENGINE") == "django.db.backends.sqlite3":
        raise ImproperlyConfigured("Production database cannot use sqlite3.")

    cache_backend = settings.CACHES.get("default", {}).get("BACKEND", "")
    if cache_backend.endswith("LocMemCache"):
        raise ImproperlyConfigured(
            "Production cache cannot use LocMemCache. Configure REDIS_CACHE_URL or another shared cache backend."
        )

    metrics_token = getattr(settings, "METRICS_TOKEN", "")
    metrics_allowlist = getattr(settings, "METRICS_IP_ALLOWLIST", [])
    if not metrics_token and not metrics_allowlist:
        raise ImproperlyConfigured(
            "Protect /health/metrics/ with METRICS_TOKEN and/or METRICS_IP_ALLOWLIST in production."
        )
    if getattr(settings, "METRICS_ALLOW_QUERY_TOKEN", False):
        raise ImproperlyConfigured(
            "METRICS_ALLOW_QUERY_TOKEN must be disabled in production to avoid credential leaks in access logs."
        )

    if bool(getattr(settings, "TRUST_X_FORWARDED_FOR", False)) and not getattr(settings, "TRUSTED_PROXY_IPS", []):
        raise ImproperlyConfigured(
            "TRUSTED_PROXY_IPS must be configured when TRUST_X_FORWARDED_FOR=True in production."
        )

    allowlists = {
        "TRUSTED_PROXY_IPS": list(getattr(settings, "TRUSTED_PROXY_IPS", []) or []),
        "METRICS_IP_ALLOWLIST": list(getattr(settings, "METRICS_IP_ALLOWLIST", []) or []),
        "IYZICO_WEBHOOK_IP_ALLOWLIST": list(getattr(settings, "IYZICO_WEBHOOK_IP_ALLOWLIST", []) or []),
    }
    for key, values in allowlists.items():
        invalid = invalid_allowlist_entries(values)
        if invalid:
            raise ImproperlyConfigured(
                f"Invalid {key} entries: {', '.join(invalid)}"
            )

    if not getattr(settings, "SENTRY_DSN", ""):
        raise ImproperlyConfigured("Production SENTRY_DSN cannot be empty.")

    if not getattr(settings, "CELERY_BROKER_URL", ""):
        raise ImproperlyConfigured("Production CELERY_BROKER_URL cannot be empty.")

    if not getattr(settings, "CELERY_RESULT_BACKEND", ""):
        raise ImproperlyConfigured("Production CELERY_RESULT_BACKEND cannot be empty.")
