from __future__ import annotations

"""
İşletmeleri iyzico marketplace altında gerçek submerchant olarak oluşturur / günceller
ve ödeme kırılımında kullanılacak payload'ları üretir.
"""

from dataclasses import dataclass
from decimal import Decimal
import random
import time
from typing import Any, Dict, Mapping
from urllib.parse import urlparse
import uuid

import requests
from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone

from businesses.services.membership import (
    get_business_contact_email,
    get_business_contact_gsm_number,
    get_business_finance_notification_users,
)
from notifications.models import Notification
from notifications.services import NotificationService
from payments.providers.iyzico import _build_iyzico_auth_headers, _compact_json


TIMEOUT_ERROR_CODES = {"10005", "10051", "10054", "10214", "10219"}
RATE_LIMIT_ERROR_CODES = {"50000"}
RETRYABLE_PROVIDER_ERROR_CODES = TIMEOUT_ERROR_CODES | RATE_LIMIT_ERROR_CODES
PENDING_PROVIDER_STATUSES = {"WAITING_FOR_APPROVAL", "IN_REVIEW", "PENDING", "WAITING"}
ACTIVE_PROVIDER_STATUSES = {"ACTIVE", "APPROVED"}
REJECTED_PROVIDER_STATUSES = {"REJECTED", "PASSIVE", "FAILED", "DECLINED"}
RETRYABLE_HTTP_STATUSES = {408, 429, 500, 502, 503, 504}
NON_REJECTABLE_PROVIDER_ERROR_CODES = {"2001", "2002"}


def _price_str(amount_minor: int) -> str:
    return f"{Decimal(amount_minor) / Decimal('100'):.2f}"


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _truncate(value: Any, limit: int) -> str:
    return _clean(value)[:limit]


def _retry_after_seconds(headers: Mapping[str, Any] | None) -> float | None:
    raw = _clean((headers or {}).get("Retry-After"))
    if not raw:
        return None
    try:
        return max(float(raw), 0.0)
    except ValueError:
        return None


def _set_if_not_blank(payload: dict[str, str], *, key: str, value: Any, limit: int) -> None:
    normalized = _truncate(value, limit)
    if normalized:
        payload[key] = normalized


def _normalize_gsm_number(value: Any) -> str:
    raw = "".join(ch for ch in _clean(value) if ch.isdigit() or ch == "+")
    if not raw:
        return ""
    if raw.startswith("+90"):
        return raw
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits.startswith("90"):
        return f"+{digits}"
    if digits.startswith("0"):
        digits = digits[1:]
    return f"+90{digits}"


def _submerchant_external_id(business) -> str:
    return f"BUS-{business.id}"


def _normalize_submerchant_type(value: Any) -> str:
    normalized = _clean(value or "PERSONAL").upper()
    aliases = {
        "LIMITED_OR_JOINT_STOCK": "LIMITED_OR_JOINT_STOCK_COMPANY",
    }
    return aliases.get(normalized, normalized)


def _conversation_id(*, business, stage: str, correlation_id: str) -> str:
    suffix = correlation_id.replace("-", "")[:12]
    return f"HY-SUB-{stage}-{business.id}-{suffix}"


def _common_submerchant_payload(*, business, conversation_id: str) -> dict[str, str]:
    return {
        "locale": "tr",
        "conversationId": _truncate(conversation_id, 255),
        "name": _truncate(business.business_name, 255),
        "email": _truncate(get_business_contact_email(business), 255),
        "gsmNumber": _normalize_gsm_number(get_business_contact_gsm_number(business)),
        "address": _truncate(business.kyc_address or business.adress, 255),
        "iban": _truncate(business.kyc_iban, 64),
        "currency": "TRY",
        "contactName": _truncate(business.kyc_contact_name, 100),
        "contactSurname": _truncate(business.kyc_contact_surname, 100),
    }


def build_submerchant_create_payload(business, *, conversation_id: str | None = None) -> dict[str, str]:
    payload = _common_submerchant_payload(
        business=business,
        conversation_id=conversation_id or _conversation_id(business=business, stage="CREATE", correlation_id=str(uuid.uuid4())),
    )
    payload.update(
        {
            "subMerchantExternalId": _submerchant_external_id(business),
            "subMerchantType": _truncate(_normalize_submerchant_type(business.iyzico_submerchant_type or "PERSONAL"), 64),
        }
    )

    submerchant_type = payload["subMerchantType"]
    if submerchant_type == "PERSONAL":
        payload["identityNumber"] = _truncate(business.kyc_identity_number, 32)
    elif submerchant_type == "PRIVATE_COMPANY":
        payload.update(
            {
                "taxOffice": _truncate(business.kyc_tax_office, 255),
                "legalCompanyTitle": _truncate(business.kyc_legal_company_title, 255),
            }
        )
        _set_if_not_blank(payload, key="identityNumber", value=business.kyc_identity_number, limit=32)
        _set_if_not_blank(payload, key="taxNumber", value=business.kyc_tax_number, limit=100)
    elif submerchant_type == "LIMITED_OR_JOINT_STOCK_COMPANY":
        payload.update(
            {
                "taxOffice": _truncate(business.kyc_tax_office, 255),
                "legalCompanyTitle": _truncate(business.kyc_legal_company_title, 255),
                "taxNumber": _truncate(business.kyc_tax_number, 100),
            }
        )
    else:
        raise ValidationError("iyzico.submerchant.invalid_type")

    return payload


