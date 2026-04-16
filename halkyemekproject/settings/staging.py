from common.runtime_validation import assert_runtime_configuration_ready
from .prod import *

APP_ENV = "staging"
SENTRY_ENVIRONMENT = "staging"
SECURE_HSTS_SECONDS = 3600
SECURE_HSTS_INCLUDE_SUBDOMAINS = False
SECURE_HSTS_PRELOAD = False

assert_runtime_configuration_ready()
