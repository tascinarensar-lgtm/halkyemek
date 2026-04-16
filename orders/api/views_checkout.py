import json
import hashlib

from django.core.exceptions import ValidationError as DjangoValidationError
from common.openapi import ApiErrorEnvelopeSerializer, CHECKOUT_CREATE_SUCCESS_EXAMPLE, STANDARD_ERROR_EXAMPLE
from common.responses import error
from common.throttles import CheckoutSessionConsumeThrottle, CheckoutSessionCreateThrottle
from idempotency.drf import require_idempotency_key
from idempotency.models import IdempotencyRecord
from idempotency.services import IdempotencyConflict, run_idempotent
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from businesses.models import BusinessProfile
from logs.services import create_audit_log
from notifications.permissions import HasActivePushDevice
from orders.services_cart import ActiveCartNotFound, CartError, CartService
from orders.serializers_checkout import (
    CheckoutConsumeResponseSerializer,
    CheckoutSessionPreviewResponseSerializer,
    CheckoutSessionCreateSerializer,
    CheckoutSessionDetailSerializer,
)
from orders.services_checkout import (
    CheckoutSessionAccessResult,
    CheckoutSessionAlreadyConsumed,
    CheckoutSessionBusinessMismatch,
    CheckoutSessionCancelled,
    CheckoutSessionError,
    CheckoutSessionExpired,
    CheckoutSessionForbidden,
    CheckoutSessionInsufficientBalance,
    CheckoutSessionInvalidMenuItem,
    CheckoutSessionNotFound,
    build_checkout_session_consume_preview,
    build_checkout_session_consume_preview_by_identifier,
    cancel_checkout_session,
    consume_checkout_session,
    create_checkout_session,
    get_checkout_session_by_token,
    get_latest_reusable_checkout_session,
)


def _serialize_consume_preview(preview: CheckoutSessionAccessResult) -> dict:
    cart_snapshot = preview.session.cart_snapshot or {}
    return {
        "checkout_session_id": int(preview.session.pk),
        "token": preview.session.token,
        "cashier_code": preview.session.cashier_code,
        "status": preview.session.status,
        "expires_at": preview.session.expires_at,
        "amount": int(preview.session.amount),
        "total_payable_amount": int(preview.session.amount),
        "subtotal_amount": int(preview.session.subtotal_amount),
        "customer_fee_amount": int(preview.session.customer_fee_amount),
        "business_fee_amount": int(preview.session.business_fee_amount),
        "business_net_amount": int(preview.session.business_net_amount),
        "currency": str(preview.session.currency or "TRY"),
        "item_count": int(preview.session.item_count),
        "business": {
            "id": int(preview.session.business.pk),
            "name": preview.session.business_name,
        },
        "items": list(cart_snapshot.get("items") or []),
        "can_consume": bool(preview.can_consume),
        "failure_reason": str(preview.failure_reason or ""),
        "existing_order_id": preview.existing_order_id,
    }


def _raise_checkout_api_error(exc: Exception, *, request=None):
    def _error_response(*, code: str, message: str, status_code: int, details=None, **extra):
        return error(code, message, status=status_code, request=request, details=details, **extra)

    if isinstance(exc, DjangoValidationError):
        return _error_response(code="checkout_validation_error", message=str(exc), status_code=status.HTTP_400_BAD_REQUEST)
    if isinstance(exc, (ActiveCartNotFound, CartError)):
        return _error_response(code="cart_invalid", message=str(exc), status_code=status.HTTP_400_BAD_REQUEST)
    if isinstance(exc, CheckoutSessionNotFound):
        return _error_response(code="checkout_session_not_found", message=str(exc), status_code=status.HTTP_404_NOT_FOUND)
    if isinstance(exc, (CheckoutSessionForbidden, CheckoutSessionBusinessMismatch)):
        return _error_response(code="checkout_session_forbidden", message=str(exc), status_code=status.HTTP_403_FORBIDDEN)
    if isinstance(exc, (CheckoutSessionInvalidMenuItem, CheckoutSessionInsufficientBalance, CheckoutSessionCancelled)):
        return _error_response(code="checkout_session_invalid", message=str(exc), status_code=status.HTTP_400_BAD_REQUEST)
    if isinstance(exc, CheckoutSessionExpired):
        return _error_response(code="checkout_session_expired", message=str(exc), status_code=status.HTTP_410_GONE)
    if isinstance(exc, CheckoutSessionAlreadyConsumed):
        order_id = getattr(exc, "order_id", None)
        return error("checkout_session_already_consumed", str(exc), status=status.HTTP_409_CONFLICT, request=request, details={"order_id": int(order_id)} if order_id is not None else None)
    if isinstance(exc, CheckoutSessionError):
        return _error_response(code="checkout_session_error", message=str(exc), status_code=status.HTTP_400_BAD_REQUEST)
    raise exc


