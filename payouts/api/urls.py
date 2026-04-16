from django.urls import path
from payouts.api.views import DispatchDuePayoutsAPIView, PayoutListAPIView, PayoutDetailAPIView, ConfirmPayoutAPIView, OpsDashboardAPIView, ReconcileBusinessAPIView, MetricsAPIView

app_name = "payouts"

urlpatterns = [
    path("ops/payouts/dispatch-due/", DispatchDuePayoutsAPIView.as_view(), name="ops-dispatch-due"),
    path("ops/payouts/", PayoutListAPIView.as_view(), name="ops-payout-list"),
    path("ops/payouts/<int:payout_id>/", PayoutDetailAPIView.as_view(), name="ops-payout-detail"),
    path("ops/payouts/<int:payout_id>/confirm/", ConfirmPayoutAPIView.as_view(), name="ops-payout-confirm"),
    path("ops/dashboard/", OpsDashboardAPIView.as_view(), name="ops-dashboard"),
    path("ops/reconcile/business/<int:business_id>/", ReconcileBusinessAPIView.as_view(), name="ops-reconcile-business"),
    path("ops/metrics/", MetricsAPIView.as_view(), name="ops-metrics"),
]