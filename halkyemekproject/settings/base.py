import json
import logging
import os
import socket
import sys
from datetime import timedelta
from pathlib import Path
from typing import Any, Optional, cast

import environ


env = environ.Env(DEBUG=(bool, False))

BASE_DIR = Path(__file__).resolve().parents[2]
env.read_env(os.path.join(BASE_DIR, ".env"))


CORS_DEFAULT_ALLOW_HEADERS = (
    "accept",
    "authorization",
    "content-type",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
)


def env_str(name: str, *, default: str = "") -> str:
    value = os.getenv(name)
    return value if value is not None else default


def env_bool(name: str, *, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, *, default: int = 0) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return int(value)


def env_float(name: str, *, default: float = 0.0) -> float:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return float(value)


def env_list(name: str, *, default: Optional[list[str]] = None) -> list[str]:
    value = os.getenv(name)
    if value is None:
        return list(default or [])
    items = [item.strip() for item in value.split(",")]
    return [item for item in items if item]


def env_db(name: str, *, default: str) -> dict[str, Any]:
    return cast(dict[str, Any], environ.Env.db_url_config(os.getenv(name, default)))

APP_NAME = env_str("APP_NAME", default="halkyemek")
APP_ENV = env_str("APP_ENV", default=os.getenv("DJANGO_ENV", "dev") or "dev").lower()
RELEASE_VERSION = env_str("RELEASE_VERSION", default="dev")
DEBUG = env_bool("DEBUG", default=False)
SENTRY_DSN = env_str("SENTRY_DSN", default="")
SENTRY_ENVIRONMENT = env_str("SENTRY_ENVIRONMENT", default=APP_ENV)
SENTRY_TRACES_SAMPLE_RATE = env_float("SENTRY_TRACES_SAMPLE_RATE", default=0.0)
TESTING = "test" in sys.argv

SECRET_KEY = env_str("DJANGO_SECRET_KEY", default=env_str("SECRET_KEY", default="unsafe-dev-secret"))
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", default=[])
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    default=["http://localhost:3000", "http://127.0.0.1:3000"] if APP_ENV == "dev" else [],
)
CORS_ALLOW_HEADERS = (*CORS_DEFAULT_ALLOW_HEADERS, "x-request-id")
CORS_EXPOSE_HEADERS = ["X-Request-ID"]
CORS_ALLOW_CREDENTIALS = False
GOOGLE_OAUTH_CLIENT_ID = env_str("GOOGLE_OAUTH_CLIENT_ID", default="")
CANONICAL_API_BASE_URL = env_str("CANONICAL_API_BASE_URL", default="")
FRONTEND_APP_URL = env_str(
    "FRONTEND_APP_URL",
    default=env_str("NEXT_PUBLIC_APP_URL", default="http://localhost:3000" if APP_ENV == "dev" else ""),
)

FCM_PROJECT_ID = env_str("FCM_PROJECT_ID", default="")
FCM_CLIENT_EMAIL = env_str("FCM_CLIENT_EMAIL", default="")
FCM_PRIVATE_KEY = env_str("FCM_PRIVATE_KEY", default="")
FCM_WEB_VAPID_KEY = env_str("FCM_WEB_VAPID_KEY", default="")

