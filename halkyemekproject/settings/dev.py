from .base import *

DEBUG = True
ALLOWED_HOSTS = ["*"]
LOG_LEVEL = "DEBUG"
PAYMENT_WEBHOOK_SECRET = os.environ.get("PAYMENT_WEBHOOK_SECRET", "dev-webhook-secret")

if not IYZICO_API_KEY:
    IYZICO_API_KEY = "sandbox-dev-api-key"

if not IYZICO_SECRET_KEY:
    IYZICO_SECRET_KEY = "dev-iyzico-secret-key-32bytes-min!!!!"
