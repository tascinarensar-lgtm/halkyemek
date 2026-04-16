from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import random
import time
from typing import Any, Mapping
from urllib.parse import urlencode, urlparse

import requests
from django.conf import settings
from django.core.exceptions import ValidationError


TIMEOUT_ERROR_CODES = {"10005", "10051", "10054"}
RETRYABLE_HTTP_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}


class IyzicoPayoutRequestError(Exception):
    def __init__(self, *, code: str, message: str, retryable: bool, raw: dict[str, Any] | None = None, http_status: int = 0):
        super().__init__(message)
        self.code = _truncate(code or "IYZICO_PAYOUT_ERROR", 64)
        self.message = _truncate(message or "iyzico payout request failed", 2000)
        self.retryable = bool(retryable)
        self.raw = raw or {}
        self.http_status = int(http_status or 0)


from businesses.models import BusinessProfile
from payments.providers.iyzico import _build_iyzico_auth_headers, _compact_json


def _price_value(amount_minor: int) -> Decimal:
    return (Decimal(int(amount_minor)) / Decimal("100")).quantize(Decimal("0.01"))


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _truncate(value: Any, limit: int) -> str:
    return _clean(value)[:limit]


def _extract_request_id(raw: Mapping[str, Any] | None) -> str:
    if not raw:
        return ""
    response = raw.get("response") if isinstance(raw, Mapping) else None
    if not isinstance(response, Mapping):
        return ""
    return _truncate(response.get("requestId"), 128)


def _snapshot(*, method: str, url: str, path: str, payload: Mapping[str, Any], attempt: int, correlation_id: str, http_status: int | None = None, response: Mapping[str, Any] | None = None, response_text: str = "", response_headers: Mapping[str, Any] | None = None) -> dict[str, Any]:
    return {
        "meta": {
            "method": method,
            "url": url,
            "path": path,
            "attempt": int(attempt),
            "correlation_id": _truncate(correlation_id, 128),
            "http_status": int(http_status) if http_status is not None else None,
        },
        "request": dict(payload),
        "response": dict(response or {}),
        "response_text": _truncate(response_text, 2000),
        "response_headers": {str(k): _truncate(v, 512) for k, v in dict(response_headers or {}).items()},
    }


def _retry_after_seconds(headers: Mapping[str, Any] | None) -> float | None:
    raw = _clean((headers or {}).get("Retry-After"))
    if not raw:
        return None
    try:
        return max(float(raw), 0.0)
    except ValueError:
        return None


@dataclass(frozen=True)
class DispatchResult:
    ok: bool
    provider_payout_id: str = ""
    error_code: str = ""
    error_message: str = ""
    retryable: bool = True
    raw: dict[str, Any] | None = None


@dataclass(frozen=True)
class PayoutStatusResult:
    ok: bool
    payout_status: str = ""
    item_status: str = ""
    provider_payout_id: str = ""
    item_reference_code: str = ""
    error_code: str = ""
    error_message: str = ""
    retryable: bool = True
    raw: dict[str, Any] | None = None


