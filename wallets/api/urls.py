from django.urls import path

from wallets.api.views import (
    PendingWalletTransactionListAPIView,
    WalletDetailAPIView,
    WalletTransactionListAPIView,
)

urlpatterns = [
    path("wallet/", WalletDetailAPIView.as_view(), name="wallet-detail"),
    path("wallet/transactions/", WalletTransactionListAPIView.as_view(), name="wallet-transactions"),
    path(
        "wallet/pending-transactions/",
        PendingWalletTransactionListAPIView.as_view(),
        name="wallet-pending-transactions",
    ),
]
