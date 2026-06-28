from __future__ import annotations

from django.conf import settings
from django.contrib import admin
from django.conf.urls.static import static
from django.urls import include, path

from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.api.views import LoginView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/v1/auth/", include("accounts.api.urls")),
    path("api/v1/orders/", include("orders.api.urls")),
    path("api/v1/", include("orders.api.checkout_urls")),
    path("api/v1/", include("orders.api.cart_urls")),
    path("api/v1/", include("menus.api.urls")),
    path("api/v1/", include("businesses.api.urls")),
    path("api/v1/", include("surprise_deals.urls")),
    path("api/v1/payments/", include("payments.urls")),
    path("api/v1/", include("wallets.api.urls")),
    path("api/v1/notifications/", include("notifications.urls")),
    path("api/v1/", include("payouts.api.urls")),
    path("health/", include("health.urls")),
]

if settings.DEBUG:
    urlpatterns = [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
        path("api/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
        *urlpatterns,
    ]
    urlpatterns += [
        path("api/v1/auth/login/", LoginView.as_view(), name="token_obtain_pair"),
    ]
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