def build_submerchant_update_payload(business, *, conversation_id: str | None = None) -> dict[str, str]:
    if not business.iyzico_submerchant_key:
        raise ValidationError("iyzico.submerchant.submerchant_key_required_for_update")

    payload = _common_submerchant_payload(
        business=business,
        conversation_id=conversation_id or _conversation_id(business=business, stage="UPDATE", correlation_id=str(uuid.uuid4())),
    )
    payload["subMerchantKey"] = _truncate(business.iyzico_submerchant_key, 255)

    submerchant_type = _normalize_submerchant_type(business.iyzico_submerchant_type or "PERSONAL")
    if submerchant_type == "PERSONAL":
        payload["identityNumber"] = _truncate(business.kyc_identity_number, 32)
    if submerchant_type in {"PRIVATE_COMPANY", "LIMITED_OR_JOINT_STOCK_COMPANY"}:
        payload.update(
            {
                "taxOffice": _truncate(business.kyc_tax_office, 255),
                "legalCompanyTitle": _truncate(business.kyc_legal_company_title, 255),
            }
        )
        if submerchant_type == "PRIVATE_COMPANY":
            _set_if_not_blank(payload, key="identityNumber", value=business.kyc_identity_number, limit=32)
        tax_number = _truncate(business.kyc_tax_number, 100)
        if tax_number:
            payload["taxNumber"] = tax_number
    return payload


def build_marketplace_payment_payload(
    *,
    payment_intent,
    order,
    business,
    gross_amount_minor: int,
    submerchant_amount_minor: int,
) -> dict:
    from payments.references import payment_basket_item_id, payment_conversation_id

    if gross_amount_minor <= 0:
        raise ValidationError("gross_amount_minor must be positive")
    if submerchant_amount_minor < 0:
        raise ValidationError("submerchant_amount_minor cannot be negative")
    if submerchant_amount_minor > gross_amount_minor:
        raise ValidationError("submerchant_amount_minor cannot exceed gross_amount_minor")
    if not business.iyzico_submerchant_key:
        raise ValidationError("business.iyzico_submerchant_key is required")

    conversation_id = payment_conversation_id(payment_intent.id)
    basket_item_id = payment_basket_item_id(order.id)

    return {
        "locale": "tr",
        "conversationId": conversation_id,
        "price": _price_str(gross_amount_minor),
        "paidPrice": _price_str(gross_amount_minor),
        "currency": "TRY",
        "installment": 1,
        "basketId": basket_item_id,
        "paymentChannel": "WEB",
        "paymentGroup": "PRODUCT",
        "buyer": {
            "id": str(payment_intent.user_id),
            "name": getattr(payment_intent.user, "first_name", "") or "HalkYemek",
            "surname": getattr(payment_intent.user, "last_name", "") or "User",
            "gsmNumber": "",
            "email": getattr(payment_intent.user, "google_email", "") or "",
            "identityNumber": "11111111111",
            "lastLoginDate": "2025-01-01 00:00:00",
            "registrationDate": "2025-01-01 00:00:00",
            "registrationAddress": "Beylikduzu",
            "ip": "127.0.0.1",
            "city": "Istanbul",
            "country": "Turkey",
            "zipCode": "34520",
        },
        "shippingAddress": {
            "contactName": business.business_name,
            "city": business.district or "Istanbul",
            "country": "Turkey",
            "address": business.adress,
            "zipCode": business.kyc_zip_code or "34520",
        },
        "billingAddress": {
            "contactName": business.business_name,
            "city": business.district or "Istanbul",
            "country": "Turkey",
            "address": business.adress,
            "zipCode": business.kyc_zip_code or "34520",
        },
        "basketItems": [
            {
                "id": basket_item_id,
                "name": f"HalkYemek Order #{order.id}",
                "category1": "Food",
                "itemType": "PHYSICAL",
                "price": _price_str(gross_amount_minor),
                "subMerchantKey": business.iyzico_submerchant_key,
                "subMerchantPrice": _price_str(submerchant_amount_minor),
            }
        ],
    }


