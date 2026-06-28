from django.urls import path

from surprise_deals.views import (
    BusinessSurpriseDealCloseAPIView,
    BusinessSurpriseDealDetailAPIView,
    BusinessSurpriseDealListCreateAPIView,
    OpsSurpriseDealCloseAPIView,
    OpsSurpriseDealDetailAPIView,
    OpsSurpriseDealListAPIView,
    PublicSurpriseDealCheckoutSessionAPIView,
    PublicSurpriseDealDetailAPIView,
    PublicSurpriseDealListAPIView,
)


urlpatterns = [
    path("ops/surprise-deals/", OpsSurpriseDealListAPIView.as_view(), name="ops-surprise-deal-list"),
    path("ops/surprise-deals/<int:deal_id>/", OpsSurpriseDealDetailAPIView.as_view(), name="ops-surprise-deal-detail"),
    path(
        "ops/surprise-deals/<int:deal_id>/close/",
        OpsSurpriseDealCloseAPIView.as_view(),
        name="ops-surprise-deal-close",
    ),
    path("surprise-deals/", PublicSurpriseDealListAPIView.as_view(), name="surprise-deal-list"),
    path(
        "surprise-deals/<int:deal_id>/checkout-session/",
        PublicSurpriseDealCheckoutSessionAPIView.as_view(),
        name="surprise-deal-checkout-session-create",
    ),
    path("surprise-deals/<int:deal_id>/", PublicSurpriseDealDetailAPIView.as_view(), name="surprise-deal-detail"),
    path(
        "businesses/<int:business_id>/surprise-deals/",
        BusinessSurpriseDealListCreateAPIView.as_view(),
        name="business-surprise-deal-list-create",
    ),
    path(
        "businesses/<int:business_id>/surprise-deals/<int:deal_id>/",
        BusinessSurpriseDealDetailAPIView.as_view(),
        name="business-surprise-deal-detail",
    ),
    path(
        "businesses/<int:business_id>/surprise-deals/<int:deal_id>/close/",
        BusinessSurpriseDealCloseAPIView.as_view(),
        name="business-surprise-deal-close",
    ),
]