IYZICO_SECRET_KEY = env_str("IYZICO_SECRET_KEY", default="")
IYZICO_API_KEY = env_str("IYZICO_API_KEY", default="")
IYZICO_BASE_URL = env_str(
    "IYZICO_BASE_URL",
    default="https://sandbox-api.iyzipay.com" if APP_ENV in {"dev", "staging", "test"} else "https://api.iyzipay.com",
)
IYZICO_ENV = env_str(
    "IYZICO_ENV",
    default="sandbox" if APP_ENV in {"dev", "staging", "test"} else "production",
).lower()
IYZICO_ENFORCE_ENV_MATCH = env_bool("IYZICO_ENFORCE_ENV_MATCH", default=True)
IYZICO_REQUEST_TIMEOUT_SECONDS = env_int("IYZICO_REQUEST_TIMEOUT_SECONDS", default=20)
IYZICO_REQUEST_MAX_ATTEMPTS = env_int("IYZICO_REQUEST_MAX_ATTEMPTS", default=3)
IYZICO_REQUEST_RETRY_BACKOFF_SECONDS = env_float("IYZICO_REQUEST_RETRY_BACKOFF_SECONDS", default=0.5)
IYZICO_REQUEST_RETRY_MAX_SLEEP_SECONDS = env_float("IYZICO_REQUEST_RETRY_MAX_SLEEP_SECONDS", default=8.0)
IYZICO_REQUEST_RETRY_JITTER_RATIO = env_float("IYZICO_REQUEST_RETRY_JITTER_RATIO", default=0.2)
IYZICO_MASS_PAYOUT_PURPOSE = env_str("IYZICO_MASS_PAYOUT_PURPOSE", default="SETTLEMENT")
IYZICO_MASS_PAYOUT_TIMEOUT_SECONDS = env_int("IYZICO_MASS_PAYOUT_TIMEOUT_SECONDS", default=20)
IYZICO_MASS_PAYOUT_MAX_ATTEMPTS = env_int("IYZICO_MASS_PAYOUT_MAX_ATTEMPTS", default=3)
IYZICO_MASS_PAYOUT_RETRY_BACKOFF_SECONDS = env_float("IYZICO_MASS_PAYOUT_RETRY_BACKOFF_SECONDS", default=0.5)
IYZICO_MASS_PAYOUT_RETRY_MAX_SLEEP_SECONDS = env_float("IYZICO_MASS_PAYOUT_RETRY_MAX_SLEEP_SECONDS", default=8.0)
IYZICO_MASS_PAYOUT_RETRY_JITTER_RATIO = env_float("IYZICO_MASS_PAYOUT_RETRY_JITTER_RATIO", default=0.2)
IYZICO_MASS_PAYOUT_LOCALE = env_str("IYZICO_MASS_PAYOUT_LOCALE", default="tr")
IYZICO_SUBMERCHANT_TIMEOUT_SECONDS = env_int("IYZICO_SUBMERCHANT_TIMEOUT_SECONDS", default=20)
IYZICO_SUBMERCHANT_MAX_ATTEMPTS = env_int("IYZICO_SUBMERCHANT_MAX_ATTEMPTS", default=3)
IYZICO_SUBMERCHANT_RETRY_BACKOFF_SECONDS = env_float("IYZICO_SUBMERCHANT_RETRY_BACKOFF_SECONDS", default=0.5)
IYZICO_SUBMERCHANT_RETRY_MAX_SLEEP_SECONDS = env_float("IYZICO_SUBMERCHANT_RETRY_MAX_SLEEP_SECONDS", default=8.0)
IYZICO_SUBMERCHANT_RETRY_JITTER_RATIO = env_float("IYZICO_SUBMERCHANT_RETRY_JITTER_RATIO", default=0.2)
IYZICO_SUBMERCHANT_LOCK_TTL_SECONDS = env_int("IYZICO_SUBMERCHANT_LOCK_TTL_SECONDS", default=120)

AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
ORDER_QR_TTL_HOURS = env_int("ORDER_QR_TTL_HOURS", default=24)

DATABASES = {
    "default": env_db("DATABASE_URL", default=f"sqlite:///{(BASE_DIR / 'db.sqlite3').as_posix()}")
}
DATABASES["default"].setdefault("CONN_MAX_AGE", env_int("DB_CONN_MAX_AGE", default=60 if not DEBUG else 0))
DATABASES["default"].setdefault("CONN_HEALTH_CHECKS", True)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "idempotency.apps.IdempotencyConfig",
    "notifications",
    "accounts",
    "wallets.apps.WalletsConfig",
    "businesses",
    "menus",
    "orders",
    "payments",
    "logs",
    "payouts",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "drf_spectacular",
    "common",
    "health",
]

