from django.test import RequestFactory, TestCase
from rest_framework.test import APIClient

from accounts.models import User
from logs.models import SystemLog
from logs.services import create_audit_log
from orders.tests.utils import jwt_login


class AuditLogTests(TestCase):
    def setUp(self):
        self.api_client = APIClient()
        self.factory = RequestFactory()
        self.user = User.objects.create_user(username="u1", password="pass", role=User.Role.CUSTOMER)

    def test_request_id_middleware_sets_header(self):
        jwt_login(self.api_client, username="u1", password="pass")
        resp = self.client.get("/orders/orders/", format="json")
        self.assertIn("X-Request-ID", resp)

    def test_system_log_action_field_supports_long_audit_actions(self):
        field = SystemLog._meta.get_field("action")
        self.assertGreaterEqual(field.max_length, 64)

    def test_create_audit_log_accepts_long_action_without_truncating(self):
        request = self.factory.post("/api/v1/notifications/admin/broadcast/", data={}, content_type="application/json")
        request.request_id = "req-test"
        action = "notifications.system_broadcast_queue_unavailable"

        create_audit_log(
            request=request,
            user=self.user,
            action=action,
            description="Long notification broadcast audit action",
            status_code=503,
            meta={"broadcast_id": "test"},
        )

        log = SystemLog.objects.get(action=action)
        self.assertEqual(log.action, action)
        self.assertEqual(log.status_code, 503)
        self.assertEqual(log.meta["broadcast_id"], "test")