from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from django.utils import timezone

from health.models import JobHeartbeat
from health.services import SCHEDULER_HEARTBEAT_NAME


class MetricsTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_metrics_endpoint_returns_text_in_debug(self):
        JobHeartbeat.objects.create(job_name=SCHEDULER_HEARTBEAT_NAME, last_success_at=timezone.now(), status="SUCCESS")
        resp = self.client.get("/health/metrics/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("text/plain", resp["Content-Type"])
        self.assertIn("halkyemek_", resp.content.decode("utf-8"))
        self.assertIn("halkyemek_release_info", resp.content.decode("utf-8"))
        self.assertIn("halkyemek_runtime_check_ok", resp.content.decode("utf-8"))

    @override_settings(
        DEBUG=False,
        TESTING=False,
        METRICS_TOKEN="secret-token",
        METRICS_IP_ALLOWLIST=[],
        METRICS_ALLOW_QUERY_TOKEN=False,
    )
    def test_metrics_endpoint_disallows_query_token_in_non_debug(self):
        resp = self.client.get("/health/metrics/")
        self.assertEqual(resp.status_code, 403)

        resp = self.client.get("/health/metrics/?token=secret-token")
        self.assertEqual(resp.status_code, 403)

        resp = self.client.get("/health/metrics/", HTTP_AUTHORIZATION="Bearer secret-token")
        self.assertEqual(resp.status_code, 200)

    @override_settings(DEBUG=False, TESTING=False, METRICS_TOKEN="secret-token", METRICS_ALLOW_QUERY_TOKEN=True)
    def test_metrics_endpoint_allows_query_token_when_explicitly_enabled(self):
        resp = self.client.get("/health/metrics/?token=secret-token")
        self.assertEqual(resp.status_code, 200)

    @override_settings(
        DEBUG=False,
        TESTING=False,
        METRICS_TOKEN="",
        METRICS_IP_ALLOWLIST=["203.0.113.0/24"],
        TRUST_X_FORWARDED_FOR=True,
        TRUSTED_PROXY_IPS=["10.0.0.0/8"],
    )
    def test_metrics_ip_allowlist_uses_trusted_proxy_chain(self):
        ok = self.client.get(
            "/health/metrics/",
            REMOTE_ADDR="10.10.10.10",
            HTTP_X_FORWARDED_FOR="203.0.113.25",
        )
        self.assertEqual(ok.status_code, 200)

        blocked = self.client.get(
            "/health/metrics/",
            REMOTE_ADDR="198.51.100.10",
            HTTP_X_FORWARDED_FOR="203.0.113.25",
        )
        self.assertEqual(blocked.status_code, 403)

    @override_settings(
        DEBUG=False,
        TESTING=False,
        METRICS_TOKEN="",
        METRICS_IP_ALLOWLIST=["198.51.100.0/24"],
        TRUST_X_FORWARDED_FOR=True,
        TRUSTED_PROXY_IPS=["10.0.0.0/8"],
    )
    def test_metrics_rejects_spoofed_leftmost_xff_when_proxy_appends(self):
        blocked = self.client.get(
            "/health/metrics/",
            REMOTE_ADDR="10.10.10.10",
            HTTP_X_FORWARDED_FOR="198.51.100.77, 203.0.113.25",
        )
        self.assertEqual(blocked.status_code, 403)