SPECTACULAR_SETTINGS = {
    "TITLE": "HalkYemek API",
    "DESCRIPTION": "Beylikdüzü odaklı QR + Wallet yemek sistemi",
    "VERSION": RELEASE_VERSION,
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SECURITY": [{"bearerAuth": []}],
    "SWAGGER_UI_SETTINGS": {"persistAuthorization": True},
    "TAGS": [
        {"name": "auth", "description": "Authentication ve JWT token alma yüzeyi."},
        {"name": "discovery", "description": "Public katalog, discovery ve işletme menüsü yüzeyi."},
        {"name": "notifications", "description": "Push device kaydı, readiness ve broadcast yüzeyi."},
        {"name": "cart", "description": "Cart yönetimi ve checkout öncesi preview yüzeyi."},
        {"name": "checkout", "description": "Cart-backed checkout session ve QR consume yüzeyi."},
        {"name": "orders", "description": "Kullanıcının veya business member'ın erişebildiği order kayıtları."},
        {"name": "wallet", "description": "Wallet bakiye ve işlem geçmişi yüzeyi."},
        {"name": "payments", "description": "Topup payment intent ve payment retrieval yüzeyi."},
        {"name": "business-operations", "description": "Business member operasyon ekranları."},
        {"name": "ops-businesses", "description": "Admin business operasyon yüzeyi."},
        {"name": "ops-payments", "description": "Admin refund, reversal ve chargeback yüzeyi."},
        {"name": "ops-settlement", "description": "Admin settlement import ve reconciliation yüzeyi."},
        {"name": "ops-payouts", "description": "Admin payout dispatch, confirm ve reconciliation yüzeyi."},
    ],
}

MAX_REQUEST_BODY_BYTES = env_int("MAX_REQUEST_BODY_BYTES", default=1048576)
WEBHOOK_MAX_BODY_BYTES = env_int("WEBHOOK_MAX_BODY_BYTES", default=256 * 1024)
IYZICO_WEBHOOK_IP_ALLOWLIST = env_list("IYZICO_WEBHOOK_IP_ALLOWLIST", default=[])
METRICS_TOKEN = env_str("METRICS_TOKEN", default="")
METRICS_IP_ALLOWLIST = env_list("METRICS_IP_ALLOWLIST", default=[])
METRICS_ALLOW_QUERY_TOKEN = env_bool("METRICS_ALLOW_QUERY_TOKEN", default=False)
TRUST_X_FORWARDED_FOR = env_bool("TRUST_X_FORWARDED_FOR", default=not DEBUG)
TRUSTED_PROXY_IPS = env_list("TRUSTED_PROXY_IPS", default=[])
JOB_HEARTBEAT_TTL_SECONDS = env_int("JOB_HEARTBEAT_TTL_SECONDS", default=15 * 60)
INTEGRITY_HEARTBEAT_TTL_SECONDS = env_int("INTEGRITY_HEARTBEAT_TTL_SECONDS", default=2 * 60 * 60)
ANOMALY_HEARTBEAT_TTL_SECONDS = env_int("ANOMALY_HEARTBEAT_TTL_SECONDS", default=2 * 60 * 60)
PAYOUT_BATCH_CREATE_HEARTBEAT_TTL_SECONDS = env_int("PAYOUT_BATCH_CREATE_HEARTBEAT_TTL_SECONDS", default=45 * 60)
PAYOUT_DISPATCH_HEARTBEAT_TTL_SECONDS = env_int("PAYOUT_DISPATCH_HEARTBEAT_TTL_SECONDS", default=30 * 60)
PAYOUT_SYNC_HEARTBEAT_TTL_SECONDS = env_int("PAYOUT_SYNC_HEARTBEAT_TTL_SECONDS", default=30 * 60)
PAYOUT_ELIGIBILITY_HEARTBEAT_TTL_SECONDS = env_int("PAYOUT_ELIGIBILITY_HEARTBEAT_TTL_SECONDS", default=2 * 60 * 60)
SETTLEMENT_REPROCESS_HEARTBEAT_TTL_SECONDS = env_int("SETTLEMENT_REPROCESS_HEARTBEAT_TTL_SECONDS", default=45 * 60)
SETTLEMENT_IMPORT_HEARTBEAT_TTL_SECONDS = env_int("SETTLEMENT_IMPORT_HEARTBEAT_TTL_SECONDS", default=2 * 60 * 60)
SETTLEMENT_IMPORT_INBOX_DIR = env_str("SETTLEMENT_IMPORT_INBOX_DIR", default="")
SETTLEMENT_IMPORT_ARCHIVE_DIR = env_str("SETTLEMENT_IMPORT_ARCHIVE_DIR", default="")
SETTLEMENT_IMPORT_FAILED_DIR = env_str("SETTLEMENT_IMPORT_FAILED_DIR", default="")
SETTLEMENT_IMPORT_UPLOAD_DIR = env_str("SETTLEMENT_IMPORT_UPLOAD_DIR", default="")
SETTLEMENT_IMPORT_UPLOAD_MAX_BYTES = env_int("SETTLEMENT_IMPORT_UPLOAD_MAX_BYTES", default=5 * 1024 * 1024)

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.AnonRateThrottle",
    ),
    "DEFAULT_PAGINATION_CLASS": "common.pagination.DefaultPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "logs.drf_exception_handler.custom_exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "anon": "200/hour",
        "user": "2000/hour",
        "auth_google": "10/min",
        "device_upsert": "20/min",
        "order_create": "10/min",
        "qr_use": "20/min",
        "payment_create": "10/min",
        "checkout_session_create": "20/min",
        "checkout_session_consume": "40/min",
        "cart_action": "120/min",
        "checkout_preview": "60/min",
        "admin_broadcast": "5/min",
        "marketplace_admin": "10/min",
        "ops": "30/min",
    },
}

