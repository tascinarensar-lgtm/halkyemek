from __future__ import annotations

from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes

from businesses.api.serializers_business import (
    BusinessConsumeHistoryQuerySerializer,
    BusinessProfileOperationsUpdateSerializer,
)
from businesses.models import BusinessMember, BusinessProfile
from businesses.services.membership import get_user_business_membership
from common.pagination import DefaultPagination
from menus.models import BusinessOffer, MediaAsset
from orders.models import CheckoutSession, Order
from payouts.models import BusinessEarning, Payout


MANAGEMENT_ROLES = {
    BusinessMember.Role.OWNER,
    BusinessMember.Role.MANAGER,
}


def _resolve_business_access(*, user, business_id: int, allow_cashier: bool = True) -> tuple[BusinessProfile, str]:
    business = get_object_or_404(BusinessProfile, id=business_id)
    if user.is_admin():
        return business, "ADMIN"

    membership = get_user_business_membership(user, business)
    if membership is None:
        raise PermissionDenied("Business membership required.")

    role = str(membership.role)
    if not allow_cashier and role not in MANAGEMENT_ROLES:
        raise PermissionDenied("Manager or owner role required.")

    return business, role


class BusinessDashboardSummaryAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="business_dashboard_summary", responses={200: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["business-operations"])
    def get(self, request, business_id: int):
        business, role = _resolve_business_access(user=request.user, business_id=business_id, allow_cashier=True)

        now = timezone.now()
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

        consumed_today_qs = CheckoutSession.objects.filter(
            business=business,
            status=CheckoutSession.Status.CONSUMED,
            consumed_at__gte=day_start,
            consumed_at__lte=now,
        )
        consumed_today_count = consumed_today_qs.count()
        consumed_today_amount = int(consumed_today_qs.aggregate(total=Sum("amount"))["total"] or 0)

        pending_sessions = CheckoutSession.objects.filter(
            business=business,
            status__in=[CheckoutSession.Status.PENDING, CheckoutSession.Status.CONFIRMED],
        ).order_by("expires_at", "-created_at")[:10]

        latest_consumed = CheckoutSession.objects.filter(
            business=business,
            status=CheckoutSession.Status.CONSUMED,
        ).order_by("-consumed_at", "-id")[:10]

        live_offer_qs = BusinessOffer.objects.filter(
            business=business,
            is_active=True,
            starts_at__lte=now,
            ends_at__gt=now,
        )
        active_offer_qs = BusinessOffer.objects.filter(business=business, is_active=True)

        media_qs = MediaAsset.objects.filter(business=business)
        active_media_qs = media_qs.filter(is_active=True)

        earning_qs = BusinessEarning.objects.filter(business=business)
        payout_qs = Payout.objects.filter(business=business)

        earning_summary = {
            "pending_count": earning_qs.filter(status=BusinessEarning.Status.PENDING).count(),
            "eligible_count": earning_qs.filter(status=BusinessEarning.Status.ELIGIBLE).count(),
            "in_payout_count": earning_qs.filter(status=BusinessEarning.Status.IN_PAYOUT).count(),
            "paid_count": earning_qs.filter(status=BusinessEarning.Status.PAID).count(),
            "outstanding_net_amount": int(
                earning_qs.filter(
                    status__in=[BusinessEarning.Status.PENDING, BusinessEarning.Status.ELIGIBLE, BusinessEarning.Status.IN_PAYOUT],
                ).aggregate(total=Sum("net_amount"))["total"] or 0
            ),
        }
        payout_summary = {
            "created_count": payout_qs.filter(status="CREATED").count(),
            "failed_count": payout_qs.filter(status="FAILED").count(),
            "sent_count": payout_qs.filter(status="SENT").count(),
            "confirmed_count": payout_qs.filter(status="CONFIRMED").count(),
            "confirmed_amount_total": int(payout_qs.filter(status="CONFIRMED").aggregate(total=Sum("amount"))["total"] or 0),
        }

        finance_block = {
            "earning": earning_summary,
            "payout": payout_summary,
        }
        if role == BusinessMember.Role.CASHIER:
            finance_block = {
                "earning": {
                    "pending_count": earning_summary["pending_count"],
                    "eligible_count": earning_summary["eligible_count"],
                    "in_payout_count": earning_summary["in_payout_count"],
                    "paid_count": earning_summary["paid_count"],
                },
                "payout": {
                    "created_count": payout_summary["created_count"],
                    "failed_count": payout_summary["failed_count"],
                    "sent_count": payout_summary["sent_count"],
                    "confirmed_count": payout_summary["confirmed_count"],
                },
            }

        data = {
            "business": {
                "id": business.id,
                "name": business.business_name,
                "district": business.district,
                "member_role": role,
            },
            "consume_today": {
                "count": consumed_today_count,
                "total_charged_amount": consumed_today_amount,
            },
            "sessions": {
                "pending": [
                    {
                        "id": s.id,
                        "token": s.token,
                        "status": s.status,
                        "amount": int(s.amount),
                        "total_payable_amount": int(s.amount),
                        "item_count": int(s.item_count),
                        "expires_at": s.expires_at,
                    }
                    for s in pending_sessions
                ],
                "latest_consumed": [
                    {
                        "id": s.id,
                        "token": s.token,
                        "amount": int(s.amount),
                        "total_payable_amount": int(s.amount),
                        "item_count": int(s.item_count),
                        "consumed_at": s.consumed_at,
                        "order_id": getattr(getattr(s, "order", None), "id", None),
                    }
                    for s in latest_consumed
                ],
            },
            "offers": {
                "active_count": active_offer_qs.count(),
                "live_count": live_offer_qs.count(),
                "featured_count": active_offer_qs.filter(is_featured=True).count(),
            },
            "showcase": {
                "listing_type": business.listing_type,
                "is_featured": bool(business.is_featured),
                "is_listed": bool(business.is_listed),
                "marketplace_is_visible": bool(business.marketplace_is_visible),
            },
            "media": {
                "total_count": media_qs.count(),
                "active_count": active_media_qs.count(),
                "gallery_count": active_media_qs.filter(asset_role=MediaAsset.AssetRole.GALLERY).count(),
                "cover_count": active_media_qs.filter(asset_role=MediaAsset.AssetRole.COVER).count(),
                "logo_count": active_media_qs.filter(asset_role=MediaAsset.AssetRole.LOGO).count(),
                "thumbnail_count": active_media_qs.filter(asset_role=MediaAsset.AssetRole.THUMBNAIL).count(),
            },
            "finance": finance_block,
        }
        return Response({"ok": True, "data": data}, status=status.HTTP_200_OK)


