from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import User


@override_settings(GOOGLE_OAUTH_CLIENT_ID="test-client")
class GoogleLoginFlowTests(TestCase):
    def setUp(self):
        self.c = APIClient()

    @patch("accounts.views_google.RefreshToken")
    @patch("accounts.views_google.verify_google_id_token")
    def test_first_login_creates_default_customer_user(self, m_verify, m_refresh):
        m_verify.return_value.sub = "sub2"
        m_verify.return_value.email = "c@d.com"
        m_verify.return_value.email_verified = True
        m_verify.return_value.picture = ""
        m_verify.return_value.name = "Customer Demo"

        fake_refresh = MagicMock()
        fake_refresh.access_token = "access"
        fake_refresh.__str__.return_value = "refresh"  # type: ignore
        m_refresh.for_user.return_value = fake_refresh

        resp = self.c.post(
            "/api/v1/auth/google/",
            {"id_token": "tok"},
            format="json",
        )

        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["access"])
        self.assertTrue(User.objects.filter(google_sub="sub2").exists())

        user = User.objects.get(google_sub="sub2")
        self.assertEqual(user.role, User.Role.CUSTOMER)
        self.assertEqual(user.email, "c@d.com")
        self.assertEqual(resp.data["has_business_membership"], False)
        self.assertEqual(resp.data["business_membership_count"], 0)
        self.assertEqual(resp.data["businesses"], [])

    @patch("accounts.views_google.RefreshToken")
    @patch("accounts.views_google.verify_google_id_token")
    def test_verified_email_links_existing_local_user(self, m_verify, m_refresh):
        existing = User.objects.create_user(username="ensar", password="pass", email="link@example.com")

        m_verify.return_value.sub = "sub-link"
        m_verify.return_value.email = "link@example.com"
        m_verify.return_value.email_verified = True
        m_verify.return_value.picture = ""
        m_verify.return_value.name = "Ensar"

        fake_refresh = MagicMock()
        fake_refresh.access_token = "access"
        fake_refresh.__str__.return_value = "refresh"  # type: ignore
        m_refresh.for_user.return_value = fake_refresh

        resp = self.c.post("/api/v1/auth/google/", {"id_token": "tok"}, format="json")

        self.assertEqual(resp.status_code, 200)
        existing.refresh_from_db()
        self.assertEqual(existing.google_sub, "sub-link")
        self.assertFalse(User.objects.exclude(id=existing.id).filter(google_sub="sub-link").exists())

    @patch("accounts.views_google.verify_google_id_token")
    def test_role_field_is_rejected(self, m_verify):
        m_verify.return_value.sub = "sub3"
        m_verify.return_value.email = "r@t.com"
        m_verify.return_value.email_verified = True
        m_verify.return_value.picture = ""
        m_verify.return_value.name = "Role Test"

        resp = self.c.post(
            "/api/v1/auth/google/",
            {"id_token": "tok", "role": "BUSINESS"},
            format="json",
        )

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data["error"]["code"], "role_not_allowed")
        self.assertEqual(resp.data["error"]["message"], "role field is not allowed.")

    @patch("accounts.views_google.verify_google_id_token")
    def test_inactive_user_cannot_login_with_google(self, m_verify):
        User.objects.create_user(
            username="inactive",
            password="pass",
            email="inactive@example.com",
            is_active=False,
        )

        m_verify.return_value.sub = "sub-inactive"
        m_verify.return_value.email = "inactive@example.com"
        m_verify.return_value.email_verified = True
        m_verify.return_value.picture = ""
        m_verify.return_value.name = "Inactive"

        resp = self.c.post(
            "/api/v1/auth/google/",
            {"id_token": "tok"},
            format="json",
        )

        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.data["error"]["code"], "user_inactive")
        self.assertEqual(resp.data["error"]["message"], "User account is inactive.")
