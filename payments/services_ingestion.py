from __future__ import annotations

import csv
import hashlib
import os
import shutil
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from common.locks import build_job_lock_token, job_lock
from logs.models import SystemLog
from payments.models import SettlementImport, SettlementLine, SettlementRecord
from payments.services_settlement import process_settlement_record, record_settlement_row


class SettlementImportError(Exception):
    pass


class DuplicateSettlementImportError(SettlementImportError):
    def __init__(self, existing_import: SettlementImport):
        self.existing_import = existing_import
        super().__init__(f"Duplicate settlement file already registered as import_id={existing_import.pk}")


@dataclass
class SettlementImportExecutionSummary:
    created: int = 0
    duplicates: int = 0
    processed: int = 0
    errors: int = 0
    skipped: int = 0
    total_rows: int = 0
    unmatched: int = 0


def settlement_upload_dir() -> Path:
    raw = str(getattr(settings, "SETTLEMENT_IMPORT_UPLOAD_DIR", "") or "").strip()
    if raw:
        return Path(raw)
    return Path(settings.BASE_DIR) / "var" / "settlement_uploads"


def settlement_upload_max_bytes() -> int:
    value = int(getattr(settings, "SETTLEMENT_IMPORT_UPLOAD_MAX_BYTES", 5 * 1024 * 1024) or 0)
    return max(value, 1)


def sanitize_uploaded_filename(name: str | None) -> str:
    raw = os.path.basename(str(name or "").strip())
    if not raw:
        return "settlement.csv"
    return raw[:255]


def compute_file_sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _timestamp() -> str:
    return timezone.now().isoformat()