class IyzicoMarketplacePayoutProvider:
    """
    Gerçek para transferi için iyzico Mass Payout API'sini kullanır.

    Not:
    - Klasik marketplace akışında subMerchantPrice ile split verilmesi tek başına
      ayrı bir 'send money now' API çağrısı değildir; settlement sonrası iyzico kendi
      tarafında dağıtımı yapar.
    - Uygulamadaki payout dispatch ihtiyacı ise bağımsız bir para gönderme akışı
      tanımladığı için burada Mass Payout ürünü esas alınıyor.
    """

    name = "iyzico_marketplace"
    initialize_path = "/v1/mass/payout/init"
    auth_path = "/v1/mass/payout/auth"
    retrieve_path = "/v1/mass/payout/retrieve"

    SUCCESS_ITEM_STATUSES = {"SUCCESS"}
    FINAL_FAILED_ITEM_STATUSES = {
        "FAILED",
        "INVALID",
        "MASS_PAYOUT_CANCELED",
        "DEPOSIT_FAIL",
        "DEPOSIT_SUCCESS",
    }
    IN_PROGRESS_ITEM_STATUSES = {"INIT", "PROCESSING", "QUEUED"}
    FINAL_FAILED_BATCH_STATUSES = {"FAIL", "INSUFFICIENT_BALANCE", "CANCELED"}
    IN_PROGRESS_BATCH_STATUSES = {"INIT", "IN_PROGRESS", "PUBLISHED_TO_QUEUE"}
    SUCCESS_BATCH_STATUSES = {"COMPLETED"}

    def __init__(self, *, timeout: int | None = None, max_attempts: int | None = None):
        if not getattr(settings, "IYZICO_API_KEY", "") or not getattr(settings, "IYZICO_SECRET_KEY", ""):
            raise ValidationError("iyzico.keys_not_configured")
        self.base_url = (getattr(settings, "IYZICO_BASE_URL", "") or "https://api.iyzipay.com").rstrip("/")
        self.timeout = int(timeout if timeout is not None else (getattr(settings, "IYZICO_MASS_PAYOUT_TIMEOUT_SECONDS", 20) or 20))
        self.max_attempts = max(int(max_attempts if max_attempts is not None else (getattr(settings, "IYZICO_MASS_PAYOUT_MAX_ATTEMPTS", 3) or 3)), 1)
        self.retry_backoff_seconds = float(getattr(settings, "IYZICO_MASS_PAYOUT_RETRY_BACKOFF_SECONDS", 0.5) or 0.5)
        self.retry_max_sleep_seconds = float(getattr(settings, "IYZICO_MASS_PAYOUT_RETRY_MAX_SLEEP_SECONDS", 8.0) or 8.0)
        self.retry_jitter_ratio = float(getattr(settings, "IYZICO_MASS_PAYOUT_RETRY_JITTER_RATIO", 0.2) or 0.2)
        self.locale = _clean(getattr(settings, "IYZICO_MASS_PAYOUT_LOCALE", "tr")).lower() or "tr"
        self._validate_runtime_settings()
        self._validate_environment_config()
        if self.locale not in {"tr", "en"}:
            raise ValidationError("iyzico.invalid_mass_payout_locale")


    def _validate_runtime_settings(self) -> None:
        if self.timeout <= 0:
            raise ValidationError("iyzico.invalid_timeout")
        if self.max_attempts <= 0:
            raise ValidationError("iyzico.invalid_max_attempts")
        if self.retry_backoff_seconds < 0:
            raise ValidationError("iyzico.invalid_retry_backoff")
        if self.retry_max_sleep_seconds < 0:
            raise ValidationError("iyzico.invalid_retry_max_sleep")
        if self.retry_jitter_ratio < 0 or self.retry_jitter_ratio > 1:
            raise ValidationError("iyzico.invalid_retry_jitter_ratio")

    def _validate_environment_config(self) -> None:
        if not bool(getattr(settings, "IYZICO_ENFORCE_ENV_MATCH", True)):
            return
        parsed = urlparse(self.base_url)
        host = _clean(parsed.netloc).lower()
        scheme = _clean(parsed.scheme).lower()
        api_key = _clean(getattr(settings, "IYZICO_API_KEY", ""))
        environment = _clean(getattr(settings, "IYZICO_ENV", "sandbox")).lower() or "sandbox"
        is_sandbox_host = "sandbox" in host
        is_sandbox_key = api_key.startswith("sandbox-")
        if environment not in {"sandbox", "production"}:
            raise ValidationError("iyzico.invalid_environment")
        if scheme != "https":
            raise ValidationError("iyzico.invalid_base_url_scheme")
        if not host:
            raise ValidationError("iyzico.invalid_base_url")
        if environment == "sandbox" and not is_sandbox_host:
            raise ValidationError("iyzico.environment_mismatch:sandbox_requires_sandbox_url")
        if environment == "production" and is_sandbox_host:
            raise ValidationError("iyzico.environment_mismatch:production_requires_prod_url")
        if environment == "sandbox" and not is_sandbox_key:
            raise ValidationError("iyzico.environment_mismatch:sandbox_requires_sandbox_key")
        if environment == "production" and is_sandbox_key:
            raise ValidationError("iyzico.environment_mismatch:production_requires_prod_key")

    def _sleep_before_retry(self, *, attempt: int, retry_after_seconds: float | None = None) -> None:
        if attempt >= self.max_attempts:
            return
        base = max(self.retry_backoff_seconds, 0.0)
        if base <= 0 and (retry_after_seconds is None or retry_after_seconds <= 0):
            return
        delay = base * (2 ** (attempt - 1))
        if retry_after_seconds is not None and retry_after_seconds > 0:
            delay = max(delay, retry_after_seconds)
        if self.retry_jitter_ratio > 0:
            jitter = delay * self.retry_jitter_ratio
            delay = delay + random.uniform(-jitter, jitter)
        delay = min(max(delay, 0.0), max(self.retry_max_sleep_seconds, 0.0))
        if delay > 0:
            time.sleep(delay)

    def _path_with_locale(self, path: str) -> str:
        query = urlencode({"locale": self.locale})
        separator = "&" if "?" in path else "?"
        return f"{path}{separator}{query}"

    def _request_json_with_retry(self, *, method: str, path: str, payload: Mapping[str, Any], correlation_id: str) -> dict[str, Any]:
        signed_path = self._path_with_locale(path)
        url = f"{self.base_url}{signed_path}"
        body = _compact_json(payload).encode("utf-8")

        last_error: Exception | None = None
        for attempt in range(1, self.max_attempts + 1):
            headers = _build_iyzico_auth_headers(path=signed_path, body=payload)
            headers["X-Correlation-ID"] = _truncate(correlation_id, 128)
            try:
                response = requests.request(
                    method=method,
                    url=url,
                    data=body,
                    headers=headers,
                    timeout=self.timeout,
                )
            except requests.Timeout as exc:
                last_error = IyzicoPayoutRequestError(
                    code="NETWORK_TIMEOUT",
                    message=str(exc),
                    retryable=True,
                    raw=_snapshot(method=method, url=url, path=signed_path, payload=payload, attempt=attempt, correlation_id=correlation_id),
                )
                if attempt >= self.max_attempts:
                    raise last_error from exc
                self._sleep_before_retry(attempt=attempt)
                continue
            except requests.RequestException as exc:
                last_error = IyzicoPayoutRequestError(
                    code="NETWORK_ERROR",
                    message=str(exc),
                    retryable=True,
                    raw=_snapshot(method=method, url=url, path=signed_path, payload=payload, attempt=attempt, correlation_id=correlation_id),
                )
                if attempt >= self.max_attempts:
                    raise last_error from exc
                self._sleep_before_retry(attempt=attempt)
                continue

            response_text = _clean(getattr(response, "text", ""))
            response_headers_raw = getattr(response, "headers", {}) or {}
            response_headers = dict(response_headers_raw) if isinstance(response_headers_raw, Mapping) else {}
            try:
                data = response.json()
            except ValueError as exc:
                raise IyzicoPayoutRequestError(
                    code="INVALID_JSON",
                    message=f"iyzico.invalid_json_response:{response.status_code}",
                    retryable=False,
                    http_status=response.status_code,
                    raw=_snapshot(method=method, url=url, path=signed_path, payload=payload, attempt=attempt, correlation_id=correlation_id, http_status=response.status_code, response_text=response_text, response_headers=response_headers),
                ) from exc

            if not isinstance(data, Mapping):
                raise IyzicoPayoutRequestError(
                    code="INVALID_RESPONSE_SHAPE",
                    message="iyzico.invalid_response_shape",
                    retryable=False,
                    http_status=response.status_code,
                    raw=_snapshot(method=method, url=url, path=signed_path, payload=payload, attempt=attempt, correlation_id=correlation_id, http_status=response.status_code, response_text=response_text, response_headers=response_headers),
                )

            snapshot = _snapshot(method=method, url=url, path=signed_path, payload=payload, attempt=attempt, correlation_id=correlation_id, http_status=response.status_code, response=data, response_text=response_text, response_headers=response_headers)
            status_text = _clean(data.get("status")).lower()
            error_code = _clean(data.get("errorCode"))
            error_message = _clean(data.get("errorMessage")) or error_code or f"http_{response.status_code}"
            retry_after_seconds = _retry_after_seconds(response_headers)

            if response.status_code >= 500:
                last_error = IyzicoPayoutRequestError(
                    code=error_code or f"HTTP_{response.status_code}",
                    message=error_message,
                    retryable=True,
                    http_status=response.status_code,
                    raw=snapshot,
                )
                if attempt >= self.max_attempts:
                    raise last_error
                self._sleep_before_retry(attempt=attempt, retry_after_seconds=retry_after_seconds)
                continue

            if response.status_code >= 400 or status_text != "success":
                retryable = response.status_code in RETRYABLE_HTTP_STATUSES or error_code in TIMEOUT_ERROR_CODES
                error = IyzicoPayoutRequestError(
                    code=error_code or f"HTTP_{response.status_code}" or "REQUEST_FAILED",
                    message=error_message,
                    retryable=retryable,
                    http_status=response.status_code,
                    raw=snapshot,
                )
                if retryable and attempt < self.max_attempts:
                    last_error = error
                    self._sleep_before_retry(attempt=attempt, retry_after_seconds=retry_after_seconds)
                    continue
                raise error

            return dict(data)

        if last_error:
            raise last_error
        raise IyzicoPayoutRequestError(code="UNKNOWN_ERROR", message="iyzico.unknown_error", retryable=True)

    def _dispatch_error(
        self,
        *,
        code: str,
        message: str,
        retryable: bool,
        provider_payout_id: str = "",
        raw: dict[str, Any] | None = None,
    ) -> DispatchResult:
        return DispatchResult(
            ok=False,
            provider_payout_id=_truncate(provider_payout_id, 128),
            error_code=_truncate(code or "IYZICO_PAYOUT_ERROR", 64),
            error_message=_truncate(message or "iyzico payout request failed", 2000),
            retryable=retryable,
            raw=raw,
        )

    def _status_error(self, *, code: str, message: str, retryable: bool, raw: dict[str, Any] | None = None) -> PayoutStatusResult:
        return PayoutStatusResult(
            ok=False,
            error_code=_truncate(code or "IYZICO_PAYOUT_ERROR", 64),
            error_message=_truncate(message or "iyzico payout status request failed", 2000),
            retryable=retryable,
            raw=raw,
        )

    def _assert_business_ready(self, *, business: BusinessProfile) -> None:
        if not business.iyzico_submerchant_key:
            raise ValidationError("iyzico.payout.submerchant_key_required")
        if business.payout_onboarding_status != "APPROVED":
            raise ValidationError("iyzico.payout.business_not_approved")
        if not _clean(business.kyc_iban):
            raise ValidationError("iyzico.payout.iban_required")
        if not _clean(business.business_name):
            raise ValidationError("iyzico.payout.recipient_name_required")

    def _build_init_payload(
        self,
        *,
        payout_id: int,
        provider_reference: str,
        amount: int,
        currency: str,
        business: BusinessProfile,
    ) -> dict[str, Any]:
        self._assert_business_ready(business=business)
        if int(amount) <= 0:
            raise ValidationError("iyzico.payout.amount_invalid")
        if _clean(currency).upper() != "TRY":
            raise ValidationError("iyzico.payout.only_try_supported")
        if not _clean(provider_reference):
            raise ValidationError("iyzico.payout.provider_reference_required")

        conversation_id = f"HY-PAYOUT-CONV-{payout_id}"
        business_pk = getattr(business, "pk", None)
        description = _truncate(f"HalkYemek payout #{payout_id} / business #{business_pk}", 255)

        return {
            "externalId": provider_reference,
            "conversationId": conversation_id,
            "purpose": getattr(settings, "IYZICO_MASS_PAYOUT_PURPOSE", "SETTLEMENT") or "SETTLEMENT",
            "items": [
                {
                    "itemExternalId": provider_reference,
                    "recipientType": "IBAN",
                    "recipientInfo": _truncate(business.kyc_iban, 64),
                    "amount": {
                        "value": str(_price_value(amount)),
                        "currency": "TRY",
                    },
                    "description": description,
                    "recipientName": _truncate(business.business_name, 255),
                }
            ],
        }

    def _find_item(self, *, data: Mapping[str, Any], provider_reference: str) -> dict[str, Any] | None:
        items_container = (data or {}).get("massPayoutItems") or {}
        if not isinstance(items_container, Mapping):
            raise ValidationError("iyzico.payout.mass_payout_items_invalid")
        items = items_container.get("items") or []
        if not isinstance(items, list):
            raise ValidationError("iyzico.payout.mass_payout_items_invalid")
        matches = [item for item in items if isinstance(item, Mapping) and _clean(item.get("itemExternalId")) == provider_reference]
        if len(matches) > 1:
            raise ValidationError("iyzico.payout.duplicate_item_external_id")
        if not matches:
            return None
        return dict(matches[0])

    def dispatch(
        self,
        *,
        payout_id: int,
        provider_reference: str,
        amount: int,
        currency: str,
        business: BusinessProfile,
    ) -> DispatchResult:
        try:
            init_payload = self._build_init_payload(
                payout_id=payout_id,
                provider_reference=provider_reference,
                amount=amount,
                currency=currency,
                business=business,
            )
        except ValidationError as exc:
            return self._dispatch_error(
                code="VALIDATION_ERROR",
                message=str(exc),
                retryable=False,
                raw={"stage": "build_init_payload", "error": str(exc)},
            )

        try:
            init_data = self._request_json_with_retry(method="POST", path=self.initialize_path, payload=init_payload, correlation_id=f"HY-PAYOUT-INIT-{payout_id}")
        except requests.RequestException as exc:
            return self._dispatch_error(
                code="NETWORK_ERROR",
                message=str(exc),
                retryable=True,
                raw={"stage": "init", "payload": init_payload},
            )
        except IyzicoPayoutRequestError as exc:
            request_id_from_error = _extract_request_id(exc.raw)
            normalized_code = "NETWORK_ERROR" if exc.code == "NETWORK_TIMEOUT" else (exc.code or "INIT_REQUEST_ERROR")
            return self._dispatch_error(
                code=normalized_code,
                message=exc.message,
                retryable=exc.retryable,
                provider_payout_id=request_id_from_error,
                raw={"stage": "init", "payload": init_payload, "error": exc.raw},
            )
        except ValidationError as exc:
            return self._dispatch_error(
                code="INIT_REQUEST_ERROR",
                message=str(exc),
                retryable=False,
                raw={"stage": "init", "payload": init_payload},
            )

        request_id = _clean(init_data.get("requestId"))
        if not request_id:
            return self._dispatch_error(
                code="INIT_REQUEST_ID_MISSING",
                message="iyzico mass payout init response did not include requestId",
                retryable=False,
                provider_payout_id=request_id,
                raw={"stage": "init", "payload": init_payload, "response": init_data},
            )

        response_external_id = _clean(init_data.get("externalId"))
        if response_external_id and response_external_id != _clean(provider_reference):
            return self._dispatch_error(
                code="INIT_EXTERNAL_ID_MISMATCH",
                message="iyzico mass payout init returned mismatched externalId",
                retryable=False,
                provider_payout_id=request_id,
                raw={"stage": "init", "payload": init_payload, "response": init_data},
            )

        invalid_items = init_data.get("invalidItems") or []
        if invalid_items:
            first_invalid = invalid_items[0] or {}
            error_message = first_invalid.get("errorMessage") or first_invalid.get("message") or "invalid payout item"
            error_code = first_invalid.get("errorCode") or "INVALID_ITEM"
            return self._dispatch_error(
                code=str(error_code),
                message=str(error_message),
                retryable=False,
                raw={"stage": "init", "payload": init_payload, "response": init_data},
            )

        auth_payload = {"requestId": request_id}
        try:
            auth_data = self._request_json_with_retry(method="POST", path=self.auth_path, payload=auth_payload, correlation_id=f"HY-PAYOUT-AUTH-{request_id}")
        except requests.RequestException as exc:
            return self._dispatch_error(
                code="NETWORK_ERROR",
                message=str(exc),
                retryable=True,
                provider_payout_id=request_id,
                raw={
                    "stage": "auth",
                    "init_payload": init_payload,
                    "init_response": init_data,
                    "auth_payload": auth_payload,
                },
            )
        except IyzicoPayoutRequestError as exc:
            normalized_code = "NETWORK_ERROR" if exc.code == "NETWORK_TIMEOUT" else (exc.code or "AUTH_REQUEST_ERROR")
            return self._dispatch_error(
                code=normalized_code,
                message=exc.message,
                retryable=exc.retryable,
                provider_payout_id=request_id,
                raw={
                    "stage": "auth",
                    "init_payload": init_payload,
                    "init_response": init_data,
                    "auth_payload": auth_payload,
                    "error": exc.raw,
                },
            )
        except ValidationError as exc:
            return self._dispatch_error(
                code="AUTH_REQUEST_ERROR",
                message=str(exc),
                retryable=False,
                provider_payout_id=request_id,
                raw={
                    "stage": "auth",
                    "init_payload": init_payload,
                    "init_response": init_data,
                    "auth_payload": auth_payload,
                },
            )

        auth_status = _clean(auth_data.get("status")).lower()
        auth_request_id = _clean(auth_data.get("requestId"))
        if auth_request_id and auth_request_id != request_id:
            return self._dispatch_error(
                code="AUTH_REQUEST_ID_MISMATCH",
                message="iyzico mass payout auth returned mismatched requestId",
                retryable=False,
                provider_payout_id=request_id,
                raw={
                    "stage": "auth",
                    "init_payload": init_payload,
                    "init_response": init_data,
                    "auth_payload": auth_payload,
                    "auth_response": auth_data,
                },
            )
        auth_external_id = _clean(auth_data.get("externalMassPayoutId"))
        if auth_external_id and auth_external_id != _clean(provider_reference):
            return self._dispatch_error(
                code="AUTH_EXTERNAL_ID_MISMATCH",
                message="iyzico mass payout auth returned mismatched externalMassPayoutId",
                retryable=False,
                provider_payout_id=request_id,
                raw={
                    "stage": "auth",
                    "init_payload": init_payload,
                    "init_response": init_data,
                    "auth_payload": auth_payload,
                    "auth_response": auth_data,
                },
            )
        if auth_status != "success":
            auth_error_code = _clean(auth_data.get("errorCode")) or "AUTH_FAILED"
            auth_retryable = auth_error_code in TIMEOUT_ERROR_CODES or auth_error_code in {"50000"}
            return self._dispatch_error(
                code=auth_error_code,
                message=_clean(auth_data.get("errorMessage")) or "iyzico mass payout auth failed",
                retryable=auth_retryable,
                provider_payout_id=request_id,
                raw={
                    "stage": "auth",
                    "init_payload": init_payload,
                    "init_response": init_data,
                    "auth_payload": auth_payload,
                    "auth_response": auth_data,
                },
            )

        return DispatchResult(
            ok=True,
            provider_payout_id=request_id,
            raw={
                "stage": "auth",
                "init_payload": init_payload,
                "init_response": init_data,
                "auth_payload": auth_payload,
                "auth_response": auth_data,
            },
        )

    def retrieve_status(self, *, provider_payout_id: str, provider_reference: str) -> PayoutStatusResult:
        if not _clean(provider_payout_id):
            return self._status_error(code="REQUEST_ID_REQUIRED", message="provider_payout_id is required", retryable=False)
        if not _clean(provider_reference):
            return self._status_error(code="PROVIDER_REFERENCE_REQUIRED", message="provider_reference is required", retryable=False)

        payload = {
            "requestId": _clean(provider_payout_id),
            "externalMassPayoutId": _clean(provider_reference),
            "page": 0,
            "size": 40,
        }
        try:
            data = self._request_json_with_retry(method="POST", path=self.retrieve_path, payload=payload, correlation_id=f"HY-PAYOUT-STATUS-{_truncate(provider_payout_id, 64)}")
        except requests.RequestException as exc:
            return self._status_error(
                code="NETWORK_ERROR",
                message=str(exc),
                retryable=True,
                raw={
                    "stage": "retrieve",
                    "payload": payload,
                    "provider_payout_id": _clean(provider_payout_id),
                    "provider_reference": _clean(provider_reference),
                },
            )
        except IyzicoPayoutRequestError as exc:
            return self._status_error(
                code=exc.code or "RETRIEVE_REQUEST_ERROR",
                message=exc.message,
                retryable=exc.retryable,
                raw={
                    "stage": "retrieve",
                    "payload": payload,
                    "provider_payout_id": _clean(provider_payout_id),
                    "provider_reference": _clean(provider_reference),
                    "error": exc.raw,
                },
            )
        except ValidationError as exc:
            return self._status_error(
                code="RETRIEVE_REQUEST_ERROR",
                message=str(exc),
                retryable=False,
                raw={
                    "stage": "retrieve",
                    "payload": payload,
                    "provider_payout_id": _clean(provider_payout_id),
                    "provider_reference": _clean(provider_reference),
                },
            )

        status_text = _clean(data.get("status")).lower()
        if status_text != "success":
            return self._status_error(
                code=_clean(data.get("errorCode")) or "RETRIEVE_FAILED",
                message=_clean(data.get("errorMessage")) or "iyzico mass payout retrieve failed",
                retryable=False,
                raw=data,
            )

        response_request_id = _clean(data.get("requestId"))
        response_external_id = _clean(data.get("externalMassPayoutId"))
        if response_request_id and response_request_id != _clean(provider_payout_id):
            return self._status_error(
                code="REQUEST_ID_MISMATCH",
                message="iyzico mass payout retrieve returned mismatched requestId",
                retryable=False,
                raw=data,
            )
        if response_external_id and response_external_id != _clean(provider_reference):
            return self._status_error(
                code="EXTERNAL_ID_MISMATCH",
                message="iyzico mass payout retrieve returned mismatched externalMassPayoutId",
                retryable=False,
                raw=data,
            )

        mass_payout = data.get("massPayout") or {}
        if not isinstance(mass_payout, Mapping):
            return self._status_error(
                code="MASS_PAYOUT_INVALID",
                message="iyzico mass payout retrieve returned invalid massPayout shape",
                retryable=False,
                raw=data,
            )
        payout_status = _clean(mass_payout.get("massPayoutStatus")).upper()
        if not payout_status:
            return self._status_error(
                code="MASS_PAYOUT_STATUS_MISSING",
                message="iyzico mass payout retrieve did not include massPayoutStatus",
                retryable=False,
                raw=data,
            )
        item = self._find_item(data=data, provider_reference=_clean(provider_reference))
        if item is None:
            is_final_batch_state = payout_status in (self.SUCCESS_BATCH_STATUSES | self.FINAL_FAILED_BATCH_STATUSES)
            return self._status_error(
                code="ITEM_NOT_FOUND_FINAL_STATE" if is_final_batch_state else "ITEM_NOT_FOUND",
                message=(
                    f"Mass payout item not found for provider reference {_clean(provider_reference)} "
                    f"in final batch state {payout_status}"
                    if is_final_batch_state
                    else f"Mass payout item not found for provider reference {_clean(provider_reference)}"
                ),
                retryable=not is_final_batch_state,
                raw=data,
            )

        item_status = _clean(item.get("itemStatus")).upper()
        if not item_status:
            return self._status_error(
                code="ITEM_STATUS_MISSING",
                message="iyzico mass payout retrieve did not include itemStatus for matched item",
                retryable=False,
                raw=data,
            )
        error_messages = item.get("errorMessages") or []
        joined_errors = "; ".join(str(x) for x in error_messages if x)

        if item_status in self.SUCCESS_ITEM_STATUSES:
            return PayoutStatusResult(
                ok=True,
                payout_status=payout_status,
                item_status=item_status,
                provider_payout_id=_clean(provider_payout_id),
                item_reference_code=_clean(item.get("referenceCode")),
                raw=data,
            )

        if item_status in self.FINAL_FAILED_ITEM_STATUSES or payout_status in self.FINAL_FAILED_BATCH_STATUSES:
            return self._status_error(
                code=item_status or payout_status or "FAILED",
                message=joined_errors or f"mass payout failed with payout_status={payout_status} item_status={item_status}",
                retryable=False,
                raw=data,
            )

        return self._status_error(
            code=item_status or payout_status or "IN_PROGRESS",
            message=joined_errors or f"mass payout still in progress with payout_status={payout_status} item_status={item_status}",
            retryable=True,
            raw=data,
        )
