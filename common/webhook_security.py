from django.conf import settings
from django.http import JsonResponse
"""
Body size limiti (DoS koruması)
Strict Content-Type kontrolü (input validation)
"""
class WebhookBodyLimitMiddleware:
    """
    Yalnız webhook endpointlerine body size limiti uygular.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith("/api/v1/payments/webhooks/iyzico/"):
            max_bytes = getattr(settings, "WEBHOOK_MAX_BODY_BYTES", 262144)
            cl = request.META.get("CONTENT_LENGTH")
            if cl and int(cl) > max_bytes:
                return JsonResponse({"ok": False, "error": {"code": "webhook.body_too_large"}}, status=413)

            # Content-Type strict
            ct = (request.META.get("CONTENT_TYPE") or "").lower()
            if "application/json" not in ct:
                return JsonResponse({"ok": False, "error": {"code": "webhook.invalid_content_type"}}, status=415)

        return self.get_response(request)
