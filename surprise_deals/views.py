from __future__ import annotations

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsAdminRole
from common.throttles import OpsActionThrottle
from logs.services import create_audit_log
from orders.models import Order
from businesses.models import BusinessMember, BusinessProfile
from businesses.services.membership import get_user_business_membership
from surprise_deals.models import SurpriseDeal, SurpriseDealReservation
from surprise_deals.notifications import notify_surprise_deal_closed
from surprise_deals.serializers import (
    OpsSurpriseDealQuerySerializer,
    SurpriseDealBusinessSerializer,
    SurpriseDealCheckoutCreateSerializer,
    SurpriseDealCheckoutResponseSerializer,
    SurpriseDealCreateUpdateSerializer,
    SurpriseDealPublicSerializer,
)
from surprise_deals.services_checkout import (
    SurpriseDealCheckoutDuplicateReservation,
    SurpriseDealCheckoutForbidden,
    SurpriseDealCheckoutInsufficientBalance,
    SurpriseDealCheckoutInvalid,
    SurpriseDealCheckoutNotFound,
    create_surprise_deal_checkout_session,
)


PUBLIC_ORDERING_FIELDS = {
    "pickup_window_start",
    "-pickup_window_start",
    "pickup_window_end",
    "-pickup_window_end",
    "sale_price_amount",
    "-sale_price_amount",
}

MANAGEMENT_ROLES = {
    BusinessMember.Role.OWNER,
    BusinessMember.Role.MANAGER,
}


def get_halktasarruf_business_for_management_or_403(user, business_id: int) -> BusinessProfile:
    business = BusinessProfile.objects.filter(id=business_id).first()
    if business is None:
        raise PermissionDenied("Business access denied.")

    if not business.supports_halktasarruf:
        raise PermissionDenied("HalkTasarruf business access required.")

    if user.is_admin():
        return business

    membership = get_user_business_membership(user, business)
    if membership is None or membership.role not in MANAGEMENT_ROLES or not membership.access_halktasarruf:
        raise PermissionDenied("HalkTasarruf business management access required.")

    return business


def public_surprise_deal_queryset():
    now = timezone.now()
    return (
        SurpriseDeal.objects.filter(
            status=SurpriseDeal.Status.ACTIVE,
            quantity_remaining__gt=0,
            pickup_window_end__gt=now,
            business__is_active=True,
            business__is_approved=True,
            business__is_listed=True,
            business__marketplace_is_visible=True,
        )
        .select_related("business")
    )


def _business_deal_queryset(*, business):
    return (
        SurpriseDeal.objects.filter(business=business)
        .select_related("business", "created_by")
        .annotate(
            active_reserved_count=Count(
                "reservations",
                filter=Q(reservations__status=SurpriseDealReservation.Status.RESERVED),
            )
        )
    )


def _ops_surprise_deal_queryset():
    return (
        SurpriseDeal.objects.select_related("business", "created_by")
        .annotate(
            reservation_count=Count("reservations", distinct=True),
            committed_count=Count(
                "reservations",
                filter=Q(reservations__status=SurpriseDealReservation.Status.COMMITTED),
                distinct=True,
            ),
            expired_count=Count(
                "reservations",
                filter=Q(reservations__status=SurpriseDealReservation.Status.EXPIRED),
                distinct=True,
            ),
            cancelled_count=Count(
                "reservations",
                filter=Q(reservations__status=SurpriseDealReservation.Status.CANCELLED),
                distinct=True,
            ),
        )
    )


