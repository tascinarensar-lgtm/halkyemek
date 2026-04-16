from __future__ import annotations

from collections.abc import Iterable, Mapping
from urllib.parse import urlencode, urljoin, urlparse

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


def _validate_absolute_base_url(*, base_url: str, setting_name: str) -> str:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"https", "http"}:
        raise ImproperlyConfigured(f"{setting_name} must start with http:// or https://")
    if not parsed.netloc:
        raise ImproperlyConfigured(f"{setting_name} must include host")
    return base_url


def _append_query_params(url: str, query_params: Mapping[str, object | Iterable[object] | None] | None) -> str:
    if not query_params:
        return url

    pairs: list[tuple[str, str]] = []
    for key, value in query_params.items():
        if value is None:
            continue
        if isinstance(value, Iterable) and not isinstance(value, (str, bytes, bytearray)):
            for item in value:
                if item is not None:
                    pairs.append((str(key), str(item)))
            continue
        pairs.append((str(key), str(value)))

    if not pairs:
        return url

    return f"{url}?{urlencode(pairs, doseq=True)}"


def build_external_absolute_url(*, request, path: str) -> str:
    canonical_base = str(getattr(settings, "CANONICAL_API_BASE_URL", "") or "").strip()
    normalized_path = "/" + str(path or "").lstrip("/")

    if canonical_base:
        _validate_absolute_base_url(base_url=canonical_base, setting_name="CANONICAL_API_BASE_URL")
        return urljoin(canonical_base.rstrip("/") + "/", normalized_path.lstrip("/"))

    return request.build_absolute_uri(normalized_path)


def build_frontend_absolute_url(*, path: str, query_params: Mapping[str, object | Iterable[object] | None] | None = None) -> str:
    frontend_base = str(getattr(settings, "FRONTEND_APP_URL", "") or "").strip()
    normalized_path = "/" + str(path or "").lstrip("/")

    if not frontend_base and getattr(settings, "DEBUG", False):
        frontend_base = "http://localhost:3000"

    if not frontend_base:
        raise ImproperlyConfigured("FRONTEND_APP_URL must be configured")

    _validate_absolute_base_url(base_url=frontend_base, setting_name="FRONTEND_APP_URL")
    absolute_url = urljoin(frontend_base.rstrip("/") + "/", normalized_path.lstrip("/"))
    return _append_query_params(absolute_url, query_params)
