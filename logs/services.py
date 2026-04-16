from __future__ import annotations

from typing import Any, Optional

from .models import SystemLog
from .utils import get_client_ip


def create_log(*, user=None, action, description, ip_address=None):
    SystemLog.objects.create(
        user=user,
        action=action,
        description=description,
        ip_address=ip_address or "",
    )


def create_audit_log(
    *,
    request,
    user,
    action: str,
    description: str,
    status_code: int | None = None,
    meta: Optional[dict[str, Any]] = None,
):
    SystemLog.objects.create(
        user=user,
        action=action,
        description=description,
        request_id=getattr(request, "request_id", "") or "",
        ip_address=get_client_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", "") or "",
        path=request.path or "",
        method=request.method or "",
        status_code=status_code,
        meta=meta or {},
    )
