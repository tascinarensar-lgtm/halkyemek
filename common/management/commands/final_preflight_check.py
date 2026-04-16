import os
from pathlib import Path
from io import StringIO
from urllib.parse import urlparse

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db.utils import OperationalError, ProgrammingError

from health.services import JobHeartbeatService
from common.runtime_validation import collect_runtime_validation_failures
from payments.providers.iyzico_marketplace import IyzicoMarketplaceClient


class Command(BaseCommand):
    help = "Run final production preflight checks"

    REQUIRED_OPERATIONAL_FILES = (
        "scripts/backup_postgres.sh",
        "scripts/check_celery_health.sh",
        "scripts/restore_postgres.sh",
        "scripts/smoke_test.sh",
        "scripts/staging_prove_out.sh",
        "scripts/run_celery_worker.sh",
        "scripts/run_celery_beat.sh",
        "scripts/release.sh",
        "scripts/prestart.sh",
        ".env.staging.example",
        ".env.prod.example",
        "RUNBOOK.md",
        "RUN_SCHEDULE.md",
        "ROLLBACK_PLAN.md",
        "OPS_RUNBOOK.md",
        "DEPLOYMENT_CHECKLIST.md",
        "GO_LIVE_CHECKLIST.md",
        "PRODUCTION_OPERATIONS_BASELINE.md",
        "FINAL_RELEASE_HANDOFF.md",
        "businesses/fixtures/marketplace_categories_beylikduzu.json",
        "gunicorn.conf.py",
    )

    SCRIPT_ARTIFACTS = (
        "scripts/backup_postgres.sh",
        "scripts/check_celery_health.sh",
        "scripts/restore_postgres.sh",
        "scripts/smoke_test.sh",
        "scripts/staging_prove_out.sh",
        "scripts/run_celery_worker.sh",
        "scripts/run_celery_beat.sh",
        "scripts/release.sh",
        "scripts/prestart.sh",
        "scripts/release_acceptance.sh",
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--fail-on-lock-skip",
            action="store_true",
            help="Fail when preflight commands are skipped due to an active distributed lock.",
        )

    def _safe_heartbeat_failure(self, message: str) -> None:
        try:
            JobHeartbeatService.failure("final_preflight_check", message)
        except (OperationalError, ProgrammingError):
            pass

    def _safe_heartbeat_success(self) -> None:
        try:
            JobHeartbeatService.success("final_preflight_check")
        except (OperationalError, ProgrammingError):
            pass

    def _validate_runtime_configuration(self) -> None:
        failures = collect_runtime_validation_failures(include_runtime_checks=True)

        minimum_lock_ttls = {
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
        for key, minimum in minimum_lock_ttls.items():
            if int(getattr(settings, key, 0) or 0) < minimum:
                failures.append(f"{key} must be >= {minimum}")

        beat_schedule = getattr(settings, "CELERY_BEAT_SCHEDULE", {})
        required_beat_jobs = [
            "record_scheduler_heartbeat_every_minute",
            "process_notifications_every_minute",
            "cleanup_checkout_sessions_every_five_minutes",
            "run_payout_eligibility_hourly",
            "create_payout_batch_every_fifteen_minutes",
            "dispatch_due_payouts_every_five_minutes",
            "sync_sent_payout_statuses_every_five_minutes",
            "reprocess_unmatched_settlement_records_every_fifteen_minutes",
            "import_pending_settlement_files_every_fifteen_minutes",
            "verify_financial_integrity_hourly",
            "report_financial_anomalies_hourly",
        ]
        missing_beat_jobs = [job for job in required_beat_jobs if job not in beat_schedule]
        if missing_beat_jobs:
            failures.append(f"CELERY_BEAT_SCHEDULE missing required jobs: {', '.join(missing_beat_jobs)}")

        if failures:
            raise CommandError('; '.join(failures))


    def _validate_operational_artifacts(self) -> None:
        base_dir = Path(getattr(settings, "BASE_DIR"))
        missing = [relative_path for relative_path in self.REQUIRED_OPERATIONAL_FILES if not (base_dir / relative_path).exists()]
        if missing:
            raise CommandError(f"missing operational artifacts: {', '.join(missing)}")
        non_executable = []
        for relative_path in self.SCRIPT_ARTIFACTS:
            script_path = base_dir / relative_path
            if not script_path.exists():
                continue
            if os.name != "nt" and not os.access(script_path, os.X_OK):
                non_executable.append(relative_path)
        if non_executable:
            raise CommandError(f"scripts must be executable: {', '.join(non_executable)}")

    def handle(self, *args, **options):
        commands = [
            ("validate_env_examples", [], {}),
            ("check", ["--deploy"], {}),
            (
                "makemigrations",
                [],
                {"check_changes": True, "dry_run": True, "interactive": False},
            ),
            ("migrate", ["--check"], {}),
            ("verify_bootstrap_marketplace", ["--district", getattr(settings, "BOOTSTRAP_MARKETPLACE_DISTRICT", "BEYLIKDUZU")], {}),
            ("verify_financial_integrity", [], {}),
            ("report_financial_anomalies", [], {}),
        ]

        try:
            self._validate_runtime_configuration()
            self._validate_operational_artifacts()
        except Exception as exc:
            self._safe_heartbeat_failure(f"runtime validation failed: {exc}")
            raise

        for cmd, extra_args, extra_kwargs in commands:
            self.stdout.write(f"Running: {cmd} {' '.join(extra_args)}".strip())
            try:
                capture_output = cmd in {"verify_financial_integrity", "report_financial_anomalies"}
                output_buffer = StringIO() if capture_output else None
                call_kwargs = dict(extra_kwargs)
                if output_buffer is not None:
                    call_kwargs["stdout"] = output_buffer
                    call_kwargs["stderr"] = output_buffer
                call_command(cmd, *extra_args, **call_kwargs)
                if output_buffer is not None:
                    command_output = output_buffer.getvalue()
                    self.stdout.write(command_output)
                    if "Skipped:" in command_output:
                        if options["fail_on_lock_skip"]:
                            self._safe_heartbeat_failure(f"{cmd} skipped due to lock")
                            raise CommandError(f"{cmd} was skipped because lock was already held")
                        self.stdout.write(self.style.WARNING(f"{cmd} lock is already held, continuing."))
            except SystemExit as exc:
                self._safe_heartbeat_failure(f"{cmd} failed with SystemExit: {exc}")
                raise CommandError(f"{cmd} failed with SystemExit: {exc}") from exc
            except Exception as exc:
                self._safe_heartbeat_failure(f"{cmd} failed: {exc}")
                raise CommandError(f"{cmd} failed: {exc}") from exc

        self._safe_heartbeat_success()
        self.stdout.write(self.style.SUCCESS("Final preflight checks passed."))
