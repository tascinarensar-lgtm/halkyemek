import hashlib
import math

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes

from businesses.api.serializers_ops import (
    OpsBusinessListQuerySerializer,
    OpsBusinessMembershipDeactivateSerializer,
    OpsBusinessMembershipUpsertSerializer,
    OpsBusinessStatusUpdateSerializer,
)
from businesses.models import BusinessMember, BusinessProfile
from businesses.services.membership import get_business_contact_metadata
from common.locks import build_job_lock_token, job_lock
from common.permissions import IsAdminRole
from common.throttles import OpsActionThrottle
from idempotency.drf import require_idempotency_key
from idempotency.models import IdempotencyRecord
from idempotency.services import IdempotencyConflict, run_idempotent
from logs.services import create_audit_log
from businesses.services.ops_onboarding import run_submerchant_onboarding


CRITICAL_BUSINESS_ROLES = {
    BusinessMember.Role.OWNER,
    BusinessMember.Role.MANAGER,
}


def _assert_business_keeps_critical_membership(*, business: BusinessProfile, target_membership: BusinessMember, next_role: str, next_is_active: bool):
    current_qs = BusinessMember.objects.filter(
        business=business,
        is_active=True,
        role__in=CRITICAL_BUSINESS_ROLES,
    )

    will_target_remain_critical = bool(next_is_active and next_role in CRITICAL_BUSINESS_ROLES)
    if will_target_remain_critical:
        return

    remaining_critical_count = current_qs.exclude(id=target_membership.id).count()
    if remaining_critical_count == 0:
        raise ValidationError(
            {
                "detail": (
                    "Business must keep at least one active OWNER or MANAGER membership."
                )
            }
        )


class OpsBusinessListAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_businesses_list", parameters=[OpsBusinessListQuerySerializer], responses={200: OpenApiTypes.OBJECT}, tags=["ops-businesses"])
    def get(self, request):
        query_serializer = OpsBusinessListQuerySerializer(data=request.query_params)
        query_serializer.is_valid(raise_exception=True)
        filters = query_serializer.validated_data

        qs = BusinessProfile.objects.all().order_by("business_name", "id")

        if "district" in request.query_params:
            qs = qs.filter(district=filters["district"])
        if "is_active" in request.query_params:
            qs = qs.filter(is_active=filters["is_active"])
        if "is_approved" in request.query_params:
            qs = qs.filter(is_approved=filters["is_approved"])
        if "is_listed" in request.query_params:
            qs = qs.filter(is_listed=filters["is_listed"])
        if "payout_onboarding_status" in request.query_params:
            qs = qs.filter(payout_onboarding_status=filters["payout_onboarding_status"])

        q = filters.get("q", "").strip()
        if q:
            qs = qs.filter(
                Q(business_name__icontains=q)
                | Q(category__icontains=q)
                | Q(kyc_email__icontains=q)
                | Q(kyc_contact_name__icontains=q)
                | Q(kyc_contact_surname__icontains=q)
            )

        businesses = list(qs[:200])
        active_counts = {
            business_id: count
            for business_id, count in BusinessMember.objects.filter(
                business_id__in=[business.id for business in businesses],
                is_active=True,
            ).values_list("business_id").annotate(count=Count("id"))
        }

        results = [
            {
                "id": business.id,
                "business_name": business.business_name,
                "category": business.category,
                "district": business.district,
                "listing_type": business.listing_type,
                "is_featured": business.is_featured,
                "display_priority": business.display_priority,
                "is_active": business.is_active,
                "is_approved": business.is_approved,
                "is_listed": business.is_listed,
                "marketplace_is_visible": business.marketplace_is_visible,
                "payout_onboarding_status": business.payout_onboarding_status,
                "iyzico_submerchant_key": business.iyzico_submerchant_key,
                "active_membership_count": active_counts.get(business.id, 0),
                "contact": get_business_contact_metadata(business),
            }
            for business in businesses
        ]
        return Response({"ok": True, "data": {"count": len(results), "results": results}}, status=status.HTTP_200_OK)


class OpsBusinessDetailAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_businesses_detail", responses={200: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-businesses"])
    def get(self, request, business_id: int):
        business = get_object_or_404(
            BusinessProfile.objects.prefetch_related("memberships__user"),
            id=business_id,
        )
        active_memberships = business.memberships.filter(is_active=True).select_related("user", "granted_by").order_by("role", "id")
        data = {
            "id": business.id,
            "business_name": business.business_name,
            "category": business.category,
            "district": business.district,
            "listing_type": business.listing_type,
            "is_featured": business.is_featured,
            "display_priority": business.display_priority,
            "adress": business.adress,
            "is_active": business.is_active,
            "is_approved": business.is_approved,
            "is_listed": business.is_listed,
            "marketplace_is_visible": business.marketplace_is_visible,
            "payout_onboarding_status": business.payout_onboarding_status,
            "payout_onboarding_note": business.payout_onboarding_note,
            "contact": get_business_contact_metadata(business),
            "iyzico_onboarding": {
                "submerchant_type": business.iyzico_submerchant_type,
                "submerchant_key": business.iyzico_submerchant_key,
                "submerchant_status": business.iyzico_submerchant_status,
                "last_error": business.iyzico_last_error,
                "last_synced_at": business.iyzico_last_synced_at,
                "last_response": business.iyzico_last_response,
                "kyc_contact_name": business.kyc_contact_name,
                "kyc_contact_surname": business.kyc_contact_surname,
                "kyc_email": business.kyc_email,
                "kyc_gsm_number": business.kyc_gsm_number,
                "kyc_iban": business.kyc_iban,
                "kyc_identity_number": business.kyc_identity_number,
                "kyc_tax_number": business.kyc_tax_number,
                "kyc_tax_office": business.kyc_tax_office,
                "kyc_legal_company_title": business.kyc_legal_company_title,
                "kyc_address": business.kyc_address,
                "kyc_city": business.kyc_city,
                "kyc_country": business.kyc_country,
                "kyc_zip_code": business.kyc_zip_code,
            },
            "memberships": [
                {
                    "id": membership.id,
                    "user_id": membership.user_id,
                    "username": membership.user.username,
                    "email": membership.user.email,
                    "role": membership.role,
                    "granted_by_id": membership.granted_by_id,
                }
                for membership in active_memberships
            ],
        }
        return Response({"ok": True, "data": data}, status=status.HTTP_200_OK)


class OpsBusinessStatusUpdateAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_business_status_update", request=OpsBusinessStatusUpdateSerializer, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-businesses"])
    @transaction.atomic
    def patch(self, request, business_id: int):
        business = get_object_or_404(BusinessProfile, id=business_id)
        serializer = OpsBusinessStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        payload = serializer.validated_data
        previous = {
            "is_active": business.is_active,
            "is_approved": business.is_approved,
            "is_listed": business.is_listed,
            "listing_type": business.listing_type,
            "is_featured": business.is_featured,
            "display_priority": business.display_priority,
            "marketplace_is_visible": business.marketplace_is_visible,
            "payout_onboarding_note": business.payout_onboarding_note,
        }

        update_fields: list[str] = []
        for field, value in payload.items():
            setattr(business, field, value)
            update_fields.append(field)

        if update_fields:
            business.save(update_fields=update_fields)

        create_audit_log(
            request=request,
            user=request.user,
            action="BUSINESS_STATUS_UPDATE",
            description="Admin updated business lifecycle/status flags",
            status_code=200,
            meta={
                "business_id": business.id,
                "previous": previous,
                "updated": {field: getattr(business, field) for field in payload.keys()},
            },
        )

        return Response(
            {
                "ok": True,
                "data": {
                    "business_id": business.id,
                    "is_active": business.is_active,
                    "is_approved": business.is_approved,
                    "is_listed": business.is_listed,
                    "payout_onboarding_note": business.payout_onboarding_note,
                },
            },
            status=status.HTTP_200_OK,
        )


class OpsBusinessMembershipListCreateAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_business_membership_list", responses={200: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-businesses"])
    def get(self, request, business_id: int):
        business = get_object_or_404(BusinessProfile, id=business_id)
        memberships = (
            BusinessMember.objects.filter(business=business)
            .select_related("user", "granted_by")
            .order_by("-is_active", "role", "id")
        )

        data = [
            {
                "id": membership.id,
                "user_id": membership.user_id,
                "username": membership.user.username,
                "email": membership.user.email,
                "role": membership.role,
                "is_active": membership.is_active,
                "granted_by_id": membership.granted_by_id,
                "granted_by_username": getattr(membership.granted_by, "username", ""),
                "created_at": membership.created_at,
                "updated_at": membership.updated_at,
            }
            for membership in memberships
        ]
        return Response({"ok": True, "data": data}, status=status.HTTP_200_OK)

    @extend_schema(operation_id="ops_business_membership_upsert", request=OpsBusinessMembershipUpsertSerializer, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-businesses"])
    @transaction.atomic
    def post(self, request, business_id: int):
        business = get_object_or_404(BusinessProfile, id=business_id)
        serializer = OpsBusinessMembershipUpsertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        payload = serializer.validated_data
        existing = BusinessMember.objects.filter(
            business=business,
            user_id=payload["user_id"],
        ).first()

        if existing is not None:
            _assert_business_keeps_critical_membership(
                business=business,
                target_membership=existing,
                next_role=payload["role"],
                next_is_active=payload["is_active"],
            )

        membership, created = BusinessMember.objects.update_or_create(
            business=business,
            user_id=payload["user_id"],
            defaults={
                "role": payload["role"],
                "is_active": payload["is_active"],
                "granted_by": request.user,
            },
        )

        create_audit_log(
            request=request,
            user=request.user,
            action="BUSINESS_MEMBERSHIP_UPSERT",
            description="Admin updated business membership",
            status_code=200,
            meta={
                "business_id": business.id,
                "membership_id": membership.id,
                "member_user_id": membership.user_id,
                "role": membership.role,
                "is_active": membership.is_active,
                "created": created,
            },
        )

        return Response(
            {
                "ok": True,
                "data": {
                    "membership_id": membership.id,
                    "business_id": business.id,
                    "user_id": membership.user_id,
                    "role": membership.role,
                    "is_active": membership.is_active,
                    "created": created,
                },
            },
            status=status.HTTP_200_OK,
        )


class OpsBusinessMembershipDeactivateAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_business_membership_deactivate", request=OpsBusinessMembershipDeactivateSerializer, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-businesses"])
    @transaction.atomic
    def post(self, request, business_id: int):
        business = get_object_or_404(BusinessProfile, id=business_id)
        serializer = OpsBusinessMembershipDeactivateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        membership = get_object_or_404(
            BusinessMember,
            business=business,
            user_id=serializer.validated_data["user_id"],
        )

        _assert_business_keeps_critical_membership(
            business=business,
            target_membership=membership,
            next_role=membership.role,
            next_is_active=False,
        )

        membership.is_active = False
        membership.save(update_fields=["is_active", "updated_at"])

        create_audit_log(
            request=request,
            user=request.user,
            action="BUSINESS_MEMBERSHIP_DEACTIVATE",
            description="Admin deactivated business membership",
            status_code=200,
            meta={
                "business_id": business.id,
                "membership_id": membership.id,
                "member_user_id": membership.user_id,
            },
        )

        return Response(
            {
                "ok": True,
                "data": {
                    "membership_id": membership.id,
                    "business_id": business.id,
                    "user_id": membership.user_id,
                    "is_active": membership.is_active,
                },
            },
            status=status.HTTP_200_OK,
        )


class OpsCreateSubmerchantAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    IDEMPOTENCY_SCOPE = "businesses.ops_submerchant_onboarding"

    def check_throttles(self, request):
        idempotency_key = require_idempotency_key(request)
        request.META["OPS_SUBMERCHANT_IDEMPOTENCY_KEY"] = idempotency_key

        if IdempotencyRecord.objects.filter(
            user=request.user,
            scope=self.IDEMPOTENCY_SCOPE,
            key=idempotency_key,
        ).only("id").exists():
            return
        return super().check_throttles(request)

    @staticmethod
    def _fingerprint(*, business_id: int) -> str:
        payload = f"ops_submerchant_onboarding|business:{int(business_id)}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _minimum_lock_ttl_seconds() -> int:
        timeout = int(getattr(settings, "IYZICO_SUBMERCHANT_TIMEOUT_SECONDS", 20) or 20)
        max_attempts = int(getattr(settings, "IYZICO_SUBMERCHANT_MAX_ATTEMPTS", 3) or 3)
        retry_backoff = float(getattr(settings, "IYZICO_SUBMERCHANT_RETRY_BACKOFF_SECONDS", 0.5) or 0.5)
        attempts = max(max_attempts, 1)
        timeout_budget = timeout * attempts
        backoff_budget = 0.0
        for attempt in range(1, attempts):
            backoff_budget += max(retry_backoff, 0.0) * (2 ** (attempt - 1))
        return int(math.ceil(timeout_budget + backoff_budget + 5))

    @staticmethod
    def _provider_trace_meta(business: BusinessProfile) -> dict[str, str]:
        raw_obj = business.iyzico_last_response
        raw: dict[str, object] = raw_obj if isinstance(raw_obj, dict) else {}
        candidates: list[dict[str, object]] = []

        def _append_meta(container: object) -> None:
            if not isinstance(container, dict):
                return
            meta_obj = container.get("meta")
            if isinstance(meta_obj, dict):
                candidates.append(meta_obj)

        _append_meta(raw)
        _append_meta(raw.get("detail"))
        _append_meta(raw.get("update"))

        detail_error_obj = raw.get("detail_error")
        detail_error = detail_error_obj if isinstance(detail_error_obj, dict) else {}
        provider_raw_obj = detail_error.get("provider_raw")
        provider_raw = provider_raw_obj if isinstance(provider_raw_obj, dict) else {}
        _append_meta(provider_raw)
        _append_meta(provider_raw.get("detail"))
        _append_meta(provider_raw.get("update"))

        chosen: dict[str, object] = {}
        for candidate in candidates:
            if candidate.get("http_status") or candidate.get("attempt"):
                chosen = candidate

        if not chosen and candidates:
            chosen = candidates[-1]

        correlation_id = str(chosen.get("correlation_id") or raw.get("correlation_id") or "").strip()
        provider_http_status = str(chosen.get("http_status") or "").strip()
        provider_attempt = str(chosen.get("attempt") or "").strip()
        return {
            "correlation_id": correlation_id,
            "provider_http_status": provider_http_status,
            "provider_attempt": provider_attempt,
        }

    def _build_onboarding_response(self, *, request, business_id: int):
        business = get_object_or_404(BusinessProfile, id=business_id)
        outcome = run_submerchant_onboarding(business=business)
        business = outcome.business
        provider_trace = self._provider_trace_meta(business)

        if outcome.ok:
            create_audit_log(
                request=request,
                user=request.user,
                action="SUBMERCHANT_APPROVED",
                description="Ops triggered iyzico submerchant create/update",
                status_code=200,
                meta={
                    "business_id": business.pk,
                    "submerchant_key": business.iyzico_submerchant_key,
                    "correlation_id": provider_trace["correlation_id"],
                    "provider_http_status": provider_trace["provider_http_status"],
                    "provider_attempt": provider_trace["provider_attempt"],
                },
            )
            return (
                200,
                {
                    "ok": True,
                    "data": {
                        "business_id": business.pk,
                        "submerchant_key": business.iyzico_submerchant_key,
                        "iyzico_submerchant_status": business.iyzico_submerchant_status,
                        "payout_onboarding_status": business.payout_onboarding_status,
                        "correlation_id": provider_trace["correlation_id"],
                    },
                },
            )

        status_code = 400
        error_code = "submerchant_failed"
        if business.payout_onboarding_status == BusinessProfile.PayoutOnboardingStatus.APPROVED:
            status_code = 202
            error_code = "submerchant_refresh_inconclusive"
        elif business.payout_onboarding_status == BusinessProfile.PayoutOnboardingStatus.PENDING:
            status_code = 202
            error_code = "submerchant_pending"
        elif business.payout_onboarding_status == BusinessProfile.PayoutOnboardingStatus.NEEDS_REVIEW:
            status_code = 409
            error_code = "submerchant_needs_review"
        elif business.payout_onboarding_status == BusinessProfile.PayoutOnboardingStatus.REJECTED:
            status_code = 422
            error_code = "submerchant_rejected"

        create_audit_log(
            request=request,
            user=request.user,
            action="SUBMERCHANT_ONBOARDING_INCOMPLETE",
            description="Ops triggered iyzico submerchant create/update and it failed",
            status_code=status_code,
            meta={
                "business_id": business.pk,
                "error": outcome.error_message,
                "payout_onboarding_status": business.payout_onboarding_status,
                "iyzico_submerchant_status": business.iyzico_submerchant_status,
                "correlation_id": provider_trace["correlation_id"],
                "provider_http_status": provider_trace["provider_http_status"],
                "provider_attempt": provider_trace["provider_attempt"],
            },
        )
        return (
            status_code,
            {
                "ok": False,
                "error": {
                    "code": error_code,
                    "message": outcome.error_message,
                },
                "data": {
                    "business_id": business.pk,
                    "payout_onboarding_status": business.payout_onboarding_status,
                    "iyzico_submerchant_status": business.iyzico_submerchant_status,
                    "submerchant_key": business.iyzico_submerchant_key,
                    "correlation_id": provider_trace["correlation_id"],
                },
            },
        )

    @extend_schema(operation_id="ops_create_submerchant", request=None, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT, 409: OpenApiTypes.OBJECT, 422: OpenApiTypes.OBJECT}, tags=["ops-businesses"])
    def post(self, request, business_id: int):
        configured_lock_ttl = int(getattr(settings, "IYZICO_SUBMERCHANT_LOCK_TTL_SECONDS", 120) or 120)
        lock_ttl_seconds = max(configured_lock_ttl, self._minimum_lock_ttl_seconds())
        lock_name = f"ops-submerchant-onboarding:{int(business_id)}"
        lock_token = build_job_lock_token(worker=f"ops-user-{request.user.pk}")

        with job_lock(name=lock_name, token=lock_token, ttl_seconds=lock_ttl_seconds) as lock:
            if not lock.acquired:
                return Response(
                    {
                        "ok": False,
                        "error": {
                            "code": "submerchant_onboarding_in_progress",
                            "message": "Submerchant onboarding is already in progress.",
                        },
                    },
                    status=status.HTTP_409_CONFLICT,
                    headers={"Idempotency-Replayed": "false", "Retry-After": "2"},
                )

            idempotency_key = str(request.META.get("OPS_SUBMERCHANT_IDEMPOTENCY_KEY") or "") or require_idempotency_key(request)
            request_fingerprint = self._fingerprint(business_id=business_id)

            try:
                result = run_idempotent(
                    user=request.user,
                    scope=self.IDEMPOTENCY_SCOPE,
                    key=idempotency_key,
                    request_fingerprint=request_fingerprint,
                    action=lambda: self._build_onboarding_response(request=request, business_id=business_id),
                )
            except IdempotencyConflict as exc:
                reason = getattr(exc, "reason", "conflict")
                headers = {"Idempotency-Replayed": "false"}
                if reason == "in_progress":
                    headers["Retry-After"] = "2"
                return Response(
                    {
                        "ok": False,
                        "error": {
                            "code": "idempotency_conflict",
                            "reason": reason,
                            "message": str(exc),
                        },
                    },
                    status=status.HTTP_409_CONFLICT,
                    headers=headers,
                )

            return Response(
                result.body,
                status=int(result.status_code),
                headers={"Idempotency-Replayed": "true" if result.is_replay else "false"},
            )
