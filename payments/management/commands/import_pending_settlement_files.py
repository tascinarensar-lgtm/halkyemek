from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from common.locks import build_job_lock_token, job_lock
from health.services import JobHeartbeatService


DUPLICATE_MARKER = "Duplicate settlement file already registered"


def _resolve_directory(value: str | None) -> Path | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    return Path(raw).expanduser().resolve()


def _target_path(*, target_dir: Path, source_name: str) -> Path:
    timestamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    candidate = target_dir / f"{Path(source_name).stem}.{timestamp}{Path(source_name).suffix}"
    serial = 1
    while candidate.exists():
        candidate = target_dir / f"{Path(source_name).stem}.{timestamp}.{serial}{Path(source_name).suffix}"
        serial += 1
    return candidate


def _is_duplicate_error(exc: Exception) -> bool:
    return DUPLICATE_MARKER in str(exc)


class Command(BaseCommand):
    help = "Import settlement CSV files from inbox directory and archive processed files."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=20)
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=900)
        parser.add_argument("--inbox-dir", type=str, default="")
        parser.add_argument("--archive-dir", type=str, default="")
        parser.add_argument("--failed-dir", type=str, default="")

    def handle(self, *args, **options):
        worker = str(options.get("worker", "") or "").strip() or "scheduler"
        limit = max(int(options.get("limit") or 0), 1)

        inbox_dir = _resolve_directory(options.get("inbox_dir")) or _resolve_directory(
            getattr(settings, "SETTLEMENT_IMPORT_INBOX_DIR", "")
        )
        archive_dir = _resolve_directory(options.get("archive_dir")) or _resolve_directory(
            getattr(settings, "SETTLEMENT_IMPORT_ARCHIVE_DIR", "")
        )
        failed_dir = _resolve_directory(options.get("failed_dir")) or _resolve_directory(
            getattr(settings, "SETTLEMENT_IMPORT_FAILED_DIR", "")
        )

        lock_token = build_job_lock_token(worker=worker)
        with job_lock(name="import_pending_settlement_files", token=lock_token, ttl_seconds=options["lock_ttl"]) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING("Skipped: import_pending_settlement_files lock is already held."))
                return

            if inbox_dir is None:
                JobHeartbeatService.success(
                    "import_pending_settlement_files",
                    worker=worker,
                    imported=0,
                    duplicates=0,
                    failed=0,
                    skipped=0,
                    reason="SETTLEMENT_IMPORT_INBOX_DIR not configured",
                )
                self.stdout.write(self.style.WARNING("SETTLEMENT_IMPORT_INBOX_DIR is not configured; nothing imported."))
                return

            inbox_dir.mkdir(parents=True, exist_ok=True)
            if archive_dir is not None:
                archive_dir.mkdir(parents=True, exist_ok=True)
            if failed_dir is not None:
                failed_dir.mkdir(parents=True, exist_ok=True)

            files = [path for path in sorted(inbox_dir.glob("*.csv")) if path.is_file()]
            if not files:
                JobHeartbeatService.success(
                    "import_pending_settlement_files",
                    worker=worker,
                    imported=0,
                    duplicates=0,
                    failed=0,
                    skipped=0,
                    inbox=str(inbox_dir),
                )
                self.stdout.write(self.style.SUCCESS("No settlement files pending in inbox."))
                return

            imported = 0
            duplicates = 0
            failed = 0
            skipped = 0
            failures: list[str] = []
            duplicate_files: list[str] = []

            for csv_path in files:
                if imported + duplicates + failed >= limit:
                    skipped += 1
                    continue

                try:
                    call_command(
                        "import_iyzico_settlement",
                        str(csv_path),
                        worker=worker,
                        lock_ttl=max(int(options["lock_ttl"]), 60),
                    )
                    imported += 1
                    if archive_dir is not None:
                        destination = _target_path(target_dir=archive_dir, source_name=csv_path.name)
                        shutil.move(str(csv_path), str(destination))
                    else:
                        csv_path.unlink(missing_ok=True)
                except Exception as exc:
                    if _is_duplicate_error(exc):
                        duplicates += 1
                        duplicate_files.append(csv_path.name)
                        if archive_dir is not None:
                            destination = _target_path(target_dir=archive_dir, source_name=csv_path.name)
                            shutil.move(str(csv_path), str(destination))
                        else:
                            csv_path.unlink(missing_ok=True)
                        self.stdout.write(self.style.WARNING(f"Duplicate archived: {csv_path.name}"))
                        continue

                    failed += 1
                    failures.append(f"{csv_path.name}: {exc}")
                    if failed_dir is not None:
                        destination = _target_path(target_dir=failed_dir, source_name=csv_path.name)
                        shutil.move(str(csv_path), str(destination))

            heartbeat_meta = {
                "worker": worker,
                "imported": imported,
                "duplicates": duplicates,
                "failed": failed,
                "skipped": skipped,
                "duplicate_files": duplicate_files[:20],
                "failures": failures[:20],
                "inbox": str(inbox_dir),
                "archive": str(archive_dir) if archive_dir is not None else "",
                "failed_dir": str(failed_dir) if failed_dir is not None else "",
            }

            if failed > 0:
                JobHeartbeatService.failure("import_pending_settlement_files", f"failed={failed}", **heartbeat_meta)
                for item in failures:
                    self.stdout.write(self.style.ERROR(item))
                raise SystemExit(1)

            JobHeartbeatService.success("import_pending_settlement_files", **heartbeat_meta)
            self.stdout.write(
                self.style.SUCCESS(
                    f"done: imported={imported} duplicates={duplicates} failed={failed} skipped={skipped}"
                )
            )