def validate_submerchant_business_or_raise(*, business) -> None:
    submerchant_type = _normalize_submerchant_type(business.iyzico_submerchant_type or "PERSONAL")
    if submerchant_type not in {"PERSONAL", "PRIVATE_COMPANY", "LIMITED_OR_JOINT_STOCK_COMPANY"}:
        raise ValidationError("iyzico.submerchant.invalid_type")

    iban = _clean(business.kyc_iban)
    normalized_gsm = _normalize_gsm_number(get_business_contact_gsm_number(business))
    common_required = {
        "business_name": _clean(business.business_name),
        "email": _clean(get_business_contact_email(business)),
        "gsmNumber": normalized_gsm,
        "address": _clean(business.kyc_address or business.adress),
        "iban": iban,
        "contactName": _clean(business.kyc_contact_name),
        "contactSurname": _clean(business.kyc_contact_surname),
    }
    missing = [key for key, value in common_required.items() if not value]

    type_specific: list[str] = []
    if submerchant_type == "PERSONAL":
        if not _clean(business.kyc_identity_number):
            type_specific.append("identityNumber")
    elif submerchant_type == "PRIVATE_COMPANY":
        if not _clean(business.kyc_tax_office):
            type_specific.append("taxOffice")
        if not _clean(business.kyc_legal_company_title):
            type_specific.append("legalCompanyTitle")
    elif submerchant_type == "LIMITED_OR_JOINT_STOCK_COMPANY":
        if not _clean(business.kyc_tax_office):
            type_specific.append("taxOffice")
        if not _clean(business.kyc_legal_company_title):
            type_specific.append("legalCompanyTitle")
        if not _clean(business.kyc_tax_number):
            type_specific.append("taxNumber")

    validation_errors: list[str] = []
    iban_compact = iban.replace(" ", "")
    if iban and not iban_compact.startswith("TR"):
        validation_errors.append("iban_format")
    if iban and len(iban_compact) != 26:
        validation_errors.append("iban_length")
    digits = "".join(ch for ch in normalized_gsm if ch.isdigit())
    if normalized_gsm and len(digits) != 12:
        validation_errors.append("gsmNumber_format")

    identity_number = _clean(business.kyc_identity_number)
    if submerchant_type == "PERSONAL" and identity_number:
        if not identity_number.isdigit() or len(identity_number) != 11:
            validation_errors.append("identityNumber_format")
    elif submerchant_type == "PRIVATE_COMPANY" and identity_number:
        if not identity_number.isdigit() or len(identity_number) != 11:
            validation_errors.append("identityNumber_format")

    tax_number = _clean(business.kyc_tax_number)
    if submerchant_type in {"PRIVATE_COMPANY", "LIMITED_OR_JOINT_STOCK_COMPANY"} and tax_number:
        if not tax_number.isdigit() or len(tax_number) != 10:
            validation_errors.append("taxNumber_format")

    if missing or type_specific or validation_errors:
        fields = ", ".join(missing + type_specific + validation_errors)
        raise ValidationError(f"iyzico.submerchant.missing_required_fields:{fields}")


@dataclass(frozen=True)
class SubmerchantCreateResult:
    ok: bool
    submerchant_key: str = ""
    provider_status: str = ""
    error_code: str = ""
    error_message: str = ""
    raw: dict[str, Any] | None = None


@dataclass(frozen=True)
class SubmerchantDetailResult:
    ok: bool
    submerchant_key: str = ""
    provider_status: str = ""
    raw: dict[str, Any] | None = None


