from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from threading import Event, Thread
from uuid import uuid4

from django.core.cache import cache


_REDIS_REFRESH_SCRIPT = None
_REDIS_RELEASE_SCRIPT = None


@dataclass(frozen=True)
class JobLock:
    key: str
    token: str
    acquired: bool


def _lock_key(name: str) -> str:
    return f"job-lock:{name}"


def build_job_lock_token(*, worker: str) -> str:
    worker = str(worker or "worker").strip() or "worker"
    return f"{worker}:{uuid4().hex}"


def acquire_job_lock(*, name: str, token: str, ttl_seconds: int) -> JobLock:
    key = _lock_key(name)
    acquired = bool(cache.add(key, token, timeout=max(int(ttl_seconds), 1)))
    return JobLock(key=key, token=token, acquired=acquired)


def release_job_lock(lock: JobLock) -> None:
    if not lock.acquired:
        return
    cache_backend = getattr(cache, "_cache", None)
    backend_name = f"{cache_backend.__class__.__module__}.{cache_backend.__class__.__name__}" if cache_backend is not None else ""

    if "locmem" in backend_name.lower():
        current = cache.get(lock.key)
        if current == lock.token:
            cache.delete(lock.key)
        return

    client_getter = getattr(cache_backend, "get_client", None)
    if callable(client_getter):
        client = client_getter(write=True)
        register_script = getattr(client, "register_script", None)
        if callable(register_script):
            global _REDIS_RELEASE_SCRIPT
            if _REDIS_RELEASE_SCRIPT is None:
                _REDIS_RELEASE_SCRIPT = register_script(
                    "if redis.call('GET', KEYS[1]) == ARGV[1] then "
                    "return redis.call('DEL', KEYS[1]) "
                    "else return 0 end"
                )
            cache_key = cache.make_key(lock.key)
            script = _REDIS_RELEASE_SCRIPT
            if callable(script):
                script(keys=[cache_key], args=[lock.token])
                return

    current = cache.get(lock.key)
    if current == lock.token:
        cache.delete(lock.key)


def refresh_job_lock(lock: JobLock, *, ttl_seconds: int) -> bool:
    if not lock.acquired:
        return False
    ttl_seconds = max(int(ttl_seconds), 1)
    cache_backend = getattr(cache, "_cache", None)
    backend_name = f"{cache_backend.__class__.__module__}.{cache_backend.__class__.__name__}" if cache_backend is not None else ""

    if "locmem" in backend_name.lower():
        current = cache.get(lock.key)
        if current != lock.token:
            return False
        cache.set(lock.key, lock.token, timeout=ttl_seconds)
        return True

    client_getter = getattr(cache_backend, "get_client", None)
    if callable(client_getter):
        client = client_getter(write=True)
        register_script = getattr(client, "register_script", None)
        if callable(register_script):
            global _REDIS_REFRESH_SCRIPT
            if _REDIS_REFRESH_SCRIPT is None:
                _REDIS_REFRESH_SCRIPT = register_script(
                    "if redis.call('GET', KEYS[1]) == ARGV[1] then "
                    "return redis.call('EXPIRE', KEYS[1], ARGV[2]) "
                    "else return 0 end"
                )
            cache_key = cache.make_key(lock.key)
            script = _REDIS_REFRESH_SCRIPT
            if callable(script):
                return bool(script(keys=[cache_key], args=[lock.token, ttl_seconds]))

    return False


def _refresh_interval_seconds(ttl_seconds: int) -> float:
    ttl_seconds = max(int(ttl_seconds), 1)
    return max(min(ttl_seconds / 3.0, 30.0), 1.0)


def _start_job_lock_refresh(lock: JobLock, *, ttl_seconds: int):
    stop_event = Event()

    def _runner() -> None:
        interval = _refresh_interval_seconds(ttl_seconds)
        while not stop_event.wait(interval):
            if not refresh_job_lock(lock, ttl_seconds=ttl_seconds):
                break

    thread = Thread(target=_runner, name=f"job-lock-refresh:{lock.key}", daemon=True)
    thread.start()
    return stop_event, thread


@contextmanager
def job_lock(*, name: str, token: str, ttl_seconds: int):
    lock = acquire_job_lock(name=name, token=token, ttl_seconds=ttl_seconds)
    stop_event = None
    refresh_thread = None
    if lock.acquired:
        stop_event, refresh_thread = _start_job_lock_refresh(lock, ttl_seconds=ttl_seconds)
    try:
        yield lock
    finally:
        if stop_event is not None:
            stop_event.set()
        if refresh_thread is not None:
            refresh_thread.join(timeout=1)
        release_job_lock(lock)
