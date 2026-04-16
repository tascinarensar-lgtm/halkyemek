from unittest.mock import patch

from django.test import SimpleTestCase

from payouts import tasks


class PayoutTaskWiringTests(SimpleTestCase):
    @patch("payouts.tasks.run_management_command", return_value="finance-worker:1")
    def test_run_payout_eligibility_task_routes_to_command(self, run_command):
        result = tasks.run_payout_eligibility_task()
        run_command.assert_called_once()
        self.assertEqual(run_command.call_args.kwargs["command_name"], "run_payout_eligibility")
        self.assertEqual(run_command.call_args.kwargs["queue"], "finance")
        self.assertEqual(result["job"], "run_payout_eligibility")

    @patch("payouts.tasks.run_management_command", return_value="finance-worker:2")
    def test_create_payout_batch_task_routes_to_command(self, run_command):
        result = tasks.create_payout_batch_task(max_businesses=12)
        run_command.assert_called_once()
        self.assertEqual(run_command.call_args.kwargs["command_name"], "create_payout_batch")
        self.assertEqual(run_command.call_args.kwargs["queue"], "finance")
        self.assertEqual(run_command.call_args.kwargs["max_businesses"], 12)
        self.assertEqual(result["job"], "create_payout_batch")
        self.assertEqual(result["max_businesses"], 12)

    @patch("payouts.tasks.run_management_command", return_value="finance-worker:3")
    def test_dispatch_due_payouts_task_routes_to_command(self, run_command):
        result = tasks.dispatch_due_payouts_task(limit=75)
        run_command.assert_called_once()
        self.assertEqual(run_command.call_args.kwargs["command_name"], "dispatch_due_payouts")
        self.assertEqual(run_command.call_args.kwargs["queue"], "finance")
        self.assertEqual(run_command.call_args.kwargs["limit"], 75)
        self.assertEqual(result["limit"], 75)

    @patch("payouts.tasks.run_management_command", return_value="finance-worker:4")
    def test_sync_sent_payout_statuses_task_routes_to_command(self, run_command):
        result = tasks.sync_sent_payout_statuses_task(limit=33)
        run_command.assert_called_once()
        self.assertEqual(run_command.call_args.kwargs["command_name"], "sync_sent_payout_statuses")
        self.assertEqual(run_command.call_args.kwargs["queue"], "finance")
        self.assertEqual(run_command.call_args.kwargs["limit"], 33)
        self.assertEqual(result["limit"], 33)

    @patch("payouts.tasks.run_management_command", return_value="ops-heavy-worker:9")
    def test_verify_financial_integrity_task_routes_to_command(self, run_command):
        result = tasks.verify_financial_integrity_task()
        run_command.assert_called_once()
        self.assertEqual(run_command.call_args.kwargs["command_name"], "verify_financial_integrity")
        self.assertEqual(run_command.call_args.kwargs["queue"], "ops_heavy")
        self.assertEqual(result["job"], "verify_financial_integrity")
