from __future__ import annotations

from contextvars import ContextVar
from typing import Optional

_request_id: ContextVar[str] = ContextVar("request_id", default="")
_request_path: ContextVar[str] = ContextVar("request_path", default="")
_request_method: ContextVar[str] = ContextVar("request_method", default="")
_user_id: ContextVar[str] = ContextVar("user_id", default="")


def set_request_context(*, request_id: str = "", path: str = "", method: str = "", user_id: str = "") -> None:
    _request_id.set(request_id)
    _request_path.set(path)
    _request_method.set(method)
    _user_id.set(user_id)


def clear_request_context() -> None:
    set_request_context()


def get_request_id() -> str:
    return _request_id.get()


def get_request_path() -> str:
    return _request_path.get()


def get_request_method() -> str:
    return _request_method.get()


def get_user_id() -> str:
    return _user_id.get()
