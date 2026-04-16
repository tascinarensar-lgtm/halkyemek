from __future__ import annotations

import logging
import time
import uuid

from django.conf import settings
from django.db import connection
from django.http import JsonResponse

from common.request_context import clear_request_context, set_request_context


access_logger = logging.getLogger("http.access")


class QueryCountMiddleware:
    """
    DEBUG açıkken request başına query sayısını gözlemlemek için.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not settings.DEBUG:
            return self.get_response(request)

        start = len(connection.queries)
        response = self.get_response(request)
        end = len(connection.queries)

        total = end - start
        if total > 50:
            access_logger.warning(
                "request.high_query_count",
                extra={
                    "request_id": getattr(request, "request_id", ""),
                    "request_path": request.path or "",
                    "request_method": request.method or "",
                    "status_code": getattr(response, "status_code", 0),
                    "query_count": total,
                },
            )

        return response


class RequestIdMiddleware:
    """
    Her HTTP request'e benzersiz request_id atar ve log context'ine koyar.
    """

    HEADER_IN = "HTTP_X_REQUEST_ID"
    HEADER_OUT = "X-Request-ID"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        rid = request.META.get(self.HEADER_IN) or uuid.uuid4().hex
        request.request_id = rid
        user = getattr(request, "user", None)
        user_id = ""
        if getattr(user, "is_authenticated", False):
            user_id = str(user.pk)

        set_request_context(
            request_id=rid,
            path=request.path or "",
            method=request.method or "",
            user_id=user_id,
        )
        try:
            response = self.get_response(request)
        finally:
            clear_request_context()

        response[self.HEADER_OUT] = rid
        return response


class RequestLoggingMiddleware:
    """
    Her request sonunda status/duration içeren structured access log üretir.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = time.monotonic()
        response = self.get_response(request)
        duration_ms = round((time.monotonic() - started) * 1000, 2)
        user = getattr(request, "user", None)
        user_id = str(user.pk) if getattr(user, "is_authenticated", False) else ""
        access_logger.info(
            "request.complete",
            extra={
                "request_id": getattr(request, "request_id", ""),
                "request_path": request.path or "",
                "request_method": request.method or "",
                "user_id": user_id,
                "status_code": getattr(response, "status_code", 0),
                "duration_ms": duration_ms,
            },
        )
        return response


class BodySizeLimitMiddleware:
    """Kullanıcı çok büyük veri gönderirse erkenden engeller."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.max_bytes = int(getattr(settings, "MAX_REQUEST_BODY_BYTES", 1024 * 1024))

    def __call__(self, request):
        content_length = request.META.get("CONTENT_LENGTH")
        if content_length:
            try:
                if int(content_length) > self.max_bytes:
                    return JsonResponse(
                        {"detail": "Request body too large."},
                        status=413,
                    )
            except ValueError:
                pass
        return self.get_response(request)