class BusinessConsumeHistoryAPIView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = DefaultPagination

    @extend_schema(operation_id="business_consume_history", parameters=[BusinessConsumeHistoryQuerySerializer], responses={200: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["business-operations"])
    def get(self, request, business_id: int):
        business, _ = _resolve_business_access(user=request.user, business_id=business_id, allow_cashier=True)
        query_serializer = BusinessConsumeHistoryQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        filters = query_serializer.validated_data

        qs = CheckoutSession.objects.filter(
            business=business,
            status=CheckoutSession.Status.CONSUMED,
        ).select_related("user", "consumed_by").order_by("-consumed_at", "-id")

        consumed_after = filters.get("consumed_after")
        if consumed_after is not None:
            qs = qs.filter(consumed_at__gte=consumed_after)
        consumed_before = filters.get("consumed_before")
        if consumed_before is not None:
            qs = qs.filter(consumed_at__lte=consumed_before)

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request, view=self)
        if page is None:
            page = []

        order_map = {
            order.checkout_session_id: order
            for order in Order.objects.select_related(
                "business_earning",
                "business_earning__payout_item__payout",
            ).filter(checkout_session_id__in=[item.id for item in page])
        }

        rows = []
        for session in page:
            order = order_map.get(session.id)
            rows.append(
                {
                    "checkout_session_id": session.id,
                    "checkout_token": session.token,
                    "checkout_session_cashier_code": session.cashier_code,
                    "consumed_at": session.consumed_at,
                    "consumed_by_user_id": session.consumed_by_id,
                    "customer_user_id": session.user_id,
                    "amount": int(session.amount),
                    "total_payable_amount": int(session.amount),
                    "item_count": int(session.item_count),
                    "order": {
                        "id": getattr(order, "id", None),
                        "status": getattr(order, "status", ""),
                        "subtotal_amount": int(getattr(order, "subtotal_amount", 0) or 0),
                        "customer_fee_amount": int(getattr(order, "customer_fee_amount", 0) or 0),
                        "business_fee_amount": int(getattr(order, "business_fee_amount", 0) or 0),
                        "business_net_amount": int(getattr(order, "business_net_amount", 0) or 0),
                        "total_charged_amount": int(getattr(order, "total_charged_amount", 0) or 0),
                        "paid_at": getattr(order, "paid_at", None),
                        "used_at": getattr(order, "used_at", None),
                    },
                    "earning": {
                        "status": getattr(getattr(order, "business_earning", None), "status", ""),
                        "net_amount": int(getattr(getattr(order, "business_earning", None), "net_amount", 0) or 0),
                        "outstanding_amount": int(getattr(getattr(order, "business_earning", None), "outstanding_amount", 0) or 0),
                        "eligible_at": getattr(getattr(order, "business_earning", None), "eligible_at", None),
                        "paid_at": getattr(getattr(order, "business_earning", None), "paid_at", None),
                        "payout": {
                            "id": getattr(getattr(getattr(order, "business_earning", None), "payout_item", None), "payout_id", None),
                            "status": getattr(getattr(getattr(getattr(order, "business_earning", None), "payout_item", None), "payout", None), "status", ""),
                        } if getattr(getattr(order, "business_earning", None), "payout_item", None) is not None else None,
                    } if getattr(order, "business_earning", None) is not None else None,
                }
            )

        return paginator.get_paginated_response(rows)


class BusinessOrderDetailAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="business_order_detail", responses={200: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["business-operations"])
    def get(self, request, business_id: int, order_id: int):
        business, _ = _resolve_business_access(user=request.user, business_id=business_id, allow_cashier=True)
        order = get_object_or_404(
            Order.objects.select_related(
                "checkout_session",
                "user",
                "business",
                "business_earning",
                "business_earning__payout_item__payout",
            ).prefetch_related("order_items"),
            id=order_id,
            business=business,
        )
        earning = getattr(order, "business_earning", None)
        payout = getattr(getattr(earning, "payout_item", None), "payout", None)

        data = {
            "id": order.id,
            "status": order.status,
            "amount": int(order.amount),
            "total_charged_amount": int(order.total_charged_amount),
            "subtotal_amount": int(order.subtotal_amount),
            "customer_fee_amount": int(order.customer_fee_amount),
            "business_fee_amount": int(order.business_fee_amount),
            "business_net_amount": int(order.business_net_amount),
            "item_count": int(order.item_count),
            "created_at": order.created_at,
            "paid_at": order.paid_at,
            "used_at": order.used_at,
            "expires_at": order.expires_at,
            "checkout_session_id": order.checkout_session_id,
            "checkout_session_token": getattr(order.checkout_session, "token", None),
            "checkout_session_cashier_code": getattr(order.checkout_session, "cashier_code", None),
            "consumed_by_user_id": getattr(order.checkout_session, "consumed_by_id", None),
            "customer_user_id": order.user_id,
            "earning": {
                "status": getattr(earning, "status", ""),
                "gross_amount": int(getattr(earning, "gross_amount", 0) or 0),
                "platform_fee_amount": int(getattr(earning, "platform_fee_amount", 0) or 0),
                "net_amount": int(getattr(earning, "net_amount", 0) or 0),
                "outstanding_amount": int(getattr(earning, "outstanding_amount", 0) or 0),
                "eligible_at": getattr(earning, "eligible_at", None),
                "paid_at": getattr(earning, "paid_at", None),
                "payout": {
                    "id": getattr(payout, "id", None),
                    "status": getattr(payout, "status", ""),
                    "confirmed_at": getattr(payout, "confirmed_at", None),
                } if payout is not None else None,
            } if earning is not None else None,
            "items": [
                {
                    "id": item.id,
                    "menu_item_id": item.menu_item_id,
                    "menu_item_name": item.menu_item_name,
                    "quantity": int(item.quantity),
                    "unit_price_amount": int(item.unit_price_amount),
                    "line_total_amount": int(item.line_total_amount),
                    "sort_order": int(item.sort_order),
                }
                for item in order.order_items.all().order_by("sort_order", "id")
            ],
        }
        return Response({"ok": True, "data": data}, status=status.HTTP_200_OK)


class BusinessProfileOperationsAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="business_profile_operations_detail", responses={200: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["business-operations"])
    def get(self, request, business_id: int):
        business, role = _resolve_business_access(user=request.user, business_id=business_id, allow_cashier=True)
        data = {
            "id": business.id,
            "business_name": business.business_name,
            "short_description": business.short_description,
            "intro_text": business.intro_text,
            "badge_text": business.badge_text,
            "marketplace_is_visible": business.marketplace_is_visible,
            "listing_type": business.listing_type,
            "is_featured": business.is_featured,
            "display_priority": business.display_priority,
            "editable": {
                "member_fields": [
                    "short_description",
                    "intro_text",
                    "badge_text",
                    "marketplace_is_visible",
                ],
                "admin_fields": [
                    "listing_type",
                    "is_featured",
                    "display_priority",
                ],
            },
            "member_role": role,
        }
        return Response({"ok": True, "data": data}, status=status.HTTP_200_OK)

    @extend_schema(operation_id="business_profile_operations_update", request=BusinessProfileOperationsUpdateSerializer, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 403: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["business-operations"])
    def patch(self, request, business_id: int):
        business, role = _resolve_business_access(user=request.user, business_id=business_id, allow_cashier=False)
        serializer = BusinessProfileOperationsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        admin_only_fields = {"listing_type", "is_featured", "display_priority"}
        if role != "ADMIN" and any(field in payload for field in admin_only_fields):
            raise PermissionDenied("Only admin can update listing_type/is_featured/display_priority.")

        update_fields: list[str] = []
        for field, value in payload.items():
            setattr(business, field, value)
            update_fields.append(field)

        if update_fields:
            business.save(update_fields=update_fields)

        return Response(
            {
                "ok": True,
                "data": {
                    "business_id": business.id,
                    "updated_fields": update_fields,
                },
            },
            status=status.HTTP_200_OK,
        )
