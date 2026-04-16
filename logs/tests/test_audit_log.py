from django.test import TestCase
from accounts.models import User
from rest_framework.test import APIClient

from logs.models import SystemLog
from orders.tests.utils import jwt_login #kendi yazdığımız guvenlik katmanı

#Middleware yazmıştık onun doprulaması.


class AuditLogTests(TestCase):
    def setUp(self):
        self.api_client = APIClient()
        self.user = User.objects.create_user(username="u1", password="pass", role=User.Role.CUSTOMER)

    def test_request_id_middleware_sets_header(self):
        jwt_login(self.api_client, username="u1", password="pass")
        resp = self.client.get("/orders/orders/", format="json")
        # X-Request-ID header response'ta olmalı
        self.assertIn("X-Request-ID", resp)