from django.urls import path

from businesses.api.views_ops import (
    OpsBusinessDetailAPIView,
    OpsBusinessListAPIView,
    OpsBusinessMembershipDeactivateAPIView,
    OpsBusinessMembershipListCreateAPIView,
    OpsBusinessStatusUpdateAPIView,
    OpsCreateSubmerchantAPIView,
)
from businesses.api.views_business import (
    BusinessConsumeHistoryAPIView,
    BusinessDashboardSummaryAPIView,
    BusinessOrderDetailAPIView,
    BusinessProfileOperationsAPIView,
)

urlpatterns = [
    path(
        "businesses/<int:business_id>/operations/dashboard-summary/",
        BusinessDashboardSummaryAPIView.as_view(),
        name="business-dashboard-summary",
    ),
    path(
        "businesses/<int:business_id>/operations/consume-history/",
        BusinessConsumeHistoryAPIView.as_view(),
        name="business-consume-history",
    ),
    path(
        "businesses/<int:business_id>/operations/orders/<int:order_id>/",
        BusinessOrderDetailAPIView.as_view(),
        name="business-order-detail",
    ),
    path(
        "businesses/<int:business_id>/operations/profile/",
        BusinessProfileOperationsAPIView.as_view(),
        name="business-profile-operations",
    ),
    path("ops/businesses/", OpsBusinessListAPIView.as_view(), name="ops-business-list"),
    path("ops/businesses/<int:business_id>/", OpsBusinessDetailAPIView.as_view(), name="ops-business-detail"),
    path(
        "ops/businesses/<int:business_id>/status/",
        OpsBusinessStatusUpdateAPIView.as_view(),
        name="ops-business-status-update",
    ),
    path(
        "ops/businesses/<int:business_id>/memberships/",
        OpsBusinessMembershipListCreateAPIView.as_view(),
        name="ops-business-membership-list-create",
    ),
    path(
        "ops/businesses/<int:business_id>/memberships/deactivate/",
        OpsBusinessMembershipDeactivateAPIView.as_view(),
        name="ops-business-membership-deactivate",
    ),
    path(
        "ops/businesses/<int:business_id>/iyzico/submerchant/",
        OpsCreateSubmerchantAPIView.as_view(),
        name="ops-create-submerchant",
    ),
]
