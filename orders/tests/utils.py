from __future__ import annotations

from accounts.models import User
from rest_framework.test import APIClient


def jwt_login(client: APIClient, *, username: str, password: str) -> dict[str, str]:
    """
    Test helper:
    Gerçek login endpoint'i kullanmadan client'ı authenticate eder.
    """

    user = User.objects.get(username=username)

    client.force_authenticate(user=user)

    return {"access": "test-access", "refresh": "test-refresh"}


def jwt_refresh(client: APIClient, *, refresh: str) -> str:
    return "test-access"