class CheckoutSessionCreateAPIView(APIView):
    permission_classes = [IsAuthenticated, HasActivePushDevice]
    throttle_classes = [CheckoutSessionCreateThrottle]
    IDEMPOTENCY_SCOPE = "orders.checkout_session_create"

    @staticmethod
    def _fingerprint(*, user_id: int, cart_result) -> str:
        cart = cart_result.cart
        items = [
            {
                "menu_item_id": int(item.get("menu_item_id") or 0),
                "quantity": int(item.get("quantity") or 0),
                "unit_price_amount": int(item.get("unit_price_amount") or 0),
                "line_total_amount": int(item.get("line_total_amount") or 0),
                "sort_order": int(item.get("sort_order") or 0),
            }
            for item in ((cart.snapshot or {}).get("items") or [])
        ]
        material = {
            "scope": "checkout_session_create",
            "user_id": int(user_id),
            "cart_id": int(cart.id),
            "business_id": int(cart.business_id),
            "subtotal_amount": int(cart.subtotal_amount),
            "customer_fee_amount": int(cart.customer_fee_amount),
            "total_amount": int(cart.total_amount),
            "items": items,
        }
        return hashlib.sha256(json.dumps(material, sort_keys=True).encode("utf-8")).hexdigest()

    def check_throttles(self, request):
        if not request.user or not request.user.is_authenticated:
            return super().check_throttles(request)
        idempotency_key = require_idempotency_key(request)
        request.META["CHECKOUT_CREATE_IDEMPOTENCY_KEY"] = idempotency_key
        if IdempotencyRecord.objects.filter(
            user=request.user,
            scope=self.IDEMPOTENCY_SCOPE,
            key=idempotency_key,
        ).only("id").exists():
            return
        return super().check_throttles(request)

    @extend_schema(operation_id="checkout_session_create", request=CheckoutSessionCreateSerializer, responses={201: CheckoutSessionDetailSerializer, 400: ApiErrorEnvelopeSerializer, 409: ApiErrorEnvelopeSerializer}, tags=["checkout"], examples=[CHECKOUT_CREATE_SUCCESS_EXAMPLE, STANDARD_ERROR_EXAMPLE])
    def post(self, request):
        idempotency_key = str(request.META.get("CHECKOUT_CREATE_IDEMPOTENCY_KEY") or "") or require_idempotency_key(request)
        ser = CheckoutSessionCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        existing_record = IdempotencyRecord.objects.filter(
            user=request.user,
            scope=self.IDEMPOTENCY_SCOPE,
            key=idempotency_key,
        ).only("id").exists()

        if existing_record:
            try:
                result = run_idempotent(
                    user=request.user,
                    scope=self.IDEMPOTENCY_SCOPE,
                    key=idempotency_key,
                    request_fingerprint="",
                    action=lambda: (_ for _ in ()).throw(RuntimeError("replay action should not run")),
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
                status=result.status_code,
                headers={"Idempotency-Replayed": "true" if result.is_replay else "false"},
            )

        reusable_session = None
        cart_result = None
        try:
            cart_result = CartService.get_active_cart_with_recalculation(user=request.user)
            request_fingerprint = self._fingerprint(user_id=request.user.pk, cart_result=cart_result)
        except ActiveCartNotFound:
            reusable_session = get_latest_reusable_checkout_session(user=request.user)
            if reusable_session is None:
                return _raise_checkout_api_error(ActiveCartNotFound("Active cart not found"))
            request_fingerprint = hashlib.sha256(
                json.dumps(
                    {
                        "scope": "checkout_session_create",
                        "session_id": int(reusable_session.id),
                        "cart_id": int(reusable_session.cart_id or 0),
                        "amount": int(reusable_session.amount),
                        "total_payable_amount": int(reusable_session.amount),
                        "item_count": int(reusable_session.item_count),
                        "items": (reusable_session.cart_snapshot or {}).get("items") or [],
                    },
                    sort_keys=True,
                ).encode("utf-8")
            ).hexdigest()
        except Exception as exc:
            maybe_response = _raise_checkout_api_error(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        def action():
            try:
                session = reusable_session or create_checkout_session(user=request.user, cart=cart_result.cart)
            except Exception as exc:
                maybe_response = _raise_checkout_api_error(exc, request=request)
                if maybe_response is not None:
                    return maybe_response.status_code, maybe_response.data
                raise
            return status.HTTP_201_CREATED, CheckoutSessionDetailSerializer(session).data

        try:
            result = run_idempotent(
                user=request.user,
                scope=self.IDEMPOTENCY_SCOPE,
                key=idempotency_key,
                request_fingerprint=request_fingerprint,
                action=action,
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

        body = result.body if isinstance(result.body, dict) else {}
        create_audit_log(
            request=request,
            user=request.user,
            action="CHECKOUT_CREATE",
            description="Checkout session create handled.",
            status_code=result.status_code,
            meta={
                "cart_id": int((cart_result.cart.id if cart_result is not None else (reusable_session.cart_id or 0))),
                "business_id": int((cart_result.cart.business_id if cart_result is not None else reusable_session.business_id)),
                "item_count": int(((cart_result.cart.snapshot if cart_result is not None else reusable_session.cart_snapshot) or {}).get("item_count") or 0),
                "checkout_session_id": body.get("id"),
                "checkout_session_token": body.get("token"),
                "idempotency_replay": bool(result.is_replay),
            },
        )

        return Response(
            result.body,
            status=result.status_code,
            headers={"Idempotency-Replayed": "true" if result.is_replay else "false"},
        )


class CheckoutSessionDetailAPIView(APIView):
    permission_classes = [IsAuthenticated, HasActivePushDevice]

    @extend_schema(operation_id="checkout_session_detail", responses={200: CheckoutSessionDetailSerializer, 403: ApiErrorEnvelopeSerializer, 404: ApiErrorEnvelopeSerializer, 410: ApiErrorEnvelopeSerializer}, tags=["checkout"], examples=[STANDARD_ERROR_EXAMPLE])
    def get(self, request, token: str):
        try:
            session = get_checkout_session_by_token(token=token, actor_user=request.user)
        except Exception as exc:
            maybe_response = _raise_checkout_api_error(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        return Response(CheckoutSessionDetailSerializer(session).data, status=status.HTTP_200_OK)


class CheckoutSessionCancelAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="checkout_session_cancel",
        request=None,
        responses={
            200: CheckoutSessionDetailSerializer,
            400: ApiErrorEnvelopeSerializer,
            403: ApiErrorEnvelopeSerializer,
            404: ApiErrorEnvelopeSerializer,
            409: ApiErrorEnvelopeSerializer,
            410: ApiErrorEnvelopeSerializer,
        },
        tags=["checkout"],
        examples=[STANDARD_ERROR_EXAMPLE],
    )
    def post(self, request, token: str):
        try:
            session = cancel_checkout_session(token=token, actor_user=request.user)
        except Exception as exc:
            maybe_response = _raise_checkout_api_error(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        create_audit_log(
            request=request,
            user=request.user,
            action="CHECKOUT_CANCEL",
            description="Checkout session cancelled by user.",
            status_code=status.HTTP_200_OK,
            meta={
                "checkout_session_id": int(session.pk),
                "checkout_session_token": session.token,
                "cart_id": int(session.cart_id or 0),
                "business_id": int(session.business_id),
            },
        )

        return Response(CheckoutSessionDetailSerializer(session).data, status=status.HTTP_200_OK)


class LatestReusableCheckoutSessionAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="checkout_session_latest",
        responses={200: CheckoutSessionDetailSerializer, 404: ApiErrorEnvelopeSerializer},
        tags=["checkout"],
        examples=[STANDARD_ERROR_EXAMPLE],
    )
    def get(self, request):
        session = get_latest_reusable_checkout_session(user=request.user)
        if session is None:
            return error(
                "checkout_session_not_found",
                "Active reusable checkout session not found.",
                status=status.HTTP_404_NOT_FOUND,
                request=request,
            )
        return Response(CheckoutSessionDetailSerializer(session).data, status=status.HTTP_200_OK)


class CheckoutSessionConsumeAPIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [CheckoutSessionConsumeThrottle]

    @extend_schema(operation_id="checkout_session_consume", request=None, responses={200: CheckoutConsumeResponseSerializer, 400: ApiErrorEnvelopeSerializer, 403: ApiErrorEnvelopeSerializer, 404: ApiErrorEnvelopeSerializer, 409: ApiErrorEnvelopeSerializer, 410: ApiErrorEnvelopeSerializer}, tags=["checkout"], examples=[STANDARD_ERROR_EXAMPLE])
    def post(self, request, business_id: int, token: str):
        business = BusinessProfile.objects.filter(id=business_id).first()
        if not business:
            raise NotFound("Business not found.")

        try:
            result = consume_checkout_session(token=token, actor_user=request.user, business_id=business_id)
        except Exception as exc:
            maybe_response = _raise_checkout_api_error(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        response_data = {
            "status": result.session.status,
            "order_id": result.order.id,
            "amount": result.amount,
            "total_charged_amount": result.amount,
            "checkout_session_id": result.session.pk,
        }
        create_audit_log(
            request=request,
            user=request.user,
            action="CHECKOUT_CONSUME",
            description="Checkout session consumed and order paid.",
            status_code=status.HTTP_200_OK,
            meta={
                "business_id": int(business_id),
                "checkout_session_id": int(result.session.pk),
                "order_id": int(result.order.id),
                "amount": int(result.amount),
                "total_charged_amount": int(result.amount),
            },
        )
        out = CheckoutConsumeResponseSerializer(response_data)
        return Response(out.data, status=status.HTTP_200_OK)


class CheckoutSessionConsumePreviewAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="checkout_session_consume_preview", responses={200: CheckoutSessionPreviewResponseSerializer, 400: ApiErrorEnvelopeSerializer, 403: ApiErrorEnvelopeSerializer, 404: ApiErrorEnvelopeSerializer, 410: ApiErrorEnvelopeSerializer}, tags=["checkout"], examples=[STANDARD_ERROR_EXAMPLE])
    def get(self, request, business_id: int, token: str):
        business = BusinessProfile.objects.filter(id=business_id).first()
        if not business:
            raise NotFound("Business not found.")

        try:
            preview: CheckoutSessionAccessResult = build_checkout_session_consume_preview(
                token=token,
                actor_user=request.user,
                business_id=business_id,
            )
        except Exception as exc:
            maybe_response = _raise_checkout_api_error(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        out = CheckoutSessionPreviewResponseSerializer(_serialize_consume_preview(preview))
        return Response(out.data, status=status.HTTP_200_OK)


class CheckoutSessionConsumeLookupAPIView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="checkout_session_consume_lookup",
        responses={200: CheckoutSessionPreviewResponseSerializer, 400: ApiErrorEnvelopeSerializer, 403: ApiErrorEnvelopeSerializer, 404: ApiErrorEnvelopeSerializer, 410: ApiErrorEnvelopeSerializer},
        tags=["checkout"],
        examples=[STANDARD_ERROR_EXAMPLE],
    )
    def get(self, request, business_id: int):
        business = BusinessProfile.objects.filter(id=business_id).first()
        if not business:
            raise NotFound("Business not found.")

        query = str(request.query_params.get("query") or "").strip()
        if not query:
            return error(
                "checkout_session_lookup_invalid",
                "Kasa kodu veya QR bilgisi olmadan doğrulama başlatılamaz.",
                status=status.HTTP_400_BAD_REQUEST,
                request=request,
            )

        try:
            preview = build_checkout_session_consume_preview_by_identifier(
                identifier=query,
                actor_user=request.user,
                business_id=business_id,
            )
        except Exception as exc:
            maybe_response = _raise_checkout_api_error(exc, request=request)
            if maybe_response is not None:
                return maybe_response
            raise

        out = CheckoutSessionPreviewResponseSerializer(_serialize_consume_preview(preview))
        return Response(out.data, status=status.HTTP_200_OK)