def _ops_summary(deal: SurpriseDeal) -> dict:
    return {
        "id": deal.id,
        "title": deal.title,
        "business": {
            "id": deal.business_id,
            "name": deal.business.business_name,
            "district": deal.business.district,
        },
        "business_name": deal.business.business_name,
        "district": deal.business.district,
        "status": deal.status,
        "sale_price_amount": int(deal.sale_price_amount),
        "original_value_amount": int(deal.original_value_amount),
        "currency": deal.currency,
        "quantity_total": int(deal.quantity_total),
        "quantity_remaining": int(deal.quantity_remaining),
        "quantity_reserved": int(deal.quantity_reserved),
        "pickup_window_start": deal.pickup_window_start,
        "pickup_window_end": deal.pickup_window_end,
        "created_at": deal.created_at,
        "published_at": deal.published_at,
        "closed_at": deal.closed_at,
        "reservation_count": int(getattr(deal, "reservation_count", 0) or 0),
        "committed_count": int(getattr(deal, "committed_count", 0) or 0),
        "expired_count": int(getattr(deal, "expired_count", 0) or 0),
        "cancelled_count": int(getattr(deal, "cancelled_count", 0) or 0),
    }


def _reservation_summary(*, deal: SurpriseDeal) -> dict:
    rows = (
        deal.reservations.values("status")
        .annotate(count=Count("id"))
        .order_by("status")
    )
    by_status = {row["status"]: int(row["count"] or 0) for row in rows}
    return {
        "total": sum(by_status.values()),
        "reserved": by_status.get(SurpriseDealReservation.Status.RESERVED, 0),
        "committed": by_status.get(SurpriseDealReservation.Status.COMMITTED, 0),
        "released": by_status.get(SurpriseDealReservation.Status.RELEASED, 0),
        "expired": by_status.get(SurpriseDealReservation.Status.EXPIRED, 0),
        "cancelled": by_status.get(SurpriseDealReservation.Status.CANCELLED, 0),
        "by_status": by_status,
    }


def _reservation_payload(reservation: SurpriseDealReservation) -> dict:
    session = reservation.checkout_session
    order = getattr(session, "order", None) if session is not None else None
    return {
        "id": reservation.id,
        "status": reservation.status,
        "quantity": int(reservation.quantity),
        "user_id": reservation.user_id,
        "username": getattr(reservation.user, "username", ""),
        "checkout_session_id": reservation.checkout_session_id,
        "checkout_session_status": getattr(session, "status", None),
        "order_id": getattr(order, "id", None),
        "order_status": getattr(order, "status", None),
        "reserved_at": reservation.reserved_at,
        "committed_at": reservation.committed_at,
        "released_at": reservation.released_at,
        "expires_at": reservation.expires_at,
        "created_at": reservation.created_at,
    }


def _order_payload(order: Order) -> dict:
    return {
        "id": order.id,
        "status": order.status,
        "user_id": order.user_id,
        "username": getattr(order.user, "username", ""),
        "amount": int(order.amount),
        "total_charged_amount": int(order.total_charged_amount),
        "paid_at": order.paid_at,
        "used_at": order.used_at,
        "created_at": order.created_at,
        "checkout_session_id": order.checkout_session_id,
    }


class PublicSurpriseDealListAPIView(APIView):
    permission_classes = [AllowAny]
    serializer_class = SurpriseDealPublicSerializer

    @extend_schema(
        operation_id="public_surprise_deal_list",
        parameters=[
            OpenApiParameter("district", str, required=False),
            OpenApiParameter("business", int, required=False),
            OpenApiParameter("ordering", str, required=False),
        ],
        responses={200: SurpriseDealPublicSerializer(many=True)},
        tags=["surprise-deals"],
    )
    def get(self, request, *args, **kwargs):
        queryset = public_surprise_deal_queryset()
        district = request.query_params.get("district")
        business_id = request.query_params.get("business")
        ordering = request.query_params.get("ordering") or "pickup_window_start"

        if district:
            queryset = queryset.filter(business__district=district)
        if business_id:
            queryset = queryset.filter(business_id=business_id)
        if ordering not in PUBLIC_ORDERING_FIELDS:
            raise ValidationError({"ordering": "Gecersiz siralama alani."})

        queryset = queryset.order_by(ordering, "id")
        serializer = self.serializer_class(queryset, many=True)
        return Response({"count": queryset.count(), "results": serializer.data})