def _get(row: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return None


def _hash_line(provider_ref: str, submerchant_key: str, amount: int, settlement_date: str | None) -> str:
    raw = f"{provider_ref}|{submerchant_key}|{amount}|{settlement_date or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def stable_row_fingerprint(row: dict[str, Any], *, amount: int, currency: str, settlement_date: str | None) -> str:
    normalized_pairs = [f"{str(key).strip()}={str(row.get(key) or '').strip()}" for key in sorted(row.keys())]
    payload = "|".join(normalized_pairs)
    raw = f"{payload}|amount={int(amount)}|currency={str(currency or 'TRY').strip().upper()}|settlement_date={str(settlement_date or '').strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def parse_optional_date(value: str | None):
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d.%m.%Y", "%d.%m.%Y %H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def parse_amount_to_minor_units(raw_amount: str) -> int:
    normalized = str(raw_amount or "").strip()
    if not normalized:
        raise ValueError("empty amount")
    compact = normalized.replace(" ", "")
    if "," in compact and "." in compact:
        if compact.rfind(",") > compact.rfind("."):
            compact = compact.replace(".", "").replace(",", ".")
        else:
            compact = compact.replace(",", "")
    elif "," in compact:
        compact = compact.replace(",", ".")
    decimal_amount = Decimal(compact)
    if decimal_amount == decimal_amount.to_integral_value():
        return int(decimal_amount)
    return int((decimal_amount * 100).quantize(Decimal("1")))


def _append_lifecycle_event(instance, *, event: str, message: str = "", meta: dict | None = None, save: bool = True) -> None:
    events = list(getattr(instance, "lifecycle_events", []) or [])
    events.append({
        "ts": _timestamp(),
        "event": str(event or "").strip(),
        "message": str(message or "").strip(),
        "meta": meta or {},
    })
    instance.lifecycle_events = events[-100:]
    if save:
        instance.save(update_fields=["lifecycle_events"])




def summarize_import_record(import_record: SettlementImport) -> dict[str, Any]:
    return {
        "import_id": int(import_record.pk),
        "provider": import_record.provider,
        "parse_status": import_record.parse_status,
        "applied_status": import_record.applied_status,
        "total_rows": int(import_record.total_rows or 0),
        "created_records": int(import_record.created_records or 0),
        "duplicate_records": int(import_record.duplicate_records or 0),
        "processed_records": int(import_record.processed_records or 0),
        "failed_records": int(import_record.failed_records or 0),
        "skipped_rows": int(import_record.skipped_rows or 0),
        "unmatched_records": int(import_record.unmatched_records or 0),
        "retry_count": int(import_record.retry_count or 0),
        "checksum_sha256": import_record.checksum_sha256,
        "source_type": import_record.source_type,
        "source_label": import_record.source_label,
    }


def summarize_import_execution(summary: SettlementImportExecutionSummary) -> dict[str, int]:
    return {
        "created": int(summary.created or 0),
        "duplicates": int(summary.duplicates or 0),
        "processed": int(summary.processed or 0),
        "errors": int(summary.errors or 0),
        "skipped": int(summary.skipped or 0),
        "total_rows": int(summary.total_rows or 0),
        "unmatched": int(summary.unmatched or 0),
    }

def _write_settlement_system_log(*, actor=None, description: str, meta: dict | None = None):
    SystemLog.objects.create(
        user=actor,
        action=SystemLog.ActionType.OTHER,
        description=description,
        meta=meta or {},
    )


def register_duplicate_attempt(*, existing_import: SettlementImport, source_type: str, source_label: str = "", source_metadata: dict | None = None, imported_by=None, imported_by_label: str = "") -> None:
    payload = {
        "source_type": source_type,
        "source_label": source_label,
        "source_metadata": source_metadata or {},
        "imported_by_id": getattr(imported_by, "id", None),
        "imported_by_label": imported_by_label,
    }
    _append_lifecycle_event(existing_import, event="duplicate_rejected", message="Duplicate settlement import blocked by checksum registry.", meta=payload)
    _write_settlement_system_log(
        actor=imported_by,
        description="Settlement import duplicate rejected",
        meta={
            "settlement_import_id": existing_import.pk,
            "checksum_sha256": existing_import.checksum_sha256,
            **payload,
        },
    )


def register_settlement_import(*, provider: str, file_path: str | Path, source_type: str, source_label: str = "", source_metadata: dict | None = None, imported_by=None, imported_by_label: str = "") -> SettlementImport:
    file_path = Path(file_path)
    if not file_path.exists() or not file_path.is_file():
        raise SettlementImportError(f"Settlement file does not exist or is not a file: {file_path}")
    checksum = compute_file_sha256(file_path)
    provider_value = str(provider or SettlementImport.Provider.IYZICO).upper()
    try:
        with transaction.atomic():
            created = SettlementImport.objects.create(
                provider=provider_value,
                source_type=source_type,
                source_label=sanitize_uploaded_filename(source_label) or str(file_path),
                source_metadata=source_metadata or {},
                original_filename=sanitize_uploaded_filename(file_path.name),
                storage_path=str(file_path),
                checksum_sha256=checksum,
                file_size_bytes=file_path.stat().st_size if file_path.exists() else 0,
                imported_by=imported_by,
                imported_by_label=imported_by_label,
            )
    except IntegrityError as exc:
        existing = SettlementImport.objects.get(provider=provider_value, checksum_sha256=checksum)
        register_duplicate_attempt(
            existing_import=existing,
            source_type=source_type,
            source_label=source_label or str(file_path),
            source_metadata=source_metadata,
            imported_by=imported_by,
            imported_by_label=imported_by_label,
        )
        raise DuplicateSettlementImportError(existing) from exc

    _append_lifecycle_event(
        created,
        event="registered",
        message="Settlement import registered in checksum registry.",
        meta={
            "storage_path": str(file_path),
            "source_type": source_type,
            "source_label": source_label or str(file_path),
            "source_metadata": source_metadata or {},
            "checksum_sha256": checksum,
            "file_size_bytes": created.file_size_bytes,
            "imported_by_id": getattr(imported_by, "id", None),
            "imported_by_label": imported_by_label,
        },
    )
    _write_settlement_system_log(
        actor=imported_by,
        description="Settlement import registered",
        meta={
            "settlement_import_id": created.pk,
            "checksum_sha256": checksum,
            "provider": provider_value,
            "source_type": source_type,
            "source_label": source_label or str(file_path),
        },
    )
    return created


def stage_uploaded_settlement_file(*, uploaded_file, provider: str, imported_by=None, imported_by_label: str = "", source_metadata: dict | None = None) -> SettlementImport:
    upload_dir = settlement_upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    original_name = sanitize_uploaded_filename(getattr(uploaded_file, "name", "settlement.csv"))
    content_type = str(getattr(uploaded_file, "content_type", "") or "").strip().lower()
    allowed_types = {"", "text/csv", "application/csv", "application/vnd.ms-excel"}
    if content_type not in allowed_types:
        raise SettlementImportError(f"Unsupported upload content type: {content_type}")
    file_size = int(getattr(uploaded_file, "size", 0) or 0)
    max_bytes = settlement_upload_max_bytes()
    if file_size and file_size > max_bytes:
        raise SettlementImportError(f"Settlement upload too large: size={file_size} max={max_bytes}")
    temp_path = upload_dir / f"upload-{timezone.now().strftime('%Y%m%d%H%M%S%f')}-{original_name}"
    bytes_written = 0
    with temp_path.open("wb") as target:
        for chunk in uploaded_file.chunks():
            bytes_written += len(chunk)
            if bytes_written > max_bytes:
                target.close()
                temp_path.unlink(missing_ok=True)
                raise SettlementImportError(f"Settlement upload too large: size>{max_bytes}")
            target.write(chunk)
    checksum = compute_file_sha256(temp_path)
    final_path = upload_dir / f"{checksum}.csv"
    if not final_path.exists():
        shutil.move(str(temp_path), str(final_path))
    else:
        temp_path.unlink(missing_ok=True)
    return register_settlement_import(
        provider=provider,
        file_path=final_path,
        source_type=SettlementImport.SourceType.API_UPLOAD,
        source_label=original_name,
        source_metadata={**(source_metadata or {}), "uploaded_filename": original_name, "content_type": content_type or None},
        imported_by=imported_by,
        imported_by_label=imported_by_label,
    )


def _verify_checksum(import_record: SettlementImport, path: Path) -> str:
    actual_checksum = compute_file_sha256(path)
    expected_checksum = str(import_record.checksum_sha256 or "").strip().lower()
    if actual_checksum != expected_checksum:
        _append_lifecycle_event(
            import_record,
            event="checksum_mismatch",
            message="Settlement import checksum verification failed.",
            meta={"expected": expected_checksum, "actual": actual_checksum},
        )
        raise SettlementImportError(
            f"Checksum mismatch for import_id={import_record.pk}: expected={expected_checksum} actual={actual_checksum}"
        )
    verified_at = timezone.now()
    SettlementImport.objects.filter(pk=import_record.pk).update(checksum_verified_at=verified_at)
    import_record.checksum_verified_at = verified_at
    _append_lifecycle_event(
        import_record,
        event="checksum_verified",
        message="Settlement import checksum verified successfully.",
        meta={"checksum_sha256": actual_checksum},
    )
    return actual_checksum


def _mark_import_failed(import_id: int, *, error_message: str, retry_count: int) -> None:
    SettlementImport.objects.filter(pk=import_id).update(
        parse_status=SettlementImport.ParseStatus.FAILED,
        applied_status=SettlementImport.AppliedStatus.FAILED,
        error_message=error_message,
        completed_at=timezone.now(),
        retry_count=retry_count,
    )
    failed_import = SettlementImport.objects.get(pk=import_id)
    _append_lifecycle_event(failed_import, event="failed", message=error_message, meta={"retry_count": retry_count, "state": summarize_import_record(failed_import)})
    _write_settlement_system_log(
        actor=failed_import.imported_by,
        description="Settlement import failed",
        meta={
            "settlement_import_id": failed_import.pk,
            "checksum_sha256": failed_import.checksum_sha256,
            "error": error_message,
            "retry_count": retry_count,
        },
    )


def _append_record_event(record: SettlementRecord, *, event: str, message: str = "", meta: dict | None = None) -> None:
    events = list(record.lifecycle_events or [])
    events.append({
        "ts": _timestamp(),
        "event": str(event or "").strip(),
        "message": str(message or "").strip(),
        "meta": meta or {},
    })
    record.lifecycle_events = events[-100:]


def execute_settlement_import(import_record: SettlementImport) -> SettlementImportExecutionSummary:
    path = Path(import_record.storage_path)
    if not path.exists():
        raise SettlementImportError(f"File not found for import_id={import_record.pk}: {path}")

    summary = SettlementImportExecutionSummary()
    lock_name = f"settlement-import:{int(import_record.pk)}"
    lock_token = build_job_lock_token(worker=f"import-{int(import_record.pk)}")
    with job_lock(name=lock_name, token=lock_token, ttl_seconds=1800) as lock:
        if not lock.acquired:
            raise SettlementImportError(f"Settlement import {import_record.pk} is already running.")
        try:
            locked_import = SettlementImport.objects.select_for_update().get(pk=import_record.pk)
            if locked_import.applied_status == SettlementImport.AppliedStatus.APPLIED:
                raise SettlementImportError(f"Settlement import {locked_import.pk} already applied.")

            _verify_checksum(locked_import, path)
            locked_import.started_at = timezone.now()
            locked_import.parse_status = SettlementImport.ParseStatus.PARSING
            locked_import.applied_status = SettlementImport.AppliedStatus.APPLYING
            locked_import.error_message = ""
            locked_import.save(update_fields=["started_at", "parse_status", "applied_status", "error_message"])
            _append_lifecycle_event(locked_import, event="started", message="Settlement import execution started.", meta={"state": summarize_import_record(locked_import)})

            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                if not reader.fieldnames:
                    raise SettlementImportError("CSV has no header")
                normalized_headers = {str(item or "").strip() for item in reader.fieldnames}
                if len(normalized_headers) < 2:
                    raise SettlementImportError("CSV header is too narrow for settlement import")
                for row_number, row in enumerate(reader, start=2):
                    summary.total_rows += 1
                    status = (_get(row, "status", "paymentStatus") or "").upper()
                    if status and status not in {"SUCCESS", "SUCCEEDED", "SETTLED"}:
                        summary.skipped += 1
                        continue
                    amount_str = _get(row, "paidPrice", "price", "amount", "paid_price")
                    if amount_str is None:
                        summary.skipped += 1
                        continue
                    try:
                        amount = parse_amount_to_minor_units(amount_str)
                    except (ValueError, InvalidOperation) as exc:
                        raise SettlementImportError(f"Invalid amount at row {row_number}: {amount_str}") from exc
                    settlement_ref = _get(row, "settlementReferenceCode")
                    payment_id = _get(row, "paymentId")
                    conversation_id = _get(row, "paymentConversationId", "conversationId")
                    provider_ref = _get(row, "merchantReference")
                    submerchant_key = _get(row, "subMerchantKey")
                    settlement_date_str = _get(row, "settlementDate", "settlement_date", "settlementDateTime", "settlement_date_time")
                    provider_ref_for_line = provider_ref or payment_id or conversation_id or settlement_ref
                    if provider_ref_for_line:
                        SettlementLine.objects.get_or_create(
                            provider="IYZICO",
                            line_hash=_hash_line(provider_ref_for_line, submerchant_key or "", amount, settlement_date_str),
                            defaults={
                                "provider_reference": provider_ref_for_line,
                                "submerchant_key": submerchant_key or "",
                                "amount": amount,
                                "settlement_date": parse_optional_date(settlement_date_str),
                            },
                        )
                    row_fingerprint = stable_row_fingerprint(
                        row,
                        amount=amount,
                        currency=_get(row, "currency") or "TRY",
                        settlement_date=settlement_date_str,
                    )
                    derived_external_id = f"derived-{row_fingerprint[:32]}"
                    record, created = record_settlement_row(
                        provider="IYZICO",
                        settlement_import=locked_import,
                        row_number=row_number,
                        row_fingerprint=row_fingerprint,
                        external_settlement_id=settlement_ref or derived_external_id,
                        external_transaction_id=payment_id or provider_ref or conversation_id or "",
                        amount=amount,
                        currency=_get(row, "currency") or "TRY",
                        raw_payload=row,
                    )
                    _append_record_event(
                        record,
                        event="import_seen" if created else "duplicate_row_seen",
                        message="Settlement row registered during import.",
                        meta={
                            "import_id": locked_import.pk,
                            "row_number": row_number,
                            "row_fingerprint": row_fingerprint,
                        },
                    )
                    if created:
                        summary.created += 1
                    else:
                        summary.duplicates += 1
                    try:
                        if process_settlement_record(record):
                            summary.processed += 1
                    except Exception as exc:
                        summary.errors += 1
                        _append_record_event(record, event="process_error", message=str(exc), meta={"import_id": locked_import.pk})
                    record.refresh_from_db(fields=["is_processed", "review_status", "processing_error", "lifecycle_events", "unmatched_opened_at", "unmatched_resolved_at"])
                    if record.is_processed:
                        _append_record_event(record, event="processed", message="Settlement row processed successfully.", meta={"import_id": locked_import.pk})
                        if record.unmatched_resolved_at is None:
                            record.unmatched_resolved_at = timezone.now()
                    else:
                        summary.unmatched += 1
                        if record.unmatched_opened_at is None:
                            record.unmatched_opened_at = timezone.now()
                        _append_record_event(record, event="unmatched", message=record.processing_error or "Settlement row left unmatched.", meta={"import_id": locked_import.pk})
                    record.save(update_fields=["lifecycle_events", "unmatched_opened_at", "unmatched_resolved_at", "updated_at"])

            locked_import.refresh_from_db()
            locked_import.parse_status = SettlementImport.ParseStatus.PARSED
            locked_import.applied_status = SettlementImport.AppliedStatus.APPLIED
            locked_import.total_rows = summary.total_rows
            locked_import.created_records = summary.created
            locked_import.duplicate_records = summary.duplicates
            locked_import.processed_records = summary.processed
            locked_import.failed_records = summary.errors
            locked_import.skipped_rows = summary.skipped
            locked_import.unmatched_records = summary.unmatched
            locked_import.completed_at = timezone.now()
            locked_import.retry_count = 0
            locked_import.error_message = ""
            locked_import.save(update_fields=[
                "parse_status", "applied_status", "total_rows", "created_records", "duplicate_records", "processed_records",
                "failed_records", "skipped_rows", "unmatched_records", "completed_at", "retry_count", "error_message",
            ])
            _append_lifecycle_event(
                locked_import,
                event="completed",
                message="Settlement import completed.",
                meta={"summary": summarize_import_execution(summary), "state": summarize_import_record(locked_import)},
            )
            _write_settlement_system_log(
                actor=locked_import.imported_by,
                description="Settlement import completed",
                meta={"settlement_import_id": locked_import.pk, **summarize_import_execution(summary)},
            )
        except Exception as exc:
            current_retry = int(getattr(import_record, "retry_count", 0) or 0) + 1
            _mark_import_failed(import_record.pk, error_message=str(exc), retry_count=current_retry)
            raise
    return summary


def retry_settlement_import(import_record: SettlementImport) -> SettlementImportExecutionSummary:
    current_state = SettlementImport.objects.get(pk=import_record.pk)
    if current_state.applied_status == SettlementImport.AppliedStatus.APPLYING or current_state.parse_status == SettlementImport.ParseStatus.PARSING:
        raise SettlementImportError(f"Settlement import {current_state.pk} is currently running and cannot be retried.")
    SettlementImport.objects.filter(pk=import_record.pk).update(
        parse_status=SettlementImport.ParseStatus.NOT_STARTED,
        applied_status=SettlementImport.AppliedStatus.NOT_APPLIED,
        error_message="",
    )
    import_record.refresh_from_db()
    _append_lifecycle_event(import_record, event="retry_requested", message="Settlement import retry requested.", meta={"state": summarize_import_record(import_record)})
    return execute_settlement_import(import_record)
