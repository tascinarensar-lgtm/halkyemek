#hatayı kayıt altına al
from __future__ import annotations

import logging
import uuid

from rest_framework.views import exception_handler #drf hata yakalayıcısı
from rest_framework.exceptions import Throttled, PermissionDenied, ValidationError, AuthenticationFailed #hatalar
"""Throttled: rate limit aşıldı (429)
PermissionDenied: yetki yok (403)
AuthenticationFailed: token/login hatası (401)
ValidationError: veri hatalı (400)"""
from rest_framework import status
from logs.services import create_audit_log #kendi yazdığımızlog kayıt servisimizi ekledik.


logger = logging.getLogger(__name__)

def custom_exception_handler(exc, context): #view içinde ne zaman hata olursa bunu çalıştıracağız. (settingte ayarını yap) exc: patlayan hata (exception objesi  context: DRF’in verdiği bağlam; içinde genelde request, view gibi bilgiler olur.
    request = context.get("request") # Context sözlüğünden request’i alır.
    response = exception_handler(exc, context) #DRF’in normal hata üretme mekanizmasını çalıştırır.
    status_code = response.status_code if response is not None else status.HTTP_500_INTERNAL_SERVER_ERROR #DRF response ürettiyse: onun status_code’unu al. DRF response üretemediyse (None): bunu 500 kabul et.
    user = getattr(request, "user", None) if request else None #Request varsa: request.user al. Request yoksa: user = None.
    user_for_log = user if getattr(user, "is_authenticated", False) else None
    audit_actions = (Throttled, PermissionDenied, AuthenticationFailed, ValidationError) # hata türlerimizi aldık.

    try: #Aşağıdaki loglama kodunun kendisi hata üretirse API’yi bozmasın diye “kalkan” açıyorsun.
        if request and isinstance(exc, audit_actions): #istek var mı bir de gelen hata benmim belirlediğim hatalardan biri mi? eğer öyleyse
            create_audit_log(
                request=request,
                user=user_for_log,
                action="API_ERROR",
                description=exc.__class__.__name__,
                status_code=status_code,
                meta={
                    "detail": str(exc)[:500],
                    "path": request.path,
                    "method": request.method,
                },
            )
    except Exception:
        logger.warning("audit_log_failed_in_exception_handler", exc_info=True)

    # ---- TESTLER İÇİN UNIFORM ERROR RESPONSE ----
    if response is not None:
        data = response.data

        # Mesajı normalize et
        if isinstance(data, dict) and "detail" in data:
            message = data.get("detail")
        else:
            message = data

        error_code = exc.__class__.__name__
        extra_details = None
        if isinstance(exc, PermissionDenied) and request is not None:
            readiness = getattr(request, "notification_readiness_status", None)
            if readiness is not None and not getattr(readiness, "notification_ready", True):
                error_code = "NOTIFICATION_NOT_READY"
                message = getattr(readiness, "message", message)
                extra_details = readiness.as_dict()

        response.data = {
            "ok": False,
            "error": {
                "code": error_code,
                "message": message,
                "request_id": getattr(request, "request_id", "") if request else str(uuid.uuid4()),
            },
        }
        if extra_details is not None:
            response.data["error"]["details"] = extra_details

    return response
