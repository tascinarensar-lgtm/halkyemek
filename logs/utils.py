from __future__ import annotations

from django.conf import settings

from common.network import ip_in_allowlist, normalize_ip


def _can_trust_forwarded_headers(request) -> bool:
    if not bool(getattr(settings, "TRUST_X_FORWARDED_FOR", False)):
        return False

    trusted_proxy_ips = list(getattr(settings, "TRUSTED_PROXY_IPS", []) or [])
    remote_addr = normalize_ip(request.META.get("REMOTE_ADDR", "") or "")

    if not trusted_proxy_ips:
        return bool(getattr(settings, "DEBUG", False) or getattr(settings, "TESTING", False))
    if not remote_addr:
        return False
    return ip_in_allowlist(remote_addr, trusted_proxy_ips)


def _ip_from_forwarded_chain(request) -> str:
    trusted_proxy_ips = list(getattr(settings, "TRUSTED_PROXY_IPS", []) or [])
    xff = str(request.META.get("HTTP_X_FORWARDED_FOR", "") or "").strip()
    hops: list[str] = []

    if xff:
        hops.extend(normalize_ip(part.strip()) for part in xff.split(","))

    remote_addr = normalize_ip(request.META.get("REMOTE_ADDR", "") or "")
    if remote_addr:
        hops.append(remote_addr)

    for hop in reversed([value for value in hops if value]):
        if not ip_in_allowlist(hop, trusted_proxy_ips):
            return hop
    return hops[0] if hops else ""


def get_client_ip(request) -> str:
    if _can_trust_forwarded_headers(request):
        xff_ip = _ip_from_forwarded_chain(request)
        if xff_ip:
            return xff_ip

        xri = request.META.get("HTTP_X_REAL_IP")
        if xri:
            candidate = normalize_ip(xri.strip())
            if candidate:
                return candidate

    return normalize_ip(request.META.get("REMOTE_ADDR", "") or "")
