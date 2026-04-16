import os


def _resolve_env() -> str:
    raw = (os.getenv("DJANGO_ENV") or os.getenv("APP_ENV") or "dev").lower().strip()
    aliases = {
        "production": "prod",
        "live": "prod",
        "stage": "staging",
    }
    normalized = aliases.get(raw, raw)
    if normalized in {"dev", "staging", "prod"}:
        return normalized
    raise RuntimeError(
        f"Unsupported environment '{raw}'. Use one of: dev, staging, prod."
    )


env = _resolve_env()

if env == "prod":
    from .prod import *  # noqa
elif env == "staging":
    from .staging import *  # noqa
else:
    from .dev import *  # noqa
