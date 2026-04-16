from django.conf import settings
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class TestAwareUserRateThrottle(UserRateThrottle):
    def get_cache_key(self, request, view):
        user = getattr(request, "user", None)
        if getattr(settings, "TESTING", False) and user and user.is_authenticated:
            username = str(getattr(user, "username", "") or "")
            ident = f"{user.pk}:{username}"
            return self.cache_format % {"scope": self.scope, "ident": ident}
        return super().get_cache_key(request, view)


class GoogleLoginThrottle(AnonRateThrottle):
    scope = "auth_google"


class DeviceUpsertThrottle(TestAwareUserRateThrottle):
    scope = "device_upsert"


class OrderCreateThrottle(TestAwareUserRateThrottle):
    scope = "order_create"


class QRUseThrottle(TestAwareUserRateThrottle):
    scope = "qr_use"


class PaymentCreateThrottle(TestAwareUserRateThrottle):
    scope = "payment_create"


class AdminBroadcastThrottle(TestAwareUserRateThrottle):
    scope = "admin_broadcast"


class MarketplaceAdminThrottle(TestAwareUserRateThrottle):
    scope = "marketplace_admin"


class OpsActionThrottle(TestAwareUserRateThrottle):
    scope = "ops"


class CheckoutSessionCreateThrottle(TestAwareUserRateThrottle):
    scope = "checkout_session_create"


class CheckoutSessionConsumeThrottle(TestAwareUserRateThrottle):
    scope = "checkout_session_consume"


class CartActionThrottle(TestAwareUserRateThrottle):
    scope = "cart_action"


class CheckoutPreviewThrottle(TestAwareUserRateThrottle):
    scope = "checkout_preview"