MIDDLEWARE = [
    "common.middleware.RequestIdMiddleware",
    "common.middleware.RequestLoggingMiddleware",
    "common.middleware.QueryCountMiddleware",
    "common.webhook_security.WebhookBodyLimitMiddleware",
    "common.middleware.BodySizeLimitMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

redis_cache_url = env_str("REDIS_CACHE_URL", default="")
if redis_cache_url:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": redis_cache_url,
            "TIMEOUT": 300,
            "KEY_PREFIX": APP_NAME,
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": f"{APP_NAME}-cache",
            "TIMEOUT": 60,
        }
    }

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "UPDATE_LAST_LOGIN": True,
}

PAYOUT_MAX_ATTEMPTS = env_int("PAYOUT_MAX_ATTEMPTS", default=8)
PAYOUT_RETRY_BASE_SECONDS = env_int("PAYOUT_RETRY_BASE_SECONDS", default=60)
PAYOUT_RETRY_MAX_SECONDS = env_int("PAYOUT_RETRY_MAX_SECONDS", default=6 * 60 * 60)
PAYOUT_LOCK_TTL_SECONDS = env_int("PAYOUT_LOCK_TTL_SECONDS", default=10 * 60)
PROCESS_NOTIFICATIONS_LOCK_TTL_SECONDS = env_int("PROCESS_NOTIFICATIONS_LOCK_TTL_SECONDS", default=60)
CLEANUP_CHECKOUT_SESSIONS_LOCK_TTL_SECONDS = env_int("CLEANUP_CHECKOUT_SESSIONS_LOCK_TTL_SECONDS", default=300)
RUN_PAYOUT_ELIGIBILITY_LOCK_TTL_SECONDS = env_int("RUN_PAYOUT_ELIGIBILITY_LOCK_TTL_SECONDS", default=3600)
CREATE_PAYOUT_BATCH_LOCK_TTL_SECONDS = env_int("CREATE_PAYOUT_BATCH_LOCK_TTL_SECONDS", default=900)
DISPATCH_DUE_PAYOUTS_LOCK_TTL_SECONDS = env_int("DISPATCH_DUE_PAYOUTS_LOCK_TTL_SECONDS", default=300)
SYNC_SENT_PAYOUT_STATUSES_LOCK_TTL_SECONDS = env_int("SYNC_SENT_PAYOUT_STATUSES_LOCK_TTL_SECONDS", default=300)
SETTLEMENT_REPROCESS_LOCK_TTL_SECONDS = env_int("SETTLEMENT_REPROCESS_LOCK_TTL_SECONDS", default=900)
IMPORT_PENDING_SETTLEMENT_FILES_LOCK_TTL_SECONDS = env_int("IMPORT_PENDING_SETTLEMENT_FILES_LOCK_TTL_SECONDS", default=900)
VERIFY_FINANCIAL_INTEGRITY_LOCK_TTL_SECONDS = env_int("VERIFY_FINANCIAL_INTEGRITY_LOCK_TTL_SECONDS", default=7200)
REPORT_FINANCIAL_ANOMALIES_LOCK_TTL_SECONDS = env_int("REPORT_FINANCIAL_ANOMALIES_LOCK_TTL_SECONDS", default=3600)
SETTLEMENT_REPROCESS_MAX_ATTEMPTS = env_int("SETTLEMENT_REPROCESS_MAX_ATTEMPTS", default=12)
SETTLEMENT_REPROCESS_BASE_SECONDS = env_int("SETTLEMENT_REPROCESS_BASE_SECONDS", default=300)
SETTLEMENT_REPROCESS_MAX_SECONDS = env_int("SETTLEMENT_REPROCESS_MAX_SECONDS", default=86400)
NOTIFICATION_ENQUEUE_DEDUP_TTL_SECONDS = env_int("NOTIFICATION_ENQUEUE_DEDUP_TTL_SECONDS", default=300)
PAYOUT_DELAY_DAYS = env_int("PAYOUT_DELAY_DAYS", default=3)
BUSINESS_EARNING_HOLD_HOURS = env_int("BUSINESS_EARNING_HOLD_HOURS", default=PAYOUT_DELAY_DAYS * 24)
BUSINESS_PLATFORM_FEE_BPS = env_int("BUSINESS_PLATFORM_FEE_BPS", default=0)
CUSTOMER_FIXED_FEE_KURUS = env_int("CUSTOMER_FIXED_FEE_KURUS", default=1000)
BUSINESS_FIXED_FEE_KURUS = env_int("BUSINESS_FIXED_FEE_KURUS", default=1000)
CELERY_VISIBILITY_TIMEOUT = env_int("CELERY_VISIBILITY_TIMEOUT", default=6 * 60 * 60)
CELERY_BROKER_CONNECTION_MAX_RETRIES = env_int("CELERY_BROKER_CONNECTION_MAX_RETRIES", default=100)
READINESS_CACHE_TIMEOUT_SECONDS = env_float("READINESS_CACHE_TIMEOUT_SECONDS", default=1.0)
READINESS_BROKER_TIMEOUT_SECONDS = env_float("READINESS_BROKER_TIMEOUT_SECONDS", default=1.0)
CELERY_BEAT_MAX_LOOP_INTERVAL = env_int("CELERY_BEAT_MAX_LOOP_INTERVAL", default=60)
SCHEDULER_HEARTBEAT_TTL_SECONDS = env_int(
    "SCHEDULER_HEARTBEAT_TTL_SECONDS",
    default=max(CELERY_BEAT_MAX_LOOP_INTERVAL * 3, 180),
)
BEAT_JOB_EXPIRES_SHORT_SECONDS = env_int("BEAT_JOB_EXPIRES_SHORT_SECONDS", default=240)
BEAT_JOB_EXPIRES_MEDIUM_SECONDS = env_int("BEAT_JOB_EXPIRES_MEDIUM_SECONDS", default=1200)
BEAT_JOB_EXPIRES_LONG_SECONDS = env_int("BEAT_JOB_EXPIRES_LONG_SECONDS", default=3900)


