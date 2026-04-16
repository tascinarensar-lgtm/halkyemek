from django.urls import include, path

from .views import IyzicoWebhookView, ProviderWebhookView

app_name = "payments"

urlpatterns = [
    path("", include("payments.api.urls")),
    path("webhook/provider/", ProviderWebhookView.as_view(), name="provider-webhook"),
    path("webhooks/iyzico/", IyzicoWebhookView.as_view(), name="iyzico-webhook"),
]
