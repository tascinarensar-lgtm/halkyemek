from __future__ import annotations

import json
from typing import Any

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from common.urls import build_frontend_absolute_url

FCM_SCOPE = ["https://www.googleapis.com/auth/firebase.messaging"]


def _service_account_info() -> dict[str, Any]:
    project_id = str(getattr(settings, "FCM_PROJECT_ID", "") or "").strip()
    client_email = str(getattr(settings, "FCM_CLIENT_EMAIL", "") or "").strip()
    private_key = str(getattr(settings, "FCM_PRIVATE_KEY", "") or "").replace("\\n", "\n").strip()

    if not project_id or not client_email or not private_key:
        raise ImproperlyConfigured("FCM credentials are not fully configured.")

    return {
        "type": "service_account",
        "project_id": project_id,
        "private_key_id": "",
        "private_key": private_key,
        "client_email": client_email,
        "client_id": "",
        "token_uri": "https://oauth2.googleapis.com/token",
    }


def _access_token() -> str:
    try:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account
    except Exception as exc:  # pragma: no cover - environment dependent import
        raise RuntimeError("Google auth dependencies are unavailable for FCM.") from exc

    info = _service_account_info()
    creds = service_account.Credentials.from_service_account_info(info, scopes=FCM_SCOPE)
    creds.refresh(Request())
    return str(creds.token or "")


def _build_webpush_link(data: dict[str, str] | None = None) -> str:
    candidate = str((data or {}).get("url") or "").strip()
    if candidate:
        return candidate

    try:
        return build_frontend_absolute_url(path="/bildirimler")
    except Exception:
        return "/bildirimler"


def _extract_fcm_error_details(response: requests.Response) -> tuple[str, dict[str, Any]]:
    try:
        payload = response.json()
    except Exception:
        text = (response.text or "").strip()
        return (text or f"HTTP {response.status_code}", {"raw": text})

    error_block = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error_block, dict):
        status = str(error_block.get("status") or "").strip()
        message = str(error_block.get("message") or "").strip()
        if status and message:
            return (f"{status}: {message}", payload)
        if message:
            return (message, payload)

    return (str(payload), payload if isinstance(payload, dict) else {"raw": str(payload)})


def send_fcm_message(*, token: str, title: str, body: str, data: dict[str, str] | None = None) -> dict[str, Any]:
    access_token = _access_token()
    project_id = str(getattr(settings, "FCM_PROJECT_ID", "") or "").strip()
    if not project_id:
        raise ImproperlyConfigured("FCM_PROJECT_ID is required.")

    payload_data = dict(data or {})
    payload_data.setdefault("title", title)
    payload_data.setdefault("body", body)
    payload_data.setdefault("url", _build_webpush_link(payload_data))

    url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
    payload = {
        "message": {
            "token": token,
            "data": payload_data,
            "android": {"priority": "high"},
            "apns": {
                "headers": {"apns-priority": "10"},
                "payload": {"aps": {"sound": "default"}},
            },
            "webpush": {
                "headers": {"Urgency": "high"},
                "fcm_options": {"link": payload_data["url"]},
            },
        }
    }

    resp = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
        },
        data=json.dumps(payload),
        timeout=10,
    )
    try:
        resp.raise_for_status()
    except requests.HTTPError as exc:
        detail, payload = _extract_fcm_error_details(resp)
        wrapped = RuntimeError(f"FCM gönderimi reddedildi ({resp.status_code}): {detail}")
        setattr(wrapped, "response_payload", payload)
        raise wrapped from exc
    return resp.json()
