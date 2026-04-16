from __future__ import annotations
from typing import Any
from rest_framework.response import Response


def ok(data: Any = None, *, status: int = 200) -> Response:
    return Response({"ok": True, "data": data}, status=status)


def error(code: str, message: Any, *, status: int, request=None, details: Any = None, **extra: Any) -> Response:
    payload = {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "request_id": getattr(request, "request_id", "") if request is not None else "",
        },
    }
    if details is not None:
        payload["error"]["details"] = details
    if extra:
        payload["error"].update(extra)
    return Response(payload, status=status)
