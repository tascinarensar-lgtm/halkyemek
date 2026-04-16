from __future__ import annotations

import socket

from django.core.management.base import CommandError
from django.core.management import call_command

from common.celery_compat import shared_task
from health.services import JobHeartbeatService


class NonRetryableTaskError(Exception):
    pass


def normalize_positive_int(
    value,
    *,
    default: int,
    minimum: int = 1,
    maximum: int | None = None,
) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        normalized = int(default)
    normalized = max(normalized, int(minimum))
    if maximum is not None:
        normalized = min(normalized, int(maximum))
    return normalized


def task_worker_name(task, *, queue: str, fallback: str = "celery") -> str:
    request = getattr(task, "request", None)
    hostname = str(getattr(request, "hostname", "") or fallback).strip() or fallback
    task_id = str(getattr(request, "id", "") or "").strip()
    if task_id:
        return f"{hostname}:{queue}:{task_id[:12]}"
    return f"{hostname}:{queue}"


def run_management_command(*, task, command_name: str, queue: str, args: tuple | None = None, **kwargs):
    command_args = tuple(args or ())
    worker = str(kwargs.pop("worker", "") or "").strip() or task_worker_name(task, queue=queue)
    try:
        call_command(command_name, *command_args, worker=worker, **kwargs)
    except CommandError as exc:
        raise NonRetryableTaskError(f"command={command_name} error={exc}") from exc
    except SystemExit as exc:
        exit_code = exc.code
        if exit_code in {None, 0}:
            return worker
        raise NonRetryableTaskError(
            f"command={command_name} exited with code={exit_code}"
        ) from exc
    return worker


@shared_task(
    bind=True,
    autoretry_for=(Exception,),
    dont_autoretry_for=(NonRetryableTaskError, SystemExit),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=3,
)
def run_management_command_task(self, command_name: str, *args, **kwargs):
    worker = run_management_command(task=self, command_name=command_name, queue="default", args=args, **kwargs)
    return {"command": command_name, "args": args, "kwargs": kwargs, "worker": worker}


@shared_task(bind=True, queue="ops")
def record_scheduler_heartbeat_task(self):
    worker = task_worker_name(self, queue="ops", fallback=socket.gethostname())
    JobHeartbeatService.scheduler_heartbeat(worker=worker, source="celery-beat")
    return {"job": "celery_beat_scheduler", "worker": worker}
