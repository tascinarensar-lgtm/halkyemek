from __future__ import annotations

import base64
import hashlib
import hmac
import json
import random
import secrets
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Mapping, Optional
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.core.exceptions import ValidationError




TIMEOUT_ERROR_CODES = {"10005", "10051", "10054", "10214", "10219"}
RETRYABLE_HTTP_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}
PLACEHOLDER_API_KEYS = {"sandbox-dev-api-key"}
PLACEHOLDER_SECRET_KEYS = {"dev-iyzico-secret-key-32bytes-min!!!!"}


class IyzicoRequestError(Exception):
    def __init__(self, *, message: str, code: str = "", http_status: int = 0, raw: dict[str, Any] | None = None, retryable: bool = False):
        super().__init__(message)
        self.message = str(message)
        self.code = str(code or "IYZICO_REQUEST_ERROR")
        self.http_status = int(http_status or 0)
        self.raw = raw or {}
        self.retryable = bool(retryable)

@dataclass(frozen=True)
class IyzicoWebhook:
    format: str
    iyzi_reference_code: str
    iyzi_event_type: str
    status: str
    payment_conversation_id: str
    payment_id: Optional[str] = None
    iyzi_payment_id: Optional[str] = None
    token: Optional[str] = None


@dataclass(frozen=True)
class IyzicoInitializeResult:
    token: str
    payment_page_url: str
    checkout_form_content: str
    raw: dict[str, Any]


@dataclass(frozen=True)
class IyzicoRetrieveResult:
    status: str
    payment_status: str
    conversation_id: str
    token: str
    payment_id: str
    raw: dict[str, Any]


def _hex_hmac_sha256(secret: str, message: str) -> str:
    mac = hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()


def _price_str(amount_minor: int) -> str:
    return f"{Decimal(int(amount_minor)) / Decimal('100'):.2f}"


