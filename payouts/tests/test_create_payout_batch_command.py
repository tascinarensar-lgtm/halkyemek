from django.core.management import call_command
from django.test import TestCase

from health.models import JobHeartbeat


class CreatePayoutBatchCommandTests(TestCase):
    def test_records_success_heartbeat_when_no_eligible_items(self):
        call_command("create_payout_batch", worker="test-worker")

        hb = JobHeartbeat.objects.get(job_name="create_payout_batch")
        self.assertEqual(hb.status, JobHeartbeat.Status.SUCCESS)
        self.assertIsNotNone(hb.last_success_at)
        self.assertEqual((hb.meta or {}).get("created"), 0)
        self.assertEqual((hb.meta or {}).get("worker"), "test-worker")
