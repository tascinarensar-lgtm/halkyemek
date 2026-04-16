from django.urls import path

from orders.api.views_cart import (
    CartCheckoutPreviewAPIView,
    CartClearAPIView,
    CartDetailAPIView,
    CartItemAddAPIView,
    CartItemQuantityUpdateAPIView,
)

urlpatterns = [
    path("cart/", CartDetailAPIView.as_view(), name="cart-detail"),
    path("cart/items/", CartItemAddAPIView.as_view(), name="cart-item-add"),
    path("cart/items/<int:item_id>/", CartItemQuantityUpdateAPIView.as_view(), name="cart-item-update"),
    path("cart/clear/", CartClearAPIView.as_view(), name="cart-clear"),
    path("cart/checkout-preview/", CartCheckoutPreviewAPIView.as_view(), name="cart-checkout-preview"),
]
