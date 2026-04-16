from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User


class AdminBroadcastPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(username="admin", password="pass", role=User.Role.ADMIN)
        self.customer = User.objects.create_user(username="customer", password="pass", role=User.Role.CUSTOMER)

    def test_customer_cannot_use_admin_broadcast_endpoint(self):
        self.client.force_authenticate(self.customer)
        response = self.client.post(
            "/api/v1/notifications/admin/broadcast/",
            {"title": "Duyuru", "body": "Test"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_use_admin_broadcast_endpoint(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/notifications/admin/broadcast/",
            {"title": "Duyuru", "body": "Test"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
