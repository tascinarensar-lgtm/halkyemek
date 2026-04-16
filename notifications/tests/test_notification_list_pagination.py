from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from notifications.models import Notification


class NotificationListPaginationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="notif-user", password="pass", role=User.Role.CUSTOMER)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_notification_list_is_paginated(self):
        for idx in range(25):
            Notification.objects.create(
                user=self.user,
                type=Notification.Type.SYSTEM_BROADCAST,
                title=f"Notif {idx}",
                body="Body",
            )

        response = self.client.get("/api/v1/notifications/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("count", response.data)
        self.assertIn("results", response.data)
        self.assertEqual(response.data["count"], 25)
        self.assertEqual(len(response.data["results"]), 20)

    def test_notification_list_accepts_page_size_query_param(self):
        for idx in range(12):
            Notification.objects.create(
                user=self.user,
                type=Notification.Type.SYSTEM_BROADCAST,
                title=f"Notif {idx}",
                body="Body",
            )

        response = self.client.get("/api/v1/notifications/?page_size=5")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 12)
        self.assertEqual(len(response.data["results"]), 5)
