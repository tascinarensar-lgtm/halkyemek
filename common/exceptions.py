from __future__ import annotations

from typing import Any, Dict
from rest_framework.views import exception_handler as drf_exception_handler #drf deki hatalrın hepsi buradan geçer
from rest_framework import status
from rest_framework.exceptions import (
ValidationError, Throttled, PermissionDenied, AuthenticationFailed, NotAuthenticated
)
from logs.services import create_audit_log

def _get_request_id(request) -> str: #gelen istekten id sini çekmek
    return getattr(request, "request_id", "") or ""

def _build_error(*, request, code: str, message: str, details: Any = None) -> Dict[str, Any]: #hatalrı yakalayacak fonksiyon hatalrı tek bir methodda toplayıp tek bir responce üretmek için.
        return {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "request_id": _get_request_id(request),
        },
    }

def custom_exception_handler(exc, context): #Uygulamada fırlayan HER hatayıkayda almak (audit/log), sistemin çökmemesini sağlamak rontend’e tek tip JSON formatında döndürmek, exc: patlatan hata context: DRF’in verdiği bağlam; içinde genelde request, view gibi bilgiler olur.
    request = context.get("request")
    response = drf_exception_handler(exc, context) #drf nin kendi hata motoruna parametre verip bu hatayı tanıyorsan al ve response nin içine at  diyrouz
      
    if response is None:
        if request:
            try:
                create_audit_log( #amaç: hata olduğunda bir “audit/log kaydı” oluşturmak
                    request=request,
                    user=request.user if getattr(request.user, "is_authenticated", False) else None,
                    action="API_ERROR",
                    description="UnhandledException",
                    status_code=500,
                    meta={"detail": str(exc)[:500]},
                )
            except Exception:
                pass

        data = _build_error( #(eğer request yoksa) hatalları alıp data ya aktardık 
                request=request,
                code="INTERNAL_ERROR",
                message="Beklenmeyen bir hata oluştu.",
                details=None,
        )        
        from rest_framework.response import Response #bu satır sadece hata varsa çalışacağı için en üstte yazmak yerine buraya yazdık http cevabu için respınse kullanıyoruz
        return Response(data, status=status.HTTP_500_INTERNAL_SERVER_ERROR) #hatamızı sayfaya response ettik ve stattus ile 500 kodunu verdik.
    
    if isinstance(exc, ValidationError): #yakalanaan hata (exc) validation hatası mı?
        response.data = _build_error( #response deki datamızı kendimizce belirleyip güncelliyoruz. bunu da yine kendi yazım kolaylaığı olsun diye oluşturduğumuz _build_error fonksiyonu ile yapıyoruz.
            request=request,
            code="VALIDATION_ERROR",
            message="Geçersiz istek.",
            details=response.data,
        )
    elif isinstance(exc, (NotAuthenticated, AuthenticationFailed)): #exc  (NotAuthenticated, AuthenticationFailed) bu ikisinden biri mi
        response.data = _build_error(
            request=request,
            code="AUTH_ERROR",
            message="Kimlik doğrulama gerekli veya başarısız.",
            details=response.data,
        )
    elif isinstance(exc, PermissionDenied):
        response.data = _build_error(
            request=request,
            code="PERMISSION_DENIED",
            message="Bu işlem için yetkiniz yok.",
            details=response.data,
        )
    elif isinstance(exc, Throttled):
        response.data = _build_error(
            request=request,
            code="RATE_LIMITED",
            message="Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin.",
            details={"wait": getattr(exc, "wait", None)},
        )
    else:
        # diğer DRF hataları: 404 vb
        response.data = _build_error(
            request=request,
            code="API_ERROR",
            message="İstek işlenemedi.",
            details=response.data,
        )

    # Audit (AŞAMA 5’teki standardı koru) log kısmı - kaydı
    if request and response.status_code >= 400:
        try:
            create_audit_log(
                request=request,
                user=request.user if getattr(request.user, "is_authenticated", False) else None,
                action="API_ERROR",
                description=exc.__class__.__name__, #Exception’ın sınıf adı
                status_code=response.status_code,
                meta={
                    "code": response.data.get("error", {}).get("code"),
                    "message": response.data.get("error", {}).get("message"),
                },
            )
        except Exception:
            pass

    return response