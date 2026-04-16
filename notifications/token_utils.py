from __future__ import annotations


def is_demo_fcm_token(token: str | None) -> bool:
    return str(token or "").strip().lower().startswith("demo-")