class PublicSurpriseDealDetailAPIView(APIView):
    permission_classes = [AllowAny]
    serializer_class = SurpriseDealPublicSerializer

    @extend_schema(
        operation_id="public_surprise_deal_detail",
        responses={200: SurpriseDealPublicSerializer},
        tags=["surprise-deals"],
    )
    def get(self, request, deal_id: int, *args, **kwargs):
        deal = public_surprise_deal_queryset().filter(id=deal_id).first()
        if deal is None:
            raise NotFound("Surpriz paket bulunamadi.")
        return Response(self.serializer_class(deal).data)


class PublicSurpriseDealCheckoutSessionAPIView(APIView):
    permission_classes = [IsAuthenticated]
    serializer_class = SurpriseDealCheckoutCreateSerializer

    @extend_schema(
        operation_id="public_surprise_deal_checkout_session_create",
        request=SurpriseDealCheckoutCreateSerializer,
        responses={201: SurpriseDealCheckoutResponseSerializer},
        tags=["surprise-deals"],
    )
    def post(self, request, deal_id: int, *args, **kwargs):
        serializer = self.serializer_class(data=request.data or {})
        serializer.is_valid(raise_exception=True)

        try:
            result = create_surprise_deal_checkout_session(
                user=request.user,
                deal_id=deal_id,
                quantity=serializer.validated_data.get("quantity", 1),
            )
        except SurpriseDealCheckoutNotFound as exc:
            raise NotFound(str(exc))
        except SurpriseDealCheckoutForbidden as exc:
            raise ValidationError({"detail": str(exc)})
        except SurpriseDealCheckoutInsufficientBalance as exc:
            raise ValidationError({"detail": str(exc), "code": "insufficient_wallet_balance"})
        except SurpriseDealCheckoutDuplicateReservation as exc:
            raise ValidationError({"detail": str(exc), "code": "active_surprise_deal_reservation_exists"})
        except SurpriseDealCheckoutInvalid as exc:
            raise ValidationError({"detail": str(exc)})

        response_payload = {
            "checkout_session": {
                "id": result.session.id,
                "token": result.session.token,
                "cashier_code": result.session.cashier_code,
                "status": result.session.status,
                "expires_at": result.session.expires_at,
                "source_type": result.session.source_type,
            },
            "surprise_deal": SurpriseDealPublicSerializer(result.deal).data,
            "reservation": result.reservation,
            "total_amount": result.total_amount,
            "wallet_balance": result.wallet_balance,
            "insufficient_balance": result.insufficient_balance,
        }
        return Response(SurpriseDealCheckoutResponseSerializer(response_payload).data, status=status.HTTP_201_CREATED)


class BusinessSurpriseDealListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_business(self):
        return get_halktasarruf_business_for_management_or_403(self.request.user, self.kwargs["business_id"])

    @extend_schema(
        operation_id="business_surprise_deal_list",
        responses={200: SurpriseDealBusinessSerializer(many=True)},
        tags=["business-surprise-deals"],
    )
    def get(self, request, *args, **kwargs):
        business = self._get_business()
        queryset = _business_deal_queryset(business=business).order_by("-pickup_window_start", "-id")
        serializer = SurpriseDealBusinessSerializer(queryset, many=True)
        return Response({"count": queryset.count(), "results": serializer.data})

    @extend_schema(
        operation_id="business_surprise_deal_create",
        request=SurpriseDealCreateUpdateSerializer,
        responses={201: SurpriseDealBusinessSerializer},
        tags=["business-surprise-deals"],
    )
    def post(self, request, *args, **kwargs):
        business = self._get_business()
        serializer = SurpriseDealCreateUpdateSerializer(
            data=request.data,
            context={"request": request, "business": business},
        )
        serializer.is_valid(raise_exception=True)
        deal = serializer.save()
        return Response(SurpriseDealBusinessSerializer(deal).data, status=status.HTTP_201_CREATED)


class BusinessSurpriseDealDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_business(self):
        return get_halktasarruf_business_for_management_or_403(self.request.user, self.kwargs["business_id"])

    def _get_deal(self):
        business = self._get_business()
        deal = _business_deal_queryset(business=business).filter(id=self.kwargs["deal_id"]).first()
        if deal is None:
            raise NotFound("Surpriz paket bulunamadi.")
        return business, deal

    @extend_schema(
        operation_id="business_surprise_deal_update",
        request=SurpriseDealCreateUpdateSerializer,
        responses={200: SurpriseDealBusinessSerializer},
        tags=["business-surprise-deals"],
    )
    def patch(self, request, *args, **kwargs):
        business, deal = self._get_deal()
        serializer = SurpriseDealCreateUpdateSerializer(
            deal,
            data=request.data,
            partial=True,
            context={"request": request, "business": business},
        )
        serializer.is_valid(raise_exception=True)
        updated_deal = serializer.save()
        return Response(SurpriseDealBusinessSerializer(updated_deal).data)

    @extend_schema(
        operation_id="business_surprise_deal_delete",
        responses={204: None},
        tags=["business-surprise-deals"],
    )
    def delete(self, request, *args, **kwargs):
        _, deal = self._get_deal()

        if deal.reservations.filter(status=SurpriseDealReservation.Status.RESERVED).exists():
            raise ValidationError({"detail": "Aktif rezervasyon varken sürpriz paket silinemez."})

        if deal.reservations.exists():
            raise ValidationError({"detail": "Geçmiş rezervasyon veya sipariş kaydı olan sürpriz paket silinemez. Güvenli kapat kullanın."})

        deal.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BusinessSurpriseDealCloseAPIView(APIView):
    permission_classes = [IsAuthenticated]
    serializer_class = SurpriseDealBusinessSerializer

    @extend_schema(
        operation_id="business_surprise_deal_close",
        request=None,
        responses={200: SurpriseDealBusinessSerializer},
        tags=["business-surprise-deals"],
    )
    def post(self, request, business_id: int, deal_id: int, *args, **kwargs):
        business = get_halktasarruf_business_for_management_or_403(request.user, business_id)
        deal = _business_deal_queryset(business=business).filter(id=deal_id).first()
        if deal is None:
            raise NotFound("Surpriz paket bulunamadi.")

        if deal.reservations.filter(status=SurpriseDealReservation.Status.RESERVED).exists():
            raise ValidationError({"detail": "Aktif rezervasyon varken firsat kapatilamaz."})

        deal.status = SurpriseDeal.Status.CLOSED
        deal.closed_at = timezone.now()
        try:
            deal.save(update_fields=["status", "closed_at", "updated_at"])
        except Exception as exc:
            raise ValidationError({"detail": str(exc)})
        notify_surprise_deal_closed(deal=deal)
        return Response(SurpriseDealBusinessSerializer(deal).data)


class OpsSurpriseDealListAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(
        operation_id="ops_surprise_deal_list",
        parameters=[OpsSurpriseDealQuerySerializer],
        responses={200: dict},
        tags=["ops-surprise-deals"],
    )
    def get(self, request, *args, **kwargs):
        serializer = OpsSurpriseDealQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        filters = serializer.validated_data

        queryset = _ops_surprise_deal_queryset().order_by("-pickup_window_start", "-id")

        if "status" in filters:
            queryset = queryset.filter(status=filters["status"])
        if "business" in filters:
            queryset = queryset.filter(business_id=filters["business"])
        if filters.get("district"):
            queryset = queryset.filter(business__district=str(filters["district"]).strip())
        if "date_from" in filters:
            queryset = queryset.filter(pickup_window_start__gte=filters["date_from"])
        if "date_to" in filters:
            queryset = queryset.filter(pickup_window_start__lte=filters["date_to"])
        if "has_reserved" in filters:
            queryset = queryset.filter(quantity_reserved__gt=0) if filters["has_reserved"] else queryset.filter(quantity_reserved=0)
        if "has_remaining" in filters:
            queryset = queryset.filter(quantity_remaining__gt=0) if filters["has_remaining"] else queryset.filter(quantity_remaining=0)

        q = str(filters.get("q") or "").strip()
        if q:
            queryset = queryset.filter(Q(title__icontains=q) | Q(business__business_name__icontains=q))

        deals = list(queryset[:200])
        return Response(
            {
                "ok": True,
                "data": {
                    "count": len(deals),
                    "results": [_ops_summary(deal) for deal in deals],
                },
            },
            status=status.HTTP_200_OK,
        )


class OpsSurpriseDealDetailAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(
        operation_id="ops_surprise_deal_detail",
        responses={200: dict, 404: dict},
        tags=["ops-surprise-deals"],
    )
    def get(self, request, deal_id: int, *args, **kwargs):
        deal = _ops_surprise_deal_queryset().filter(id=deal_id).first()
        if deal is None:
            raise NotFound("Surpriz paket bulunamadi.")

        reservations = list(
            SurpriseDealReservation.objects.filter(surprise_deal=deal)
            .select_related("user", "checkout_session", "checkout_session__order")
            .order_by("-created_at", "-id")[:20]
        )
        orders = list(
            Order.objects.filter(
                checkout_session__surprise_deal_reservations__surprise_deal=deal,
            )
            .select_related("user", "checkout_session")
            .order_by("-created_at", "-id")[:20]
        )

        return Response(
            {
                "ok": True,
                "data": {
                    "deal": _ops_summary(deal),
                    "business": {
                        "id": deal.business_id,
                        "name": deal.business.business_name,
                        "district": deal.business.district,
                        "is_active": deal.business.is_active,
                        "is_approved": deal.business.is_approved,
                        "is_listed": deal.business.is_listed,
                        "marketplace_is_visible": deal.business.marketplace_is_visible,
                    },
                    "reservation_summary": _reservation_summary(deal=deal),
                    "recent_reservations": [_reservation_payload(reservation) for reservation in reservations],
                    "recent_orders": [_order_payload(order) for order in orders],
                },
            },
            status=status.HTTP_200_OK,
        )


class OpsSurpriseDealCloseAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(
        operation_id="ops_surprise_deal_close",
        request=None,
        responses={200: dict, 400: dict, 404: dict},
        tags=["ops-surprise-deals"],
    )
    @transaction.atomic
    def post(self, request, deal_id: int, *args, **kwargs):
        deal = SurpriseDeal.objects.select_for_update().select_related("business").filter(id=deal_id).first()
        if deal is None:
            raise NotFound("Surpriz paket bulunamadi.")
        if deal.reservations.filter(status=SurpriseDealReservation.Status.RESERVED).exists():
            raise ValidationError({"detail": "Aktif rezervasyon varken surpriz paket kapatilamaz."})

        deal.status = SurpriseDeal.Status.CLOSED
        deal.closed_at = timezone.now()
        deal.save(update_fields=["status", "closed_at", "updated_at"])
        notify_surprise_deal_closed(deal=deal)

        create_audit_log(
            request=request,
            user=request.user,
            action="OPS_SURPRISE_DEAL_CLOSE",
            description="Ops closed surprise deal.",
            status_code=status.HTTP_200_OK,
            meta={"surprise_deal_id": int(deal.id), "business_id": int(deal.business_id)},
        )

        deal = _ops_surprise_deal_queryset().get(id=deal.id)
        return Response({"ok": True, "data": _ops_summary(deal)}, status=status.HTTP_200_OK)
