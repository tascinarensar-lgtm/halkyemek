from __future__ import annotations

import logging

from common.request_context import (
    get_request_id,
    get_request_method,
    get_request_path,
    get_user_id,
)


class RequestIDLogFilter(logging.Filter):
    def filter(self, record):
        record.request_id = getattr(record, "request_id", "") or get_request_id()
        record.request_path = getattr(record, "request_path", "") or get_request_path()
        record.request_method = getattr(record, "request_method", "") or get_request_method()
        record.user_id = getattr(record, "user_id", "") or get_user_id()
        return True
