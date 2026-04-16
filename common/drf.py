from __future__ import annotations

from rest_framework.exceptions import UnsupportedMediaType

"""Bu kod Django REST Framework (DRF) tabanlı bir API’de sadece JSON formatında request kabul edilmesini zorunlu kılan bir kontrol fonksiyonudur.
"""
def enforce_json_content_type(request):
    if request.method in {"POST", "PUT", "PATCH"}:
        content_type = request.content_type or ""
        if "application/json" not in content_type:
            raise UnsupportedMediaType(content_type)