CELERY_BROKER_URL = env_str("CELERY_BROKER_URL", default=env_str("REDIS_CACHE_URL", default="redis://redis:6379/1"))
CELERY_RESULT_BACKEND = env_str("CELERY_RESULT_BACKEND", default=CELERY_BROKER_URL)
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER", default=False)
CELERY_TASK_EAGER_PROPAGATES = env_bool("CELERY_TASK_EAGER_PROPAGATES", default=TESTING)
CELERY_TASK_TIME_LIMIT = env_int("CELERY_TASK_TIME_LIMIT", default=15 * 60)
CELERY_TASK_SOFT_TIME_LIMIT = env_int("CELERY_TASK_SOFT_TIME_LIMIT", default=10 * 60)
CELERY_WORKER_PREFETCH_MULTIPLIER = env_int("CELERY_WORKER_PREFETCH_MULTIPLIER", default=1)
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_IGNORE_RESULT = True
CELERY_WORKER_SEND_TASK_EVENTS = True
CELERY_TASK_SEND_SENT_EVENT = True
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
CELERY_TIMEZONE = env_str("TIME_ZONE", default="Europe/Istanbul")
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_BROKER_TRANSPORT_OPTIONS = {
    "visibility_timeout": CELERY_VISIBILITY_TIMEOUT,
    "fanout_prefix": True,
    "fanout_patterns": True,
}
CELERY_RESULT_BACKEND_TRANSPORT_OPTIONS = {
    "visibility_timeout": CELERY_VISIBILITY_TIMEOUT,
}
CELERY_TASK_ROUTES = {
    "common.tasks.record_scheduler_heartbeat_task": {"queue": "ops"},
    "notifications.tasks.process_notifications_task": {"queue": "ops"},
    "notifications.tasks.send_notification_attempt_task": {"queue": "notifications"},
    "notifications.tasks.process_notification_attempts_for_notification_task": {"queue": "notifications"},
    "orders.tasks.cleanup_checkout_sessions_task": {"queue": "ops"},
    "payments.tasks.reprocess_unmatched_settlement_records_task": {"queue": "finance"},
    "payments.tasks.import_pending_settlement_files_task": {"queue": "finance"},
    "payments.tasks.report_financial_anomalies_task": {"queue": "ops_heavy"},
    "payouts.tasks.run_payout_eligibility_task": {"queue": "finance"},
    "payouts.tasks.create_payout_batch_task": {"queue": "finance"},
    "payouts.tasks.dispatch_due_payouts_task": {"queue": "finance"},
    "payouts.tasks.sync_sent_payout_statuses_task": {"queue": "finance"},
    "payouts.tasks.verify_financial_integrity_task": {"queue": "ops_heavy"},
}
CELERY_BEAT_SCHEDULE = {
    "record_scheduler_heartbeat_every_minute": {
        "task": "common.tasks.record_scheduler_heartbeat_task",
        "schedule": 60.0,
        "options": {"expires": min(BEAT_JOB_EXPIRES_SHORT_SECONDS, 60)},
    },
    "process_notifications_every_minute": {
        "task": "notifications.tasks.process_notifications_task",
        "schedule": 60.0,
        "kwargs": {"limit": 100},
        "options": {"expires": min(BEAT_JOB_EXPIRES_SHORT_SECONDS, 60)},
    },
    "dispatch_due_payouts_every_five_minutes": {
        "task": "payouts.tasks.dispatch_due_payouts_task",
        "schedule": 300.0,
        "kwargs": {"limit": 50},
        "options": {"expires": min(BEAT_JOB_EXPIRES_SHORT_SECONDS, 300)},
    },
    "sync_sent_payout_statuses_every_five_minutes": {
        "task": "payouts.tasks.sync_sent_payout_statuses_task",
        "schedule": 300.0,
        "kwargs": {"limit": 50},
        "options": {"expires": min(BEAT_JOB_EXPIRES_SHORT_SECONDS, 300)},
    },
    "cleanup_checkout_sessions_every_five_minutes": {
        "task": "orders.tasks.cleanup_checkout_sessions_task",
        "schedule": 300.0,
        "kwargs": {"limit": 500},
        "options": {"expires": min(BEAT_JOB_EXPIRES_SHORT_SECONDS, 300)},
    },
    "run_payout_eligibility_hourly": {
        "task": "payouts.tasks.run_payout_eligibility_task",
        "schedule": 3600.0,
        "options": {"expires": min(BEAT_JOB_EXPIRES_LONG_SECONDS, 3600)},
    },
    "create_payout_batch_every_fifteen_minutes": {
        "task": "payouts.tasks.create_payout_batch_task",
        "schedule": 900.0,
        "kwargs": {"max_businesses": 100},
        "options": {"expires": min(BEAT_JOB_EXPIRES_MEDIUM_SECONDS, 900)},
    },
    "reprocess_unmatched_settlement_records_every_fifteen_minutes": {
        "task": "payments.tasks.reprocess_unmatched_settlement_records_task",
        "schedule": 900.0,
        "kwargs": {"limit": 100},
        "options": {"expires": min(BEAT_JOB_EXPIRES_MEDIUM_SECONDS, 900)},
    },
    "import_pending_settlement_files_every_fifteen_minutes": {
        "task": "payments.tasks.import_pending_settlement_files_task",
        "schedule": 900.0,
        "kwargs": {"limit": 20},
        "options": {"expires": min(BEAT_JOB_EXPIRES_MEDIUM_SECONDS, 900)},
    },
    "verify_financial_integrity_hourly": {
        "task": "payouts.tasks.verify_financial_integrity_task",
        "schedule": 3600.0,
        "options": {"expires": min(BEAT_JOB_EXPIRES_LONG_SECONDS, 3600)},
    },
    "report_financial_anomalies_hourly": {
        "task": "payments.tasks.report_financial_anomalies_task",
        "schedule": 3600.0,
        "options": {"expires": min(BEAT_JOB_EXPIRES_LONG_SECONDS, 3600)},
    },
}

