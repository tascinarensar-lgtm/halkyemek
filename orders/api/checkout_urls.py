from django.urls import path

from orders.api.views_checkout import (
    CheckoutSessionCancelAPIView,
    CheckoutSessionConsumeAPIView,
    CheckoutSessionConsumeLookupAPIView,
    CheckoutSessionConsumePreviewAPIView,
    CheckoutSessionCreateAPIView,
    CheckoutSessionDetailAPIView,
    LatestReusableCheckoutSessionAPIView,
)

urlpatterns = [
    path(
        "checkout-sessions/",
        CheckoutSessionCreateAPIView.as_view(),
        name="checkout-session-create",
    ),
    path(
        "checkout-sessions/latest/",
        LatestReusableCheckoutSessionAPIView.as_view(),
        name="checkout-session-latest",
    ),
    path(
        "checkout-sessions/<str:token>/cancel/",
        CheckoutSessionCancelAPIView.as_view(),
        name="checkout-session-cancel",
    ),
    path(
        "checkout-sessions/<str:token>/",
        CheckoutSessionDetailAPIView.as_view(),
        name="checkout-session-detail",
    ),
    path(
        "businesses/<int:business_id>/checkout-sessions/<str:token>/consume/",
        CheckoutSessionConsumeAPIView.as_view(),
        name="checkout-session-consume",
    ),
    path(
        "businesses/<int:business_id>/checkout-sessions/<str:token>/preview/",
        CheckoutSessionConsumePreviewAPIView.as_view(),
        name="checkout-session-consume-preview",
    ),
    path(
        "businesses/<int:business_id>/checkout-sessions/lookup/",
        CheckoutSessionConsumeLookupAPIView.as_view(),
        name="checkout-session-consume-lookup",
    ),
]
