from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from django.apps import apps
from django.conf import settings
from django.core.files.storage import default_storage
from django.utils import timezone

from common.urls import build_external_absolute_url


@dataclass(frozen=True)
class StoredMediaFile:
    file_path: str
    absolute_url: str
    metadata: dict[str, Any]


def normalize_uploaded_extension(*, original_name: str, content_type: str | None = None) -> str:
    extension = Path(original_name or "").suffix.lower()
    if extension:
        return extension

    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";", 1)[0].strip()) or ""
        return guessed.lower()

    return ""


def save_business_uploaded_media_file(*, request, business_id: int, uploaded_file) -> StoredMediaFile:
    extension = normalize_uploaded_extension(
        original_name=getattr(uploaded_file, "name", ""),
        content_type=getattr(uploaded_file, "content_type", None),
    )
    now = timezone.now()
    relative_path = (
        PurePosixPath("business-media")
        / str(business_id)
        / now.strftime("%Y")
        / now.strftime("%m")
        / f"{uuid4().hex}{extension}"
    )
    stored_name = default_storage.save(str(relative_path), uploaded_file)
    public_path = str(default_storage.url(stored_name))
    absolute_url = build_external_absolute_url(request=request, path=public_path)

    return StoredMediaFile(
        file_path=stored_name,
        absolute_url=absolute_url,
        metadata={
            "original_file_name": getattr(uploaded_file, "name", ""),
            "content_type": getattr(uploaded_file, "content_type", ""),
            "file_size_bytes": int(getattr(uploaded_file, "size", 0) or 0),
            "storage": "default",
        },
    )


def delete_stored_media_file_if_unused(*, file_path: str, excluding_asset_id: int | None = None) -> None:
    normalized_path = str(file_path or "").strip()
    if not normalized_path:
        return

    MediaAsset = apps.get_model("menus", "MediaAsset")
    qs = MediaAsset.objects.filter(file_path=normalized_path)
    if excluding_asset_id is not None:
        qs = qs.exclude(id=excluding_asset_id)
    if qs.exists():
        return

    try:
        if default_storage.exists(normalized_path):
            default_storage.delete(normalized_path)
    except OSError:
        return


def build_media_public_url(*, file_path: str) -> str:
    normalized = str(file_path or "").strip()
    if not normalized:
        return ""
    if normalized.startswith(("http://", "https://")):
        return normalized

    relative_url = str(default_storage.url(normalized))
    canonical_base = str(getattr(settings, "CANONICAL_API_BASE_URL", "") or "").strip()
    if not canonical_base and getattr(settings, "DEBUG", False):
        canonical_base = "http://127.0.0.1:8000"

    if canonical_base:
        return canonical_base.rstrip("/") + "/" + relative_url.lstrip("/")

    return relative_url
