
from common.runtime_validation import assert_runtime_configuration_ready
from common.security import assert_production_security_ready

from .base import *

assert_production_security_ready()
assert_runtime_configuration_ready()

DEBUG = False
if not ALLOWED_HOSTS:
    raise RuntimeError("ALLOWED_HOSTS bos olamaz (prod).")

SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

DATABASES = {
    "default": env.db("DATABASE_URL")
}
DATABASES["default"].setdefault("CONN_MAX_AGE", env.int("DB_CONN_MAX_AGE", default=120))
DATABASES["default"].setdefault("CONN_HEALTH_CHECKS", True)

STATIC_ROOT = Path(env.str("STATIC_ROOT", default=str(BASE_DIR / "staticfiles")))

if not PAYMENT_WEBHOOK_SECRET:
    raise RuntimeError("PAYMENT_WEBHOOK_SECRET bos olamaz (prod).")
