from __future__ import annotations

from logs.models import SystemLog


def write_audit_log(*, actor, action: str, target: str, payload: dict | None = None):
    SystemLog.objects.create(
        level="INFO",
        source="AUDIT",
        message=action,
        context={
            "actor_id": getattr(actor, "id", None),
            "actor_role": getattr(actor, "role", None),
            "target": target,
            "payload": payload or {},
        },
    )