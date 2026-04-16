from __future__ import annotations

import ipaddress


def normalize_ip(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        return ""


def ip_in_allowlist(ip: str, allowlist: list[str]) -> bool:
    normalized_ip = normalize_ip(ip)
    if not normalized_ip:
        return False

    target = ipaddress.ip_address(normalized_ip)
    for raw_entry in allowlist:
        entry = str(raw_entry or "").strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                if target in ipaddress.ip_network(entry, strict=False):
                    return True
                continue
            if target == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue
    return False


def invalid_allowlist_entries(allowlist: list[str]) -> list[str]:
    invalid: list[str] = []
    for raw_entry in allowlist:
        entry = str(raw_entry or "").strip()
        if not entry:
            continue
        try:
            if "/" in entry:
                ipaddress.ip_network(entry, strict=False)
            else:
                ipaddress.ip_address(entry)
        except ValueError:
            invalid.append(entry)
    return invalid
