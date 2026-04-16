try:
    from .celery import app as celery_app
except Exception:  # pragma: no cover - optional until celery package is installed
    celery_app = None

__all__ = ("celery_app",)
