from __future__ import annotations

import hashlib
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from common.locks import build_job_lock_token, job_lock
from health.services import JobHeartbeatService
from payments.models import SettlementImport, SettlementLine, SettlementRecord
from payments.services_ingestion import (
    DuplicateSettlementImportError,
    execute_settlement_import,
    parse_amount_to_minor_units,
    parse_optional_date,
    register_settlement_import,
    stable_row_fingerprint,
)
from payments.services_settlement import process_settlement_record, record_settlement_row


class Command(BaseCommand):
    help = "Import iyzico settlement/cut-off CSV and reconcile rows against real local entities."

    def add_arguments(self, parser):
        parser.add_argument("csv_path", type=str, help="Path to settlement CSV file")
        parser.add_argument("--dry-run", action="store_true", help="Do not write settlement records, only validate rows")
        parser.add_argument("--worker", type=str, default="scheduler")
        parser.add_argument("--lock-ttl", type=int, default=1800)

    def handle(self, *args, **options):
        csv_path = Path(options["csv_path"])
        if not csv_path.exists():
            raise CommandError(f"File not found: {csv_path}")

        worker = str(options.get("worker", "") or "").strip() or "scheduler"
        lock_seed = hashlib.sha256(str(csv_path.resolve()).encode("utf-8")).hexdigest()[:24]
        lock_name = f"import_iyzico_settlement:{lock_seed}"
        lock_token = build_job_lock_token(worker=worker)
        dry_run = bool(options["dry_run"])
        with job_lock(name=lock_name, token=lock_token, ttl_seconds=options["lock_ttl"]) as lock:
            if not lock.acquired:
                self.stdout.write(self.style.WARNING(f"Skipped: {lock_name} lock is already held."))
                return
            try:
                if dry_run:
                    self._handle_dry_run(csv_path)
                    JobHeartbeatService.success("import_iyzico_settlement", worker=worker, file=str(csv_path), dry_run=True)
                    self.stdout.write(self.style.SUCCESS("dry-run complete"))
                    return

                import_record = register_settlement_import(
                    provider=SettlementImport.Provider.IYZICO,
                    file_path=csv_path,
                    source_type=SettlementImport.SourceType.INBOX if "inbox" in str(csv_path).lower() else SettlementImport.SourceType.COMMAND,
                    source_label=str(csv_path),
                    source_metadata={"worker": worker},
                    imported_by=None,
                    imported_by_label=worker,
                )
                summary = execute_settlement_import(import_record)
            except DuplicateSettlementImportError as exc:
                existing = exc.existing_import
                JobHeartbeatService.failure(
                    "import_iyzico_settlement",
                    str(exc),
                    worker=worker,
                    file=str(csv_path),
                    duplicate_import_id=existing.pk,
                )
                raise CommandError(str(exc))
            except Exception as exc:
                JobHeartbeatService.failure(
                    "import_iyzico_settlement",
                    str(exc),
                    worker=worker,
                    file=str(csv_path),
                    dry_run=dry_run,
                )
                raise

            JobHeartbeatService.success(
                "import_iyzico_settlement",
                worker=worker,
                file=str(csv_path),
                dry_run=False,
                created=summary.created,
                duplicates=summary.duplicates,
                processed=summary.processed,
                errors=summary.errors,
                skipped=summary.skipped,
                total_rows=summary.total_rows,
                unmatched=summary.unmatched,
                import_id=import_record.id,
            )
            self.stdout.write(self.style.SUCCESS(
                f"done: import_id={import_record.id}, created={summary.created}, duplicate={summary.duplicates}, processed={summary.processed}, errors={summary.errors}, skipped={summary.skipped}, unmatched={summary.unmatched}"
            ))

    def _handle_dry_run(self, csv_path: Path) -> None:
        import csv

        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames:
                raise CommandError("CSV has no header")
            for row_number, row in enumerate(reader, start=2):
                status_value = str(row.get("status") or row.get("paymentStatus") or "").strip().upper()
                if status_value and status_value not in {"SUCCESS", "SUCCEEDED", "SETTLED"}:
                    continue
                amount_str = row.get("paidPrice") or row.get("price") or row.get("amount") or row.get("paid_price")
                if amount_str is None:
                    continue
                try:
                    amount = parse_amount_to_minor_units(amount_str)
                except Exception as exc:
                    raise CommandError(f"Invalid amount at row {row_number}: {amount_str}") from exc
                settlement_date = row.get("settlementDate") or row.get("settlement_date") or row.get("settlementDateTime") or row.get("settlement_date_time")
                fingerprint = stable_row_fingerprint(row, amount=amount, currency=row.get("currency") or "TRY", settlement_date=settlement_date)
                self.stdout.write(f"[DRY] row={row_number} amount={amount} fingerprint={fingerprint[:16]}")