def _compact_json(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def _build_iyzico_auth_headers(*, path: str, body: Mapping[str, Any]) -> dict[str, str]:
    api_key = getattr(settings, "IYZICO_API_KEY", "") or ""
    secret_key = getattr(settings, "IYZICO_SECRET_KEY", "") or ""
    if not api_key or not secret_key:
        raise ValidationError("iyzico.keys_not_configured")
    if _clean(api_key) in PLACEHOLDER_API_KEYS or _clean(secret_key) in PLACEHOLDER_SECRET_KEYS:
        raise ValidationError("iyzico.placeholder_keys_not_configured")

    random_key = secrets.token_hex(12)
    body_text = _compact_json(body)
    signature = _hex_hmac_sha256(secret_key, f"{random_key}{path}{body_text}")
    authorization_raw = f"apiKey:{api_key}&randomKey:{random_key}&signature:{signature}"
    authorization = base64.b64encode(authorization_raw.encode("utf-8")).decode("utf-8")
    return {
        "Authorization": f"IYZWSv2 {authorization}",
        "x-iyzi-rnd": random_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _truncate(value: Any, limit: int) -> str:
    return _clean(value)[:limit]


def _snapshot(*, method: str, url: str, path: str, correlation_id: str, payload: Mapping[str, Any], attempt: int, http_status: int | None = None, response_body: Mapping[str, Any] | None = None, response_text: str = "", response_headers: Mapping[str, Any] | None = None) -> dict[str, Any]:
    return {
        "meta": {
            "method": method,
            "url": url,
            "path": path,
            "correlation_id": correlation_id,
            "attempt": int(attempt),
            "http_status": int(http_status) if http_status is not None else None,
        },
        "request": dict(payload),
        "response": dict(response_body or {}),
        "response_text": _truncate(response_text, 2000),
        "response_headers": {str(k): _truncate(v, 512) for k, v in dict(response_headers or {}).items()},
    }


def _sleep_before_retry(*, attempt: int, max_attempts: int, retry_backoff_seconds: float, retry_max_sleep_seconds: float, retry_jitter_ratio: float, retry_after_seconds: float | None = None) -> None:
    if attempt >= max_attempts:
        return
    base = max(float(retry_backoff_seconds), 0.0)
    if base <= 0 and (retry_after_seconds is None or retry_after_seconds <= 0):
        return
    delay = base * (2 ** (attempt - 1))
    if retry_after_seconds is not None and retry_after_seconds > 0:
        delay = max(delay, retry_after_seconds)
    if retry_jitter_ratio > 0:
        jitter = delay * retry_jitter_ratio
        delay = delay + random.uniform(-jitter, jitter)
    delay = min(max(delay, 0.0), max(float(retry_max_sleep_seconds), 0.0))
    if delay > 0:
        time.sleep(delay)


def _validate_iyzico_environment_config() -> None:
    base_url = (getattr(settings, "IYZICO_BASE_URL", "") or "https://api.iyzipay.com").rstrip("/")
    parsed = urlparse(base_url)
    host = _clean(parsed.netloc).lower()
    scheme = _clean(parsed.scheme).lower()
    api_key = _clean(getattr(settings, "IYZICO_API_KEY", ""))
    environment = _clean(getattr(settings, "IYZICO_ENV", "sandbox")).lower() or "sandbox"
    enforce = bool(getattr(settings, "IYZICO_ENFORCE_ENV_MATCH", True))

    if scheme != "https":
        raise ValidationError("iyzico.invalid_base_url_scheme")
    if not host:
        raise ValidationError("iyzico.invalid_base_url")
    if not enforce:
        return

    is_sandbox_host = "sandbox" in host
    is_sandbox_key = api_key.startswith("sandbox-")
    if environment not in {"sandbox", "production"}:
        raise ValidationError("iyzico.invalid_environment")
    if environment == "sandbox" and not is_sandbox_host:
        raise ValidationError("iyzico.environment_mismatch:sandbox_requires_sandbox_url")
    if environment == "production" and is_sandbox_host:
        raise ValidationError("iyzico.environment_mismatch:production_requires_prod_url")
    if environment == "sandbox" and not is_sandbox_key:
        raise ValidationError("iyzico.environment_mismatch:sandbox_requires_sandbox_key")
    if environment == "production" and is_sandbox_key:
        raise ValidationError("iyzico.environment_mismatch:production_requires_prod_key")


def _request_json(
    *,
    method: str,
    path: str,
    payload: Mapping[str, Any],
    timeout: int = 20,
    max_attempts: int = 3,
    retry_backoff_seconds: float = 0.5,
    retry_max_sleep_seconds: float = 8.0,
    retry_jitter_ratio: float = 0.2,
    correlation_id: str = "",
) -> dict[str, Any]:
    _validate_iyzico_environment_config()
    if int(timeout) <= 0:
        raise ValidationError("iyzico.invalid_timeout")
    if int(max_attempts) <= 0:
        raise ValidationError("iyzico.invalid_max_attempts")
    if float(retry_backoff_seconds) < 0:
        raise ValidationError("iyzico.invalid_retry_backoff")
    if float(retry_max_sleep_seconds) < 0:
        raise ValidationError("iyzico.invalid_retry_max_sleep")
    if float(retry_jitter_ratio) < 0 or float(retry_jitter_ratio) > 1:
        raise ValidationError("iyzico.invalid_retry_jitter_ratio")

    base_url = (getattr(settings, "IYZICO_BASE_URL", "") or "https://api.iyzipay.com").rstrip("/")
    url = f"{base_url}{path}"
    body = _compact_json(payload).encode("utf-8")
    last_error: IyzicoRequestError | None = None

    for attempt in range(1, int(max_attempts) + 1):
        retry_after_seconds: float | None = None
        headers = _build_iyzico_auth_headers(path=path, body=payload)
        if correlation_id:
            headers["X-Correlation-ID"] = correlation_id
        try:
            response = requests.request(method=method, url=url, data=body, headers=headers, timeout=int(timeout))
        except requests.Timeout as exc:
            last_error = IyzicoRequestError(
                message=f"iyzico.network_timeout:{exc}",
                code="NETWORK_TIMEOUT",
                retryable=True,
                raw=_snapshot(method=method, url=url, path=path, correlation_id=correlation_id, payload=payload, attempt=attempt),
            )
            if attempt >= int(max_attempts):
                raise last_error from exc
            _sleep_before_retry(attempt=attempt, max_attempts=int(max_attempts), retry_backoff_seconds=retry_backoff_seconds, retry_max_sleep_seconds=retry_max_sleep_seconds, retry_jitter_ratio=retry_jitter_ratio, retry_after_seconds=retry_after_seconds)
            continue
        except requests.RequestException as exc:
            last_error = IyzicoRequestError(
                message=f"iyzico.network_error:{exc}",
                code="NETWORK_ERROR",
                retryable=True,
                raw=_snapshot(method=method, url=url, path=path, correlation_id=correlation_id, payload=payload, attempt=attempt),
            )
            if attempt >= int(max_attempts):
                raise last_error from exc
            _sleep_before_retry(attempt=attempt, max_attempts=int(max_attempts), retry_backoff_seconds=retry_backoff_seconds, retry_max_sleep_seconds=retry_max_sleep_seconds, retry_jitter_ratio=retry_jitter_ratio, retry_after_seconds=retry_after_seconds)
            continue

        response_text = _clean(getattr(response, "text", ""))
        response_headers_raw = getattr(response, "headers", {}) or {}
        response_headers = dict(response_headers_raw) if isinstance(response_headers_raw, Mapping) else {}
        try:
            data = response.json()
        except ValueError as exc:
            raise IyzicoRequestError(
                message=f"iyzico.invalid_json_response:{response.status_code}",
                code="INVALID_JSON",
                http_status=response.status_code,
                retryable=False,
                raw=_snapshot(method=method, url=url, path=path, correlation_id=correlation_id, payload=payload, attempt=attempt, http_status=response.status_code, response_text=response_text, response_headers=response_headers),
            ) from exc

        if not isinstance(data, Mapping):
            raise IyzicoRequestError(
                message="iyzico.invalid_response_shape",
                code="INVALID_RESPONSE_SHAPE",
                http_status=response.status_code,
                retryable=False,
                raw=_snapshot(method=method, url=url, path=path, correlation_id=correlation_id, payload=payload, attempt=attempt, http_status=response.status_code, response_text=response_text, response_headers=response_headers),
            )

        snapshot = _snapshot(method=method, url=url, path=path, correlation_id=correlation_id, payload=payload, attempt=attempt, http_status=response.status_code, response_body=data, response_text=response_text, response_headers=response_headers)
        status_text = _clean(data.get("status")).lower()
        error_code = _truncate(data.get("errorCode"), 64)
        error_message = _truncate(data.get("errorMessage") or error_code or f"http_{response.status_code}", 2000)

        retry_after = _clean(response_headers.get("Retry-After"))
        if retry_after:
            try:
                retry_after_seconds = max(float(retry_after), 0.0)
            except ValueError:
                retry_after_seconds = None

        if response.status_code >= 500:
            last_error = IyzicoRequestError(
                message=error_message,
                code=error_code or f"HTTP_{response.status_code}",
                http_status=response.status_code,
                retryable=True,
                raw=snapshot,
            )
            if attempt >= int(max_attempts):
                raise last_error
            _sleep_before_retry(attempt=attempt, max_attempts=int(max_attempts), retry_backoff_seconds=retry_backoff_seconds, retry_max_sleep_seconds=retry_max_sleep_seconds, retry_jitter_ratio=retry_jitter_ratio, retry_after_seconds=retry_after_seconds)
            continue

        if response.status_code >= 400 or status_text != "success":
            retryable = response.status_code in RETRYABLE_HTTP_STATUSES or error_code in TIMEOUT_ERROR_CODES
            error = IyzicoRequestError(
                message=error_message or "iyzico.request_failed",
                code=error_code or f"HTTP_{response.status_code}" or "REQUEST_FAILED",
                http_status=response.status_code,
                retryable=retryable,
                raw=snapshot,
            )
            if retryable and attempt < int(max_attempts):
                last_error = error
                _sleep_before_retry(attempt=attempt, max_attempts=int(max_attempts), retry_backoff_seconds=retry_backoff_seconds, retry_max_sleep_seconds=retry_max_sleep_seconds, retry_jitter_ratio=retry_jitter_ratio, retry_after_seconds=retry_after_seconds)
                continue
            raise error

        return {"meta": snapshot["meta"], "body": dict(data)}

    if last_error:
        raise last_error
    raise IyzicoRequestError(message="iyzico.unknown_error", code="UNKNOWN_ERROR", retryable=True)


def parse_payment_intent_id_from_conversation_id(conversation_id: str | None) -> Optional[int]:
    raw = str(conversation_id or "").strip()
    if not raw:
        return None
    if raw.isdigit():
        return int(raw)
    if raw.startswith("HY-PI-") and raw[6:].isdigit():
        return int(raw[6:])
    return None


def normalize_iyzico_status(status: str | None) -> str:
    return str(status or "").strip().upper()


def parse_webhook_payload(payload: Mapping[str, Any]) -> IyzicoWebhook:
    iyzi_reference_code = str(payload.get("iyziReferenceCode") or "")
    iyzi_event_type = str(payload.get("iyziEventType") or "")
    status = normalize_iyzico_status(payload.get("status"))
    payment_conversation_id = str(payload.get("paymentConversationId") or "")

    if not (iyzi_reference_code and iyzi_event_type and status and payment_conversation_id):
        raise ValidationError("iyzico.webhook.missing_fields")

    token = payload.get("token")
    iyzi_payment_id = payload.get("iyziPaymentId")
    payment_id = payload.get("paymentId")

    if token is not None or iyzi_payment_id is not None:
        return IyzicoWebhook(
            format="HPP",
            iyzi_reference_code=iyzi_reference_code,
            iyzi_event_type=iyzi_event_type,
            status=status,
            payment_conversation_id=payment_conversation_id,
            payment_id=str(payment_id) if payment_id is not None else None,
            iyzi_payment_id=str(iyzi_payment_id) if iyzi_payment_id is not None else None,
            token=str(token) if token is not None else None,
        )

    return IyzicoWebhook(
        format="DIRECT",
        iyzi_reference_code=iyzi_reference_code,
        iyzi_event_type=iyzi_event_type,
        status=status,
        payment_conversation_id=payment_conversation_id,
        payment_id=str(payment_id) if payment_id is not None else None,
    )


def compute_signature_v3(payload: Mapping[str, Any], *, secret_key: str) -> str:
    w = parse_webhook_payload(payload)

    if w.format == "DIRECT":
        if not w.payment_id:
            raise ValidationError("iyzico.webhook.missing_paymentId_for_direct")
        message = f"{secret_key}{w.iyzi_event_type}{w.payment_id}{w.payment_conversation_id}{w.status}"
        return _hex_hmac_sha256(secret_key, message)

    if not (w.iyzi_payment_id and w.token):
        raise ValidationError("iyzico.webhook.missing_hpp_fields")
    message = f"{secret_key}{w.iyzi_event_type}{w.iyzi_payment_id}{w.token}{w.payment_conversation_id}{w.status}"
    return _hex_hmac_sha256(secret_key, message)


def verify_signature_v3(payload: Mapping[str, Any], headers: Mapping[str, str]) -> None:
    sig = headers.get("X-IYZ-SIGNATURE-V3") or headers.get("HTTP_X_IYZ_SIGNATURE_V3")
    if not sig:
        raise ValidationError("iyzico.webhook.missing_signature")

    secret_key = getattr(settings, "IYZICO_SECRET_KEY", "") or ""
    if not secret_key:
        raise ValidationError("iyzico.webhook.secret_not_configured")

    expected = compute_signature_v3(payload, secret_key=secret_key)
    if not hmac.compare_digest(str(sig).lower(), str(expected).lower()):
        raise ValidationError("iyzico.webhook.invalid_signature")


class IyzicoCheckoutFormClient:
    initialize_path = "/payment/iyzipos/checkoutform/initialize/auth/ecom"
    retrieve_path = "/payment/iyzipos/checkoutform/auth/ecom/detail"

    def initialize_topup(self, *, intent, callback_url: str) -> IyzicoInitializeResult:
        if not callback_url:
            raise ValidationError("iyzico.callback_url_required")

        parsed = urlparse(callback_url)
        if parsed.scheme != "https" and not getattr(settings, "DEBUG", False):
            raise ValidationError("iyzico.callback_url_https_required")

        user = intent.user
        buyer_name = getattr(user, "first_name", "") or "HalkYemek"
        buyer_surname = getattr(user, "last_name", "") or "User"
        buyer_email = getattr(user, "google_email", "") or getattr(user, "email", "") or "support@halkyemek.local"

        payload = {
            "locale": "tr",
            "conversationId": intent.marketplace_conversation_id,
            "price": _price_str(intent.amount),
            "paidPrice": _price_str(intent.amount),
            "currency": "TRY",
            "basketId": f"WALLET-{intent.id}",
            "paymentGroup": "PRODUCT",
            "callbackUrl": callback_url,
            "enabledInstallments": [1],
            "buyer": {
                "id": str(user.id),
                "name": buyer_name,
                "surname": buyer_surname,
                "identityNumber": "11111111111",
                "email": buyer_email,
                "gsmNumber": "+905350000000",
                "registrationDate": "2025-01-01 00:00:00",
                "lastLoginDate": "2025-01-01 00:00:00",
                "registrationAddress": "Beylikduzu",
                "city": "Istanbul",
                "country": "Turkey",
                "zipCode": "34520",
                "ip": "127.0.0.1",
            },
            "billingAddress": {
                "contactName": f"{buyer_name} {buyer_surname}".strip(),
                "city": "Istanbul",
                "country": "Turkey",
                "address": "Beylikduzu",
                "zipCode": "34520",
            },
            "basketItems": [
                {
                    "id": f"WALLET-TOPUP-{intent.id}",
                    "name": f"HalkYemek Wallet Topup #{intent.id}",
                    "category1": "Wallet",
                    "itemType": "VIRTUAL",
                    "price": _price_str(intent.amount),
                }
            ],
        }
        snapshot = _request_json(
            method="POST",
            path=self.initialize_path,
            payload=payload,
            timeout=int(getattr(settings, "IYZICO_REQUEST_TIMEOUT_SECONDS", 20) or 20),
            max_attempts=int(getattr(settings, "IYZICO_REQUEST_MAX_ATTEMPTS", 3) or 3),
            retry_backoff_seconds=float(getattr(settings, "IYZICO_REQUEST_RETRY_BACKOFF_SECONDS", 0.5) or 0.5),
            retry_max_sleep_seconds=float(getattr(settings, "IYZICO_REQUEST_RETRY_MAX_SLEEP_SECONDS", 8.0) or 8.0),
            retry_jitter_ratio=float(getattr(settings, "IYZICO_REQUEST_RETRY_JITTER_RATIO", 0.2) or 0.2),
            correlation_id=f"HY-TOPUP-INIT-{intent.id}",
        )
        data = snapshot["body"]
        token = str(data.get("token") or "").strip()
        payment_page_url = str(data.get("paymentPageUrl") or "").strip()
        if not token or not payment_page_url:
            raise ValidationError("iyzico.initialize_missing_token_or_url")
        parsed_page_url = urlparse(payment_page_url)
        if parsed_page_url.scheme != "https":
            raise ValidationError("iyzico.initialize_invalid_payment_page_url")
        return IyzicoInitializeResult(
            token=token,
            payment_page_url=payment_page_url,
            checkout_form_content=str(data.get("checkoutFormContent") or ""),
            raw={"meta": snapshot["meta"], "request": payload, "response": data},
        )

    def retrieve(self, *, token: str, conversation_id: str) -> IyzicoRetrieveResult:
        payload = {
            "locale": "tr",
            "conversationId": conversation_id,
            "token": token,
        }
        snapshot = _request_json(
            method="POST",
            path=self.retrieve_path,
            payload=payload,
            timeout=int(getattr(settings, "IYZICO_REQUEST_TIMEOUT_SECONDS", 20) or 20),
            max_attempts=int(getattr(settings, "IYZICO_REQUEST_MAX_ATTEMPTS", 3) or 3),
            retry_backoff_seconds=float(getattr(settings, "IYZICO_REQUEST_RETRY_BACKOFF_SECONDS", 0.5) or 0.5),
            retry_max_sleep_seconds=float(getattr(settings, "IYZICO_REQUEST_RETRY_MAX_SLEEP_SECONDS", 8.0) or 8.0),
            retry_jitter_ratio=float(getattr(settings, "IYZICO_REQUEST_RETRY_JITTER_RATIO", 0.2) or 0.2),
            correlation_id=f"HY-TOPUP-RETRIEVE-{_truncate(conversation_id, 64)}",
        )
        data = snapshot["body"]
        response_conversation_id = str(data.get("conversationId") or conversation_id or "")
        response_token = str(data.get("token") or token)
        if response_conversation_id != str(conversation_id):
            raise IyzicoRequestError(
                message="iyzico.retrieve.conversation_id_mismatch",
                code="CONVERSATION_ID_MISMATCH",
                retryable=False,
                raw={"meta": snapshot["meta"], "request": payload, "response": data},
            )
        if response_token != str(token):
            raise IyzicoRequestError(
                message="iyzico.retrieve.token_mismatch",
                code="TOKEN_MISMATCH",
                retryable=False,
                raw={"meta": snapshot["meta"], "request": payload, "response": data},
            )
        payment_status_raw = data.get("paymentStatus")
        payment_status = normalize_iyzico_status(payment_status_raw or data.get("status"))
        if _clean(data.get("status")).lower() == "success" and not _clean(payment_status_raw):
            raise IyzicoRequestError(
                message="iyzico.retrieve.payment_status_missing",
                code="PAYMENT_STATUS_MISSING",
                retryable=False,
                raw={"meta": snapshot["meta"], "request": payload, "response": data},
            )
        if not payment_status:
            raise IyzicoRequestError(
                message="iyzico.retrieve.payment_status_missing",
                code="PAYMENT_STATUS_MISSING",
                retryable=False,
                raw={"meta": snapshot["meta"], "request": payload, "response": data},
            )
        payment_id = str(data.get("paymentId") or "")
        if payment_status == "SUCCESS" and not payment_id:
            raise IyzicoRequestError(
                message="iyzico.retrieve.payment_id_missing_on_success",
                code="PAYMENT_ID_MISSING",
                retryable=False,
                raw={"meta": snapshot["meta"], "request": payload, "response": data},
            )
        return IyzicoRetrieveResult(
            status=normalize_iyzico_status(data.get("status")),
            payment_status=payment_status,
            conversation_id=response_conversation_id,
            token=response_token,
            payment_id=payment_id,
            raw={"meta": snapshot["meta"], "request": payload, "response": data},
        )