class IyzicoAPIError(Exception):
    def __init__(self, *, message: str, code: str = "", http_status: int = 0, raw: dict[str, Any] | None = None, retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status
        self.raw = raw or {}
        self.retryable = retryable


class IyzicoMarketplaceClient:
    create_path = "/onboarding/submerchant"
    update_path = "/onboarding/submerchant"
    detail_path = "/onboarding/submerchant/detail"
    payment_item_update_path = "/payment/item"

    def __init__(self, *, timeout: int | None = None, max_attempts: int | None = None):
        if not getattr(settings, "IYZICO_API_KEY", "") or not getattr(settings, "IYZICO_SECRET_KEY", ""):
            raise ValidationError("iyzico keys not configured")
        self.base_url = (getattr(settings, "IYZICO_BASE_URL", "") or "https://api.iyzipay.com").rstrip("/")
        self.timeout = timeout or int(getattr(settings, "IYZICO_SUBMERCHANT_TIMEOUT_SECONDS", 20) or 20)
        self.max_attempts = max_attempts or int(getattr(settings, "IYZICO_SUBMERCHANT_MAX_ATTEMPTS", 3) or 3)
        self.retry_backoff_seconds = float(
            getattr(settings, "IYZICO_SUBMERCHANT_RETRY_BACKOFF_SECONDS", 0.5) or 0.5
        )
        self.retry_max_sleep_seconds = float(
            getattr(settings, "IYZICO_SUBMERCHANT_RETRY_MAX_SLEEP_SECONDS", 8.0) or 8.0
        )
        self.retry_jitter_ratio = float(
            getattr(settings, "IYZICO_SUBMERCHANT_RETRY_JITTER_RATIO", 0.2) or 0.2
        )
        self.environment = _clean(getattr(settings, "IYZICO_ENV", "")).lower() or "sandbox"
        self.enforce_environment_match = bool(getattr(settings, "IYZICO_ENFORCE_ENV_MATCH", True))
        self._validate_runtime_settings()
        self._validate_environment_config()

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
        if not self.enforce_environment_match:
            return
        host = _clean(urlparse(self.base_url).netloc).lower()
        api_key = _clean(getattr(settings, "IYZICO_API_KEY", ""))
        scheme = _clean(urlparse(self.base_url).scheme).lower()
        is_sandbox_host = "sandbox" in host
        is_sandbox_key = api_key.startswith("sandbox-")

        if self.environment not in {"sandbox", "production"}:
            raise ValidationError("iyzico.invalid_environment")
        if scheme != "https":
            raise ValidationError("iyzico.invalid_base_url_scheme")
        if not host:
            raise ValidationError("iyzico.invalid_base_url")
        if self.environment == "sandbox" and not is_sandbox_host:
            raise ValidationError("iyzico.environment_mismatch:sandbox_requires_sandbox_url")
        if self.environment == "production" and is_sandbox_host:
            raise ValidationError("iyzico.environment_mismatch:production_requires_prod_url")
        if self.environment == "sandbox" and not is_sandbox_key:
            raise ValidationError("iyzico.environment_mismatch:sandbox_requires_sandbox_key")
        if self.environment == "production" and is_sandbox_key:
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

    def _snapshot(
        self,
        *,
        method: str,
        path: str,
        correlation_id: str,
        http_status: int,
        body: Mapping[str, Any] | None,
        attempt: int,
        payload: Mapping[str, Any],
        response_text: str = "",
        response_headers: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "meta": {
                "method": method,
                "path": path,
                "url": f"{self.base_url}{path}",
                "http_status": int(http_status),
                "attempt": int(attempt),
                "correlation_id": _truncate(correlation_id, 128),
            },
            "request": dict(payload),
            "body": dict(body or {}),
            "response_text": _truncate(response_text, 2000),
            "response_headers": {
                str(k): _truncate(v, 512)
                for k, v in dict(response_headers or {}).items()
            },
        }

    def _request_json_with_retry(self, *, method: str, path: str, payload: Mapping[str, Any], correlation_id: str) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        body = _compact_json(payload).encode("utf-8")

        last_error: IyzicoAPIError | None = None
        for attempt in range(1, self.max_attempts + 1):
            headers = _build_iyzico_auth_headers(path=path, body=payload)
            headers["X-Correlation-ID"] = correlation_id
            try:
                response = requests.request(method=method, url=url, data=body, headers=headers, timeout=self.timeout)
            except requests.Timeout as exc:
                last_error = IyzicoAPIError(
                    message=f"iyzico.network_timeout:{exc}",
                    code="NETWORK_TIMEOUT",
                    retryable=True,
                    raw={"method": method, "path": path, "url": url, "correlation_id": correlation_id, "attempt": attempt},
                )
                if attempt >= self.max_attempts:
                    raise last_error from exc
                self._sleep_before_retry(attempt=attempt)
                continue
            except requests.RequestException as exc:
                last_error = IyzicoAPIError(
                    message=f"iyzico.network_error:{exc}",
                    code="NETWORK_ERROR",
                    retryable=True,
                    raw={"method": method, "path": path, "url": url, "correlation_id": correlation_id, "attempt": attempt},
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
                raise IyzicoAPIError(
                    message=f"iyzico.invalid_json_response:{response.status_code}",
                    code="INVALID_JSON",
                    http_status=response.status_code,
                    raw={
                        "method": method,
                        "path": path,
                        "url": url,
                        "correlation_id": correlation_id,
                        "attempt": attempt,
                        "response_text": _truncate(response_text, 2000),
                        "response_headers": {
                            str(k): _truncate(v, 512)
                            for k, v in response_headers.items()
                        },
                    },
                    retryable=False,
                ) from exc

            if not isinstance(data, Mapping):
                raise IyzicoAPIError(
                    message="iyzico.invalid_response_shape",
                    code="INVALID_RESPONSE_SHAPE",
                    http_status=response.status_code,
                    raw={
                        "method": method,
                        "path": path,
                        "url": url,
                        "correlation_id": correlation_id,
                        "attempt": attempt,
                        "response_text": _truncate(response_text, 2000),
                        "response_headers": {
                            str(k): _truncate(v, 512)
                            for k, v in response_headers.items()
                        },
                    },
                    retryable=False,
                )

            status_text = _clean(data.get("status")).lower()
            error_code = _clean(data.get("errorCode"))
            error_message = _clean(data.get("errorMessage")) or error_code or f"http_{response.status_code}"
            snapshot = self._snapshot(
                method=method,
                path=path,
                correlation_id=correlation_id,
                http_status=response.status_code,
                body=data,
                attempt=attempt,
                payload=payload,
                response_text=response_text,
                response_headers=response_headers,
            )

            retryable = response.status_code in RETRYABLE_HTTP_STATUSES or error_code in RETRYABLE_PROVIDER_ERROR_CODES
            retry_after_seconds = _retry_after_seconds(response_headers)

            if response.status_code >= 500:
                last_error = IyzicoAPIError(
                    message=f"iyzico.http_error:{response.status_code}",
                    code=error_code,
                    http_status=response.status_code,
                    raw=snapshot,
                    retryable=True,
                )
                if attempt >= self.max_attempts:
                    raise last_error
                self._sleep_before_retry(attempt=attempt, retry_after_seconds=retry_after_seconds)
                continue

            if response.status_code >= 400 or status_text != "success":
                error = IyzicoAPIError(
                    message=f"iyzico.request_failed:{error_message}",
                    code=error_code,
                    http_status=response.status_code,
                    raw=snapshot,
                    retryable=retryable,
                )
                if retryable and attempt < self.max_attempts:
                    last_error = error
                    self._sleep_before_retry(attempt=attempt, retry_after_seconds=retry_after_seconds)
                    continue
                raise error

            return snapshot

        if last_error:
            raise last_error
        raise IyzicoAPIError(message="iyzico.unknown_error")

    def create_submerchant(self, *, payload: Dict[str, Any], correlation_id: str) -> SubmerchantCreateResult:
        snapshot = self._request_json_with_retry(method="POST", path=self.create_path, payload=payload, correlation_id=correlation_id)
        data = snapshot.get("body") or {}
        return SubmerchantCreateResult(
            ok=True,
            submerchant_key=_extract_provider_submerchant_key(data),
            provider_status=_extract_provider_submerchant_status(data),
            raw=snapshot,
        )

    def update_submerchant(self, *, payload: Dict[str, Any], correlation_id: str) -> SubmerchantCreateResult:
        snapshot = self._request_json_with_retry(method="PUT", path=self.update_path, payload=payload, correlation_id=correlation_id)
        data = snapshot.get("body") or {}
        return SubmerchantCreateResult(
            ok=True,
            submerchant_key=_extract_provider_submerchant_key(data) or _clean(payload.get("subMerchantKey")),
            provider_status=_extract_provider_submerchant_status(data),
            raw=snapshot,
        )

    def retrieve_submerchant(self, *, business, correlation_id: str) -> SubmerchantDetailResult:
        payload = {
            "locale": "tr",
            "conversationId": _conversation_id(business=business, stage="DETAIL", correlation_id=correlation_id),
            "subMerchantExternalId": _submerchant_external_id(business),
        }
        snapshot = self._request_json_with_retry(method="POST", path=self.detail_path, payload=payload, correlation_id=correlation_id)
        data = snapshot.get("body") or {}
        return SubmerchantDetailResult(
            ok=True,
            submerchant_key=_extract_provider_submerchant_key(data),
            provider_status=_extract_provider_submerchant_status(data),
            raw=snapshot,
        )

    def _recover_submerchant_on_duplicate_external_id(self, *, business, exc: IyzicoAPIError, correlation_id: str) -> SubmerchantCreateResult:
        if exc.code != "2002":
            raise exc

        detail = self.retrieve_submerchant(business=business, correlation_id=correlation_id)
        if not detail.submerchant_key:
            raise IyzicoAPIError(
                message="iyzico.submerchant.duplicate_external_id_without_detail_key",
                code=exc.code,
                http_status=exc.http_status,
                raw={"create_error": exc.raw, "detail": detail.raw},
                retryable=False,
            )

        business.iyzico_submerchant_key = detail.submerchant_key
        update_payload = build_submerchant_update_payload(
            business,
            conversation_id=_conversation_id(business=business, stage="UPDATE", correlation_id=correlation_id),
        )
        try:
            update_result = self.update_submerchant(payload=update_payload, correlation_id=correlation_id)
        except IyzicoAPIError as update_exc:
            return SubmerchantCreateResult(
                ok=True,
                submerchant_key=detail.submerchant_key,
                provider_status=detail.provider_status,
                raw={
                    "duplicate_external_id": exc.raw,
                    "detail": detail.raw or {},
                    "update_error": update_exc.raw,
                },
            )

        combined_raw = {
            "duplicate_external_id": exc.raw,
            "detail": detail.raw or {},
            "update": update_result.raw or {},
        }
        return SubmerchantCreateResult(
            ok=True,
            submerchant_key=update_result.submerchant_key or detail.submerchant_key,
            provider_status=update_result.provider_status or detail.provider_status,
            raw=combined_raw,
        )

    def _reconcile_submerchant_after_ambiguous_create(self, *, business, exc: IyzicoAPIError, correlation_id: str) -> SubmerchantCreateResult:
        detail = self.retrieve_submerchant(business=business, correlation_id=correlation_id)
        if not detail.submerchant_key:
            raise IyzicoAPIError(
                message="iyzico.submerchant.ambiguous_create_without_detail_key",
                code=exc.code,
                http_status=exc.http_status,
                raw={"create_error": exc.raw, "detail": detail.raw},
                retryable=False,
            )
        return SubmerchantCreateResult(
            ok=True,
            submerchant_key=detail.submerchant_key,
            provider_status=detail.provider_status,
            raw={"create_error": exc.raw, "detail": detail.raw},
        )

    def _reconcile_submerchant_after_ambiguous_update(self, *, business, exc: IyzicoAPIError, correlation_id: str) -> SubmerchantCreateResult:
        detail = self.retrieve_submerchant(business=business, correlation_id=correlation_id)
        if not detail.submerchant_key:
            raise IyzicoAPIError(
                message="iyzico.submerchant.ambiguous_update_without_detail_key",
                code=exc.code,
                http_status=exc.http_status,
                raw={"update_error": exc.raw, "detail": detail.raw},
                retryable=False,
            )

        if business.iyzico_submerchant_key and detail.submerchant_key != business.iyzico_submerchant_key:
            raise IyzicoAPIError(
                message="iyzico.submerchant.ambiguous_update_key_mismatch",
                code=exc.code,
                http_status=exc.http_status,
                raw={
                    "update_error": exc.raw,
                    "detail": detail.raw,
                    "expected_submerchant_key": business.iyzico_submerchant_key,
                    "retrieved_submerchant_key": detail.submerchant_key,
                },
                retryable=False,
            )

        return SubmerchantCreateResult(
            ok=True,
            submerchant_key=detail.submerchant_key,
            provider_status=detail.provider_status,
            raw={"update_error": exc.raw, "detail": detail.raw},
        )

    def _reconcile_existing_submerchant_after_update_failure(self, *, business, exc: IyzicoAPIError, correlation_id: str) -> SubmerchantCreateResult:
        detail = self.retrieve_submerchant(business=business, correlation_id=correlation_id)
        if not detail.submerchant_key:
            raise exc
        if detail.submerchant_key != business.iyzico_submerchant_key:
            raise exc
        return SubmerchantCreateResult(
            ok=True,
            submerchant_key=detail.submerchant_key,
            provider_status=detail.provider_status,
            raw={"update_error": exc.raw, "detail": detail.raw},
        )

    def _create_with_reconciliation(self, *, business, correlation_id: str) -> SubmerchantCreateResult:
        payload = build_submerchant_create_payload(
            business,
            conversation_id=_conversation_id(business=business, stage="CREATE", correlation_id=correlation_id),
        )
        try:
            return self.create_submerchant(payload=payload, correlation_id=correlation_id)
        except IyzicoAPIError as exc:
            if exc.code == "2002":
                return self._recover_submerchant_on_duplicate_external_id(business=business, exc=exc, correlation_id=correlation_id)
            if exc.retryable:
                return self._reconcile_submerchant_after_ambiguous_create(business=business, exc=exc, correlation_id=correlation_id)
            raise exc

    def create_or_update_submerchant(self, *, business, correlation_id: str) -> SubmerchantCreateResult:
        validate_submerchant_business_or_raise(business=business)
        if business.iyzico_submerchant_key:
            try:
                update_payload = build_submerchant_update_payload(
                    business,
                    conversation_id=_conversation_id(business=business, stage="UPDATE", correlation_id=correlation_id),
                )
                return self.update_submerchant(payload=update_payload, correlation_id=correlation_id)
            except IyzicoAPIError as exc:
                if exc.code != "2001":
                    if exc.retryable:
                        return self._reconcile_submerchant_after_ambiguous_update(
                            business=business,
                            exc=exc,
                            correlation_id=correlation_id,
                        )
                    return self._reconcile_existing_submerchant_after_update_failure(
                        business=business,
                        exc=exc,
                        correlation_id=correlation_id,
                    )
                has_previous_provider_history = bool(business.iyzico_last_synced_at or business.iyzico_last_response)
                if has_previous_provider_history:
                    raise IyzicoAPIError(
                        message="iyzico.submerchant.stale_key_requires_manual_review",
                        code=exc.code,
                        http_status=exc.http_status,
                        raw={"update_error": exc.raw, "submerchant_key": business.iyzico_submerchant_key},
                        retryable=True,
                    )
                business.iyzico_submerchant_key = ""
                return self._create_with_reconciliation(business=business, correlation_id=correlation_id)
        return self._create_with_reconciliation(business=business, correlation_id=correlation_id)

    def update_payment_item_submerchant_amount(self, *, payment_transaction_id: str, submerchant_price: int, submerchant_key: str) -> bool:
        if not payment_transaction_id:
            raise ValidationError("iyzico.payment_item.payment_transaction_id_required")
        if not submerchant_key:
            raise ValidationError("iyzico.payment_item.submerchant_key_required")
        if submerchant_price < 0:
            raise ValidationError("iyzico.payment_item.submerchant_price_invalid")

        payload = {
            "locale": "tr",
            "conversationId": f"HY-ITEM-{payment_transaction_id}",
            "paymentTransactionId": str(payment_transaction_id),
            "subMerchantKey": str(submerchant_key),
            "subMerchantPrice": _price_str(submerchant_price),
        }
        self._request_json_with_retry(
            method="PUT",
            path=self.payment_item_update_path,
            payload=payload,
            correlation_id=f"HY-PAYMENT-ITEM-{payment_transaction_id}",
        )
        return True


def _extract_provider_submerchant_status(data: Mapping[str, Any] | None) -> str:
    return _extract_first_text(
        data,
        keys=("subMerchantStatus", "submerchantStatus", "statusDetail", "merchantStatus"),
    ).upper()


def _extract_provider_submerchant_key(data: Mapping[str, Any] | None) -> str:
    return _extract_first_text(
        data,
        keys=("subMerchantKey", "submerchantKey"),
    )


def _extract_first_text(data: Mapping[str, Any] | None, *, keys: tuple[str, ...]) -> str:
    if not isinstance(data, Mapping):
        return ""

    normalized_keys = {str(key).strip().lower() for key in keys}
    stack: list[Any] = [data]
    visited_ids: set[int] = set()

    while stack:
        current = stack.pop()
        if not isinstance(current, Mapping):
            continue
        current_id = id(current)
        if current_id in visited_ids:
            continue
        visited_ids.add(current_id)

        for raw_key, value in current.items():
            key = _clean(raw_key).lower()
            if key in normalized_keys:
                text = _clean(value)
                if text:
                    return text

        for value in current.values():
            if isinstance(value, Mapping):
                stack.append(value)
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, Mapping):
                        stack.append(item)

    return ""


def _is_business_validation_failure(exc: IyzicoAPIError) -> bool:
    code = _clean(exc.code)
    message = _clean(exc.message).lower()

    if exc.http_status in {401, 403, 429}:
        return False
    if code in {"NETWORK_TIMEOUT", "NETWORK_ERROR", "INVALID_JSON"}:
        return False
    if code in NON_REJECTABLE_PROVIDER_ERROR_CODES:
        return False

    if exc.http_status in {400, 422}:
        if code:
            return code.startswith("2")
        validation_tokens = (
            "mandatory",
            "invalid",
            "validation",
            "required",
            "iban",
            "identity",
            "tax",
        )
        return any(token in message for token in validation_tokens)

    return False


def _map_provider_status_to_local(provider_status: str) -> str:
    normalized = _clean(provider_status).upper()
    if normalized in ACTIVE_PROVIDER_STATUSES:
        return "ACTIVE"
    if normalized in PENDING_PROVIDER_STATUSES:
        return "PENDING"
    if normalized in REJECTED_PROVIDER_STATUSES:
        return "REJECTED"
    if normalized:
        return "NEEDS_REVIEW"
    return "NEEDS_REVIEW"


def _save_provider_snapshot(*, business, raw: Mapping[str, Any] | None, error: str = ""):
    business.iyzico_last_response = dict(raw or {})
    business.iyzico_last_error = error
    business.iyzico_last_synced_at = timezone.now()


def _mark_business_state(*, business, provider_status: str = "", submerchant_key: str = "", raw: Mapping[str, Any] | None = None, error: str = ""):
    local_status = _map_provider_status_to_local(provider_status)
    if error and local_status == "PENDING":
        local_status = "NEEDS_REVIEW"
    if (
        not provider_status
        and not error
        and business.iyzico_submerchant_status == business.IyziSubmerchantStatus.ACTIVE
        and (submerchant_key or business.iyzico_submerchant_key)
    ):
        local_status = business.IyziSubmerchantStatus.ACTIVE

    if submerchant_key:
        business.iyzico_submerchant_key = submerchant_key
    _save_provider_snapshot(business=business, raw=raw, error=error)
    business.iyzico_submerchant_status = local_status
    business.save(
        update_fields=[
            "iyzico_submerchant_key",
            "iyzico_last_response",
            "iyzico_last_error",
            "iyzico_last_synced_at",
            "iyzico_submerchant_status",
        ]
    )
    return business


def _mark_needs_review(*, business, error: str, raw: Mapping[str, Any] | None = None):
    _save_provider_snapshot(business=business, raw=raw, error=error)
    business.iyzico_submerchant_status = business.IyziSubmerchantStatus.NEEDS_REVIEW
    business.save(update_fields=["iyzico_last_response", "iyzico_last_error", "iyzico_last_synced_at", "iyzico_submerchant_status"])
    return business


def _notify_business_submerchant_active(*, business):
    for user in get_business_finance_notification_users(business):
        NotificationService.enqueue(
            user=user,
            type=Notification.Type.SYSTEM_BROADCAST,
            title="İşletme hesabın aktif edildi",
            body="Marketplace ödeme altyapın kullanıma hazır.",
            payload={"business_id": business.id},
            dedupe_key=f"submerchant_active:{business.id}",
        )


def onboard_submerchant(*, business):
    correlation_id = str(uuid.uuid4())
    try:
        client = IyzicoMarketplaceClient()
        result = client.create_or_update_submerchant(business=business, correlation_id=correlation_id)
    except ValidationError as exc:
        return _mark_needs_review(
            business=business,
            error=str(exc),
            raw={"error": str(exc), "stage": "validation", "correlation_id": correlation_id},
        )
    except IyzicoAPIError as exc:
        error_raw = {
            "error": exc.message,
            "error_code": exc.code,
            "http_status": exc.http_status,
            "retryable": exc.retryable,
            "provider_raw": exc.raw,
            "correlation_id": correlation_id,
        }
        if exc.retryable or exc.http_status >= 500:
            return _mark_needs_review(business=business, error=exc.message, raw=error_raw)
        if _is_business_validation_failure(exc):
            return _mark_business_state(business=business, provider_status="REJECTED", raw=error_raw, error=exc.message)
        return _mark_needs_review(business=business, error=exc.message, raw=error_raw)

    submerchant_key = result.submerchant_key
    provider_status = result.provider_status
    combined_raw: dict[str, Any] = dict(result.raw or {})

    try:
        detail = client.retrieve_submerchant(business=business, correlation_id=correlation_id)
        if detail.submerchant_key:
            submerchant_key = detail.submerchant_key
        if detail.provider_status:
            provider_status = detail.provider_status
        combined_raw["detail"] = detail.raw or {}
    except IyzicoAPIError as exc:
        combined_raw["detail_error"] = {
            "error": exc.message,
            "error_code": exc.code,
            "http_status": exc.http_status,
            "retryable": exc.retryable,
            "provider_raw": exc.raw,
            "correlation_id": correlation_id,
        }
        return _mark_needs_review(business=business, error=exc.message, raw=combined_raw)
    except ValidationError as exc:
        combined_raw["detail_error"] = {"message": str(exc), "correlation_id": correlation_id}
        return _mark_needs_review(business=business, error=str(exc), raw=combined_raw)

    combined_raw.setdefault("meta", {})
    combined_raw["meta"]["correlation_id"] = correlation_id

    if not submerchant_key:
        return _mark_needs_review(
            business=business,
            error="iyzico.submerchant.missing_key_after_successful_response",
            raw=combined_raw,
        )

    business = _mark_business_state(
        business=business,
        provider_status=provider_status,
        submerchant_key=submerchant_key,
        raw=combined_raw,
        error="",
    )
    if business.iyzico_submerchant_status == business.IyziSubmerchantStatus.ACTIVE:
        _notify_business_submerchant_active(business=business)
    return business
