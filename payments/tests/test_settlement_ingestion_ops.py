import os
import tempfile
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils import timezone
from django.urls import reverse
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from accounts.models import User
from payments.models import SettlementImport, SettlementRecord
from test_support import create_user


class SettlementIngestionOpsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_user(username="settlement-admin", role=User.Role.ADMIN, is_staff=True)
        self.customer = create_user(username="settlement-customer")

    def _csv_bytes(self, rows: list[dict]) -> bytes:
        headers = ["status", "amount", "currency", "merchantReference", "paymentId", "settlementReferenceCode"]
        lines = [",".join(headers)]
        for row in rows:
            lines.append(",".join(str(row.get(header, "")) for header in headers))
        return ("\n".join(lines) + "\n").encode("utf-8")

    def test_command_rejects_duplicate_file_by_checksum_registry(self):
        payload = self._csv_bytes([
            {"status": "SUCCESS", "amount": "10.00", "currency": "TRY", "merchantReference": "REF-CHECK-1", "settlementReferenceCode": "SET-CHECK-1"}
        ])
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as handle:
            handle.write(payload)
            path = handle.name
        try:
            call_command("import_iyzico_settlement", path)
            with self.assertRaises(CommandError):
                call_command("import_iyzico_settlement", path)
        finally:
            os.unlink(path)
        self.assertEqual(SettlementImport.objects.count(), 1)

    @override_settings(SETTLEMENT_IMPORT_UPLOAD_DIR="/tmp/hy_settlement_uploads_test")
    def test_ops_upload_endpoint_creates_registry_and_import_detail(self):
        self.client.force_authenticate(self.admin)
        upload = SimpleUploadedFile(
            "settlement.csv",
            self._csv_bytes([
                {"status": "SUCCESS", "amount": "12.50", "currency": "TRY", "merchantReference": "REF-UP-1", "settlementReferenceCode": "SET-UP-1"}
            ]),
            content_type="text/csv",
        )

        response = self.client.post(reverse("payments:ops-settlement-import-upload"), {"file": upload}, format="multipart")

        self.assertEqual(response.status_code, 201)
        import_id = response.json()["data"]["import"]["id"]
        settlement_import = SettlementImport.objects.get(pk=import_id)
        self.assertEqual(settlement_import.parse_status, SettlementImport.ParseStatus.PARSED)
        self.assertEqual(settlement_import.applied_status, SettlementImport.AppliedStatus.APPLIED)
        self.assertEqual(SettlementRecord.objects.filter(settlement_import=settlement_import).count(), 1)


    @override_settings(SETTLEMENT_IMPORT_UPLOAD_DIR="/tmp/hy_settlement_uploads_test", SETTLEMENT_IMPORT_UPLOAD_MAX_BYTES=8)
    def test_ops_upload_endpoint_rejects_oversized_file(self):
        self.client.force_authenticate(self.admin)
        upload = SimpleUploadedFile(
            "settlement.csv",
            self._csv_bytes([
                {"status": "SUCCESS", "amount": "12.50", "currency": "TRY", "merchantReference": "REF-UP-LARGE", "settlementReferenceCode": "SET-UP-LARGE"}
            ]),
            content_type="text/csv",
        )

        response = self.client.post(reverse("payments:ops-settlement-import-upload"), {"file": upload}, format="multipart")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(SettlementImport.objects.count(), 0)
        self.assertEqual(response.json()["error"]["code"], "settlement_import_failed")

    @override_settings(SETTLEMENT_IMPORT_UPLOAD_DIR="/tmp/hy_settlement_uploads_test")
    def test_ops_upload_endpoint_rejects_duplicate_file_with_existing_import_payload(self):
        self.client.force_authenticate(self.admin)
        payload = self._csv_bytes([
            {"status": "SUCCESS", "amount": "12.50", "currency": "TRY", "merchantReference": "REF-UP-DUP", "settlementReferenceCode": "SET-UP-DUP"}
        ])
        first_upload = SimpleUploadedFile("settlement.csv", payload, content_type="text/csv")
        second_upload = SimpleUploadedFile("settlement.csv", payload, content_type="text/csv")

        first = self.client.post(reverse("payments:ops-settlement-import-upload"), {"file": first_upload}, format="multipart")
        second = self.client.post(reverse("payments:ops-settlement-import-upload"), {"file": second_upload}, format="multipart")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(SettlementImport.objects.count(), 1)
        self.assertIn("existing_import", second.json()["data"])
        self.assertGreaterEqual(second.json()["data"]["existing_import"]["duplicate_attempts"], 1)

    @override_settings(SETTLEMENT_IMPORT_UPLOAD_DIR="/tmp/hy_settlement_uploads_test")
    def test_ops_upload_endpoint_requires_admin(self):
        self.client.force_authenticate(self.customer)
        upload = SimpleUploadedFile("settlement.csv", self._csv_bytes([]), content_type="text/csv")

        response = self.client.post(reverse("payments:ops-settlement-import-upload"), {"file": upload}, format="multipart")

        self.assertEqual(response.status_code, 403)


    def test_duplicate_attempt_is_logged_on_existing_import(self):
        payload = self._csv_bytes([
            {"status": "SUCCESS", "amount": "10.00", "currency": "TRY", "merchantReference": "REF-DUP-1", "settlementReferenceCode": "SET-DUP-1"}
        ])
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False) as handle:
            handle.write(payload)
            path = handle.name
        try:
            call_command("import_iyzico_settlement", path)
            with self.assertRaises(CommandError):
                call_command("import_iyzico_settlement", path)
        finally:
            os.unlink(path)
        settlement_import = SettlementImport.objects.get()
        self.assertTrue(any(item.get("event") == "duplicate_rejected" for item in settlement_import.lifecycle_events))

    @override_settings(SETTLEMENT_IMPORT_UPLOAD_DIR="/tmp/hy_settlement_uploads_test")
    def test_upload_records_checksum_verification_and_lifecycle_events(self):
        self.client.force_authenticate(self.admin)
        upload = SimpleUploadedFile(
            "settlement.csv",
            self._csv_bytes([
                {"status": "SUCCESS", "amount": "15.50", "currency": "TRY", "merchantReference": "REF-UP-2", "settlementReferenceCode": "SET-UP-2"}
            ]),
            content_type="text/csv",
        )

        response = self.client.post(reverse("payments:ops-settlement-import-upload"), {"file": upload}, format="multipart")

        self.assertEqual(response.status_code, 201)
        settlement_import = SettlementImport.objects.get(pk=response.json()["data"]["import"]["id"])
        self.assertIsNotNone(settlement_import.checksum_verified_at)
        self.assertTrue(any(item.get("event") == "completed" for item in settlement_import.lifecycle_events))

    def test_invalid_row_marks_import_failed(self):
        with tempfile.NamedTemporaryFile(suffix=".csv", delete=False, mode="w", encoding="utf-8") as handle:
            handle.write("status,amount,currency,merchantReference,settlementReferenceCode\nSUCCESS,broken,TRY,REF-BAD-1,SET-BAD-1\n")
            path = handle.name
        try:
            with self.assertRaises(Exception):
                call_command("import_iyzico_settlement", path)
        finally:
            os.unlink(path)
        settlement_import = SettlementImport.objects.get()
        self.assertEqual(settlement_import.parse_status, SettlementImport.ParseStatus.FAILED)
        self.assertEqual(settlement_import.applied_status, SettlementImport.AppliedStatus.FAILED)
        self.assertIn("Invalid amount", settlement_import.error_message)

    def test_unmatched_record_review_and_reprocess_surface(self):
        record = SettlementRecord.objects.create(
            provider="IYZICO",
            external_settlement_id="SET-UNMATCHED-OPS-1",
            amount=100,
            currency="TRY",
            processing_error="MATCHING_ENTITY_NOT_FOUND: Matching local entity not found.",
            unmatched_reason_code="MATCHING_ENTITY_NOT_FOUND",
            review_status="OPEN",
            is_processed=False,
        )
        self.client.force_authenticate(self.admin)

        review_response = self.client.patch(
            reverse("payments:ops-settlement-record-review", kwargs={"record_id": record.id}),
            {"review_status": "IGNORED", "operator_note": "provider row incomplete"},
            format="json",
        )
        self.assertEqual(review_response.status_code, 200)
        record.refresh_from_db()
        self.assertEqual(record.review_status, "IGNORED")
        detail_response = self.client.get(reverse("payments:ops-settlement-record-detail", kwargs={"record_id": record.id}))
        self.assertEqual(detail_response.status_code, 200)
        self.assertTrue(detail_response.json()["data"]["operator_flags"]["can_reprocess"])

        with patch("payments.api.views.process_settlement_record", side_effect=Exception("still unmatched")):
            retry_response = self.client.post(reverse("payments:ops-settlement-record-reprocess", kwargs={"record_id": record.id}), {}, format="json")
        self.assertEqual(retry_response.status_code, 400)
        record.refresh_from_db()
        self.assertEqual(record.review_status, "RETRY_SCHEDULED")

    @patch("payments.tasks.execute_settlement_import")
    def test_process_settlement_import_task_routes_by_import_id(self, execute_import):
        settlement_import = SettlementImport.objects.create(
            provider="IYZICO",
            source_type=SettlementImport.SourceType.COMMAND,
            checksum_sha256="a" * 64,
            storage_path="/tmp/settlement.csv",
        )
        execute_import.return_value = type("Summary", (), {"__dict__": {"created": 1, "duplicates": 0, "processed": 1, "errors": 0, "skipped": 0, "total_rows": 1, "unmatched": 0}})()
        from payments.tasks import process_settlement_import_task

        result = process_settlement_import_task(import_id=settlement_import.id)

        self.assertEqual(result["import_id"], settlement_import.id)
        execute_import.assert_called_once()


    def test_record_list_exposes_summary_and_stale_filter(self):
        stale_time = timezone.now() - timezone.timedelta(days=3)
        SettlementRecord.objects.create(
            provider="IYZICO",
            external_settlement_id="SET-STALE-1",
            amount=100,
            currency="TRY",
            processing_error="MATCHING_ENTITY_NOT_FOUND: Matching local entity not found.",
            unmatched_reason_code="MATCHING_ENTITY_NOT_FOUND",
            review_status="OPEN",
            is_processed=False,
            unmatched_opened_at=stale_time,
        )
        self.client.force_authenticate(self.admin)
        response = self.client.get(reverse("payments:ops-settlement-record-list") + "?stale=true")
        self.assertEqual(response.status_code, 200)
        payload = response.json()["data"]
        self.assertEqual(payload["summary"]["stale_manual_review"], 1)
        self.assertEqual(payload["results"][0]["next_action"], "manual_review")

    @override_settings(SETTLEMENT_IMPORT_INBOX_DIR="/tmp/hy_settlement_inbox", SETTLEMENT_IMPORT_ARCHIVE_DIR="/tmp/hy_settlement_archive")
    def test_inbox_import_treats_duplicate_as_archived_duplicate_not_failure(self):
        os.makedirs("/tmp/hy_settlement_inbox", exist_ok=True)
        os.makedirs("/tmp/hy_settlement_archive", exist_ok=True)
        payload = self._csv_bytes([
            {"status": "SUCCESS", "amount": "12.50", "currency": "TRY", "merchantReference": "REF-INBOX-DUP", "settlementReferenceCode": "SET-INBOX-DUP"}
        ])
        inbox_path = "/tmp/hy_settlement_inbox/duplicate.csv"
        with open(inbox_path, "wb") as handle:
            handle.write(payload)
        call_command("import_pending_settlement_files", "--limit", "10")
        with open(inbox_path, "wb") as handle:
            handle.write(payload)
        out = StringIO()
        call_command("import_pending_settlement_files", "--limit", "10", stdout=out)
        self.assertIn("duplicates=1", out.getvalue())
