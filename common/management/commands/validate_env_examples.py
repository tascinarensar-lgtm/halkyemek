from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Validate .env example contracts for release readiness"

    ENV_FILES = (
        ".env.example",
        ".env.staging.example",
        ".env.prod.example",
    )

    REQUIRED_KEYS = (
        "APP_NAME",
        "APP_ENV",
        "RELEASE_VERSION",
        "DEBUG",
        "DJANGO_SECRET_KEY",
        "ALLOWED_HOSTS",
        "CSRF_TRUSTED_ORIGINS",
        "CORS_ALLOWED_ORIGINS",
        "CANONICAL_API_BASE_URL",
        "DATABASE_URL",
        "REDIS_CACHE_URL",
        "GOOGLE_OAUTH_CLIENT_ID",
        "FCM_PROJECT_ID",
        "FCM_CLIENT_EMAIL",
        "FCM_PRIVATE_KEY",
        "IYZICO_API_KEY",
        "IYZICO_SECRET_KEY",
        "IYZICO_BASE_URL",
        "IYZICO_ENV",
        "PAYMENT_WEBHOOK_SECRET",
        "METRICS_TOKEN",
        "TRUST_X_FORWARDED_FOR",
        "TRUSTED_PROXY_IPS",
        "CELERY_BROKER_URL",
        "CELERY_RESULT_BACKEND",
        "RUN_DB_MIGRATIONS",
        "RUN_COLLECTSTATIC",
        "RUN_FINAL_PREFLIGHT",
        "RUN_VALIDATE_ENV_EXAMPLES",
        "FINAL_PREFLIGHT_FAIL_ON_LOCK_SKIP",
        "RUN_BOOTSTRAP_MARKETPLACE",
        "RUN_VERIFY_BOOTSTRAP_MARKETPLACE",
        "BOOTSTRAP_MARKETPLACE_DISTRICT",
        "GUNICORN_FORWARDED_ALLOW_IPS",
        "STRICT_READINESS_RETRIES",
        "STRICT_READINESS_INTERVAL_SECONDS",
    )

    def handle(self, *args, **options):
        base_dir = Path(settings.BASE_DIR)
        file_to_keys: dict[str, dict[str, str]] = {}

        for relative_path in self.ENV_FILES:
            file_path = base_dir / relative_path
            if not file_path.exists():
                raise CommandError(f"missing env example: {relative_path}")
            file_to_keys[relative_path] = self._parse_env_file(relative_path, file_path)

        reference_key_set = set(file_to_keys[self.ENV_FILES[0]].keys())
        for relative_path, keys in file_to_keys.items():
            missing = [key for key in self.REQUIRED_KEYS if key not in keys]
            if missing:
                raise CommandError(f"{relative_path} missing required keys: {', '.join(missing)}")
            if set(keys.keys()) != reference_key_set:
                missing_vs_reference = sorted(reference_key_set.difference(keys.keys()))
                extra_vs_reference = sorted(set(keys.keys()).difference(reference_key_set))
                problems: list[str] = []
                if missing_vs_reference:
                    problems.append(f"missing keys vs .env.example: {', '.join(missing_vs_reference)}")
                if extra_vs_reference:
                    problems.append(f"extra keys vs .env.example: {', '.join(extra_vs_reference)}")
                raise CommandError(f"{relative_path} key contract mismatch: {'; '.join(problems)}")

        self.stdout.write(self.style.SUCCESS("Env example contracts validated."))

    def _parse_env_file(self, relative_path: str, file_path: Path) -> dict[str, str]:
        parsed: dict[str, str] = {}
        for line_number, raw_line in enumerate(file_path.read_text(encoding="utf-8").splitlines(), start=1):
            stripped = raw_line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if "=" not in raw_line:
                raise CommandError(f"{relative_path}:{line_number} must use KEY=value format")
            key, value = raw_line.split("=", 1)
            key = key.strip()
            if not key:
                raise CommandError(f"{relative_path}:{line_number} has an empty env key")
            if key in parsed:
                raise CommandError(f"{relative_path}:{line_number} duplicates env key: {key}")
            parsed[key] = value
        return parsed