ROOT_URLCONF = "halkyemekproject.urls"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {
        "context_processors": [
            "django.template.context_processors.debug",
            "django.template.context_processors.request",
            "django.contrib.auth.context_processors.auth",
            "django.contrib.messages.context_processors.messages",
        ]
    },
}]

WSGI_APPLICATION = "halkyemekproject.wsgi.application"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "tr-tr"
TIME_ZONE = env_str("TIME_ZONE", default="Europe/Istanbul")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
MEDIA_ASSET_MAX_BYTES = env_int("MEDIA_ASSET_MAX_BYTES", default=8 * 1024 * 1024)

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = env_bool("USE_X_FORWARDED_HOST", default=True)
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_SECURE = not DEBUG
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_RESOURCE_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

LOG_LEVEL = env_str("LOG_LEVEL", default="DEBUG" if DEBUG else "INFO")
LOG_MASKED_FIELDS = set(env_list(
    "LOG_MASKED_FIELDS",
    default=[
        "authorization",
        "password",
        "token",
        "secret",
        "api_key",
        "refresh",
        "access",
    ],
))


def _sanitize_message(message: str) -> str:
    lowered = message.lower()
    for field in LOG_MASKED_FIELDS:
        if field and field in lowered:
            return "[REDACTED]"
    return message


class JsonFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            "ts": self.formatTime(record, self.datefmt),
            "app": APP_NAME,
            "env": APP_ENV,
            "release": RELEASE_VERSION,
            "host": socket.gethostname(),
            "pid": record.process,
            "level": record.levelname,
            "logger": record.name,
            "msg": _sanitize_message(record.getMessage()),
        }
        request_id = getattr(record, "request_id", "")
        if request_id:
            payload["request_id"] = request_id
        request_path = getattr(record, "request_path", "")
        if request_path:
            payload["path"] = request_path
        request_method = getattr(record, "request_method", "")
        if request_method:
            payload["method"] = request_method
        user_id = getattr(record, "user_id", "")
        if user_id:
            payload["user_id"] = user_id
        status_code = getattr(record, "status_code", None)
        if status_code is not None:
            payload["status_code"] = status_code
        duration_ms = getattr(record, "duration_ms", None)
        if duration_ms is not None:
            payload["duration_ms"] = duration_ms
        query_count = getattr(record, "query_count", None)
        if query_count is not None:
            payload["query_count"] = query_count
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_context": {"()": "logs.logging_filters.RequestIDLogFilter"},
    },
    "formatters": {
        "json": {"()": "halkyemekproject.settings.base.JsonFormatter"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "filters": ["request_context"],
        }
    },
    "loggers": {
        "http.access": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
}

if "test" in sys.argv:
    MIGRATION_MODULES = {
        "accounts": None,
        "businesses": None,
        "menus": None,
        "orders": None,
        "wallets": None,
        "payments": None,
        "payouts": None,
        "notifications": None,
        "idempotency": None,
        "logs": None,
        "health": None,
        "common": None,
    }


if SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.django import DjangoIntegration
        from sentry_sdk.integrations.celery import CeleryIntegration

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=SENTRY_ENVIRONMENT,
            release=RELEASE_VERSION,
            traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
            integrations=[DjangoIntegration(), CeleryIntegration()],
            send_default_pii=False,
        )
    except Exception as exc:  # pragma: no cover
        logging.getLogger(__name__).warning("sentry.init_failed", extra={"error": str(exc)})
