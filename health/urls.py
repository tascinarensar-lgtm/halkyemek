from django.urls import path

from .views import MetricsAPIView, healthz, readyz

urlpatterns = [
    path("", healthz, name="healthz"),
    path("readiness/", readyz, name="readiness"),
    path("metrics/", MetricsAPIView.as_view(), name="metrics"),
]
