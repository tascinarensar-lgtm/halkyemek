from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

try:
    from celery import shared_task as celery_shared_task
except ModuleNotFoundError as exc:  # pragma: no cover - optional dependency in local test env
    if exc.name != "celery":
        raise
    celery_shared_task = None


def _build_fallback_task(*, name: str):
    request = SimpleNamespace(hostname="local-test", id=f"local-{uuid4().hex}")
    return SimpleNamespace(name=name, request=request)


class FallbackTaskWrapper:
    def __init__(self, func, *, bind: bool, task_name: str):
        self._func = func
        self._bind = bind
        self.__name__ = getattr(func, "__name__", "task")
        self.__doc__ = getattr(func, "__doc__", None)
        self.name = task_name

    def __call__(self, *args, **kwargs):
        if self._bind:
            return self._func(_build_fallback_task(name=self.name), *args, **kwargs)
        return self._func(*args, **kwargs)

    def delay(self, *args, **kwargs):
        return self(*args, **kwargs)


def shared_task(*decorator_args, **decorator_kwargs):
    if celery_shared_task is not None:
        return celery_shared_task(*decorator_args, **decorator_kwargs)

    bind = bool(decorator_kwargs.get("bind", False))

    def _decorate(func):
        task_name = decorator_kwargs.get("name") or getattr(func, "__name__", "task")
        return FallbackTaskWrapper(func, bind=bind, task_name=task_name)

    if decorator_args and callable(decorator_args[0]) and len(decorator_args) == 1 and not decorator_kwargs:
        return _decorate(decorator_args[0])
    return _decorate
