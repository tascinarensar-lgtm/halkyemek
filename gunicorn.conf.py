from __future__ import annotations

import multiprocessing
import os


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _default_workers() -> int:
    return max(2, multiprocessing.cpu_count() * 2 + 1)


bind = os.getenv("GUNICORN_BIND", "0.0.0.0:8000")
workers = _env_int("GUNICORN_WORKERS", _default_workers())
threads = _env_int("GUNICORN_THREADS", 1)
timeout = _env_int("GUNICORN_TIMEOUT", 60)
graceful_timeout = _env_int("GUNICORN_GRACEFUL_TIMEOUT", 30)
keepalive = _env_int("GUNICORN_KEEPALIVE", 5)
max_requests = _env_int("GUNICORN_MAX_REQUESTS", 1000)
max_requests_jitter = _env_int("GUNICORN_MAX_REQUESTS_JITTER", 100)
accesslog = "-"
errorlog = "-"
capture_output = True
worker_tmp_dir = os.getenv("GUNICORN_WORKER_TMP_DIR", "/dev/shm")
forwarded_allow_ips = os.getenv("GUNICORN_FORWARDED_ALLOW_IPS", "127.0.0.1")
