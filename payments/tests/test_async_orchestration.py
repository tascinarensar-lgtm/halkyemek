import tempfile
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase, TestCase

from health.models import JobHeartbeat
from payments import tasks


class PaymentTaskWiringTests(SimpleTestCase):
    @patch("payments.tasks.run_management_command", return_value="ops-worker:1")
    def test_report_financial_anomalies_task_routes_to_command(self, run_command):
        result = tasks.report_financial_anomalies_task()
        run_command.assert_called_once()
        self.assertEqual(run_command.call_args.kwargs["command_name"], "report_financial_anomalies")
        self.assertEqual(run_command.call_args.kwargs["queue"], "ops_heavy")
        self.assertEqual(result["job"], "report_financial_anomalies")

    @patch("payments.tasks.run_management_command", return_value="finance-worker:9")
    def test_reprocess_unmatched_settlement_records_task_normalizes_limit(self, run_command):
        result = tasks.reprocess_unmatched_settlement_records_task(limit=0)
        run_command.assert_called_once()
        self.assertEqual(run_command.call_args.kwargs["command_name"], "reprocess_unmatched_settlement_records")
        self.assertEqual(run_command.call_args.kwargs["queue"], "finance")
        self.assertEqual(run_command.call_args.kwargs["limit"], 1)
        self.assertEqual(result["limit"], 1)

    @patch("payments.tasks.run_management_command", return_value="finance-worker:5")
    def test_import_pending_settlement_files_task_routes_to_command(self, run_command):
        result = tasks.import_pending_settlement_files_task(limit=11)
        run_command.assert_called_once()
        self.assertEqual(run_command.call_args.kwargs["command_name"], "import_pending_settlement_files")
        self.assertEqual(run_command.call_args.kwargs["queue"], "finance")
        self.assertEqual(run_command.call_args.kwargs["limit"], 11)
        self.assertEqual(result["limit"], 11)


class ImportPendingSettlementFilesCommandTests(TestCase):
    @patch("payments.management.commands.import_pending_settlement_files.call_command")
    def test_import_pending_moves_successful_file_to_archive(self, call_command_mock):
        call_command_mock.return_value = None
        with tempfile.TemporaryDirectory() as tmp:
            inbox = Path(tmp) / "inbox"
            archive = Path(tmp) / "archive"
            failed = Path(tmp) / "failed"
            inbox.mkdir(parents=True, exist_ok=True)
            csv_path = inbox / "batch.csv"
            csv_path.write_text("status,amount,currency\nSUCCESS,10.00,TRY\n", encoding="utf-8")

            call_command(
                "import_pending_settlement_files",
                "--inbox-dir",
                str(inbox),
                "--archive-dir",
                str(archive),
                "--failed-dir",
                str(failed),
                "--limit",
                "5",
            )

            self.assertFalse(csv_path.exists())
            archived = list(archive.glob("batch.*.csv"))
            self.assertEqual(len(archived), 1)
            heartbeat = JobHeartbeat.objects.get(job_name="import_pending_settlement_files")
            self.assertEqual(heartbeat.status, JobHeartbeat.Status.SUCCESS)
            self.assertEqual(int(heartbeat.meta.get("imported", 0)), 1)

    def test_import_pending_without_inbox_reports_and_exits_cleanly(self):
        stdout = StringIO()

        call_command("import_pending_settlement_files", stdout=stdout)

        self.assertIn("SETTLEMENT_IMPORT_INBOX_DIR is not configured", stdout.getvalue())
        heartbeat = JobHeartbeat.objects.get(job_name="import_pending_settlement_files")
        self.assertEqual(heartbeat.status, JobHeartbeat.Status.SUCCESS)
