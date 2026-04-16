from typing import cast

from rest_framework import mixins, viewsets
from drf_spectacular.utils import OpenApiExample, extend_schema, extend_schema_view

from common.openapi import ApiErrorEnvelopeSerializer
from rest_framework.permissions import BasePermission, IsAuthenticated

from accounts.models import User
from orders.api.permissions import IsOrderBusiness, IsOrderOwner
from orders.models import Order

from .serializers import OrderSerializer


@extend_schema_view(
    list=extend_schema(
        operation_id="order_list",
        tags=["orders"],
        responses={200: OrderSerializer(many=True), 403: ApiErrorEnvelopeSerializer},
        examples=[OpenApiExample("Order list item", value={"id": 987, "user": 12, "user_username": "g_113355", "business": 8, "business_name": "Örnek İşletme", "checkout_session_id": 321, "cart_id": 55, "amount": 215, "subtotal_amount": 200, "customer_fee_amount": 15, "business_fee_amount": 10, "total_charged_amount": 215, "business_net_amount": 190, "item_count": 2, "status": "USED", "paid_at": "2026-04-02T12:30:00+03:00", "used_at": "2026-04-02T12:35:00+03:00", "expires_at": "2026-04-03T12:30:00+03:00", "created_at": "2026-04-02T12:30:00+03:00", "pricing": {"fee_model": "customer_fee"}, "source": {"contract": "cart_checkout_qr_order", "cart_id": 55, "checkout_session_id": 321}, "order_items": []}, response_only=True)],
    ),
    retrieve=extend_schema(operation_id="order_detail", tags=["orders"], responses={200: OrderSerializer, 403: ApiErrorEnvelopeSerializer, 404: ApiErrorEnvelopeSerializer}),
)
class OrderViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    - CUSTOMER: sadece kendi order'larını listeler/görür
    - BUSINESS MEMBER: üyeliği olduğu işletmelerin order'larını listeler/görür
    - ADMIN: tümünü görebilir
    """

    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "business", "user", "checkout_session", "order_items__menu_item"]
    search_fields = [
        "id",
        "order_items__menu_item_name",
        "business__business_name",
        "user__username",
        "checkout_session__token",
    ]
    ordering_fields = ["created_at", "amount", "status", "paid_at", "used_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()

        user = cast(User, self.request.user)
        if not getattr(user, "is_authenticated", False):
            return Order.objects.none()

        qs = (
            Order.objects.select_related("user", "business", "checkout_session")
            .prefetch_related("order_items")
            .only(
                "id",
                "user__id",
                "user__username",
                "business__id",
                "business__business_name",
                "checkout_session__id",
                "amount",
                "status",
                "paid_at",
                "used_at",
                "expires_at",
                "created_at",
            )
            .order_by("-created_at")
        )

        if user.is_admin():
            return qs

        member_business_ids = list(
            user.business_memberships.filter(is_active=True).values_list("business_id", flat=True)
        )
        if member_business_ids:
            return (qs.filter(business_id__in=member_business_ids) | qs.filter(user=user)).distinct()

        return qs.filter(user=user)

    def get_permissions(self):
        return [IsAuthenticated()]

    def get_object(self):
        obj = super().get_object()
        user = cast(User, self.request.user)

        if user.is_admin():
            return obj
        if obj.user_id == user.id:
            return obj
        if user.has_business_membership() and IsOrderBusiness().has_object_permission(self.request, self, obj):
            return obj
        if IsOrderOwner().has_object_permission(self.request, self, obj):
            return obj

        self.permission_denied(self.request, message=IsOrderOwner.message)
