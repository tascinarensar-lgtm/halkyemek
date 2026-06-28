from django.test import TestCase, override_settings
from unittest.mock import patch
from rest_framework.test import APIClient

from accounts.models import User


@override_settings(GOOGLE_OAUTH_CLIENT_ID="test-client")
class RoleChangeRedTeamTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="g_sub",
            password=None,
            role=User.Role.CUSTOMER,
            google_sub="sub-red",
        )

    @patch("accounts.views_google.verify_google_id_token")
    def test_google_login_rejects_role_injection(self, m_verify):
        m_verify.return_value.sub = "sub-red"
        m_verify.return_value.email = "x@y.com"
        m_verify.return_value.email_verified = True
        m_verify.return_value.picture = ""

        resp = self.client.post(
            "/api/v1/auth/google/",
            {"id_token": "tok", "role": "BUSINESS"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data["error"]["code"], "role_not_allowed")  # type: ignore
        self.assertEqual(resp.data["error"]["message"], "role field is not allowed.")  # type: ignore
