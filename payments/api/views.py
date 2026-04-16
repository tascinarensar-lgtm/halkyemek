import hashlib
from typing import Iterable

from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from common.permissions import IsAdminRole
from common.throttles import OpsActionThrottle, PaymentCreateThrottle
from common.openapi import ApiErrorEnvelopeSerializer, STANDARD_ERROR_EXAMPLE, TOPUP_INTENT_SUCCESS_EXAMPLE
from common.responses import error
from common.urls import build_external_absolute_url, build_frontend_absolute_url
from health.models import JobHeartbeat
from idempotency.drf import require_idempotency_key
from idempotency.models import IdempotencyRecord
from idempotency.services import IdempotencyConflict, run_idempotent
from logs.services import create_audit_log
from notifications.permissions import HasActivePushDevice
from orders.models import Order
from payments.api.serializers import (
    IyzicoTopupCallbackSerializer,
    OpsChargebackSerializer,
    OpsOrderRefundSerializer,
    OpsReversalResolveSerializer,
    OpsTopupReversalSerializer,
    PaymentIntentSerializer,
    PaymentReversalSerializer,
    SettlementImportSerializer,
    SettlementImportUploadSerializer,
    SettlementRecordReviewSerializer,
    SettlementRecordSerializer,
    TopupPaymentIntentCreateSerializer,
)
from payments.models import PaymentIntent, PaymentReversal, SettlementImport, SettlementRecord
from payments.services import create_topup_payment_intent, finalize_topup_from_retrieval
from payments.services_ingestion import (
    DuplicateSettlementImportError,
    execute_settlement_import,
    retry_settlement_import,
    stage_uploaded_settlement_file,
    summarize_import_execution,
)
from payments.services_reversals import PaymentReversalService
from payments.services_settlement import process_settlement_record
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes


def _validation_messages(exc: DjangoValidationError) -> list[str]:
    messages: list[str] = []

    raw_messages = getattr(exc, "messages", None)
    if isinstance(raw_messages, Iterable) and not isinstance(raw_messages, (str, bytes)):
        messages.extend(str(message).strip() for message in raw_messages if str(message).strip())

    if messages:
        return messages

    message_dict = getattr(exc, "message_dict", None)
    if isinstance(message_dict, dict):
        for values in message_dict.values():
            if isinstance(values, Iterable) and not isinstance(values, (str, bytes)):
                messages.extend(str(value).strip() for value in values if str(value).strip())
            elif str(values).strip():
                messages.append(str(values).strip())

    if messages:
        return messages

    fallback = str(exc).strip()
    return [fallback] if fallback else []


def _present_topup_create_error(exc: DjangoValidationError) -> str:
    joined = " ".join(_validation_messages(exc)).strip()
    normalized = joined.lower()

    if (
        "1001:api bilgileri bulunamadı" in normalized
        or "iyzico.keys_not_configured" in normalized
        or "iyzico.placeholder_keys_not_configured" in normalized
    ):
        return "Bakiye yükleme şu anda başlatılamıyor. Ödeme altyapısının iyzico API bilgileri henüz tanımlı değil."

    if "iyzico.callback_url_https_required" in normalized:
        return "Bakiye yükleme bağlantısı güvenli bir adres üzerinden başlatılmalı."

    if "iyzico.environment_mismatch" in normalized or "iyzico.invalid_base_url" in normalized or "iyzico.invalid_environment" in normalized:
        return "Ödeme altyapısının ortam ayarlarında bir uyumsuzluk var. Lütfen iyzico yapılandırmasını kontrol edin."

    return joined or "Bakiye yükleme adımı şu anda başlatılamadı."


def _stale_cutoff():
    return timezone.now() - timezone.timedelta(seconds=max(int(getattr(settings, "SETTLEMENT_STALE_REVIEW_SECONDS", 48 * 3600) or 0), 3600))


def _is_json_request(request) -> bool:
    content_type = str(getattr(request, "content_type", "") or "").split(";", 1)[0].strip().lower()
    return content_type == "application/json"


def _topup_result_redirect_url(*, intent: PaymentIntent | None, status_code: str) -> str:
    query_params: dict[str, object] = {"status": status_code}
    if intent is not None:
        query_params["intent"] = int(intent.pk)
    return build_frontend_absolute_url(path="/cuzdan/yukle/sonuc", query_params=query_params)


def _settlement_record_summary(qs):
    stale_cutoff = _stale_cutoff()
    return {
        "total": qs.count(),
        "processed": qs.filter(is_processed=True).count(),
        "unprocessed": qs.filter(is_processed=False).count(),
        "open_manual_review": qs.filter(is_processed=False, review_status=SettlementRecord.ReviewStatus.OPEN).count(),
        "retry_scheduled": qs.filter(is_processed=False, review_status=SettlementRecord.ReviewStatus.RETRY_SCHEDULED).count(),
        "stale_manual_review": qs.filter(is_processed=False, unmatched_opened_at__lt=stale_cutoff).count(),
    }


def _import_record_summary(import_record):
    related_qs = SettlementRecord.objects.filter(settlement_import=import_record)
    return {
        "records": _settlement_record_summary(related_qs),
        "errors_preview": list(
            related_qs.filter(is_processed=False).exclude(processing_error="").values_list("processing_error", flat=True)[:5]
        ),
    }


class TopupPaymentIntentCreateAPIView(generics.GenericAPIView):
    permission_classes = [IsAuthenticated, HasActivePushDevice]
    serializer_class = TopupPaymentIntentCreateSerializer
    throttle_classes = [PaymentCreateThrottle]

    IDEMPOTENCY_SCOPE = "payments.topup_intent_create"

    @staticmethod
    def _fingerprint(*, user_id: int, amount: int) -> str:
        material = f"topup_intent_create|user:{int(user_id)}|amount:{int(amount)}"
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    def check_throttles(self, request):
        idempotency_key = require_idempotency_key(request)
        request.META["TOPUP_IDEMPOTENCY_KEY"] = idempotency_key
        if IdempotencyRecord.objects.filter(
            user=request.user,
            scope=self.IDEMPOTENCY_SCOPE,
            key=idempotency_key,
        ).only("id").exists():
            return
        return super().check_throttles(request)

    @extend_schema(operation_id="payment_topup_intent_create", request=TopupPaymentIntentCreateSerializer, responses={201: PaymentIntentSerializer, 400: ApiErrorEnvelopeSerializer, 409: ApiErrorEnvelopeSerializer}, tags=["payments"], examples=[TOPUP_INTENT_SUCCESS_EXAMPLE, STANDARD_ERROR_EXAMPLE])
    def post(self, request, *args, **kwargs):
        idempotency_key = str(request.META.get("TOPUP_IDEMPOTENCY_KEY") or "") or require_idempotency_key(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        amount = int(serializer.validated_data["amount"])
        callback_url = build_external_absolute_url(
            request=request,
            path=reverse("payments:iyzico-topup-callback"),
        )
        request_fingerprint = self._fingerprint(user_id=request.user.pk, amount=amount)

        def action():
            try:
                intent = create_topup_payment_intent(
                    user=request.user,
                    amount=amount,
                    callback_url=callback_url,
                )
            except DjangoValidationError as exc:
                return (
                    status.HTTP_400_BAD_REQUEST,
                    error(
                        "ValidationError",
                        _present_topup_create_error(exc),
                        status=status.HTTP_400_BAD_REQUEST,
                        request=request,
                    ).data,
                )
            return status.HTTP_201_CREATED, PaymentIntentSerializer(intent).data

        try:
            result = run_idempotent(
                user=request.user,
                scope=self.IDEMPOTENCY_SCOPE,
                key=idempotency_key,
                request_fingerprint=request_fingerprint,
                action=action,
            )
        except IdempotencyConflict as exc:
            message = str(exc)
            reason = getattr(exc, "reason", "conflict")
            headers = {"Idempotency-Replayed": "false"}
            if reason == "in_progress":
                headers["Retry-After"] = "2"
            create_audit_log(
                request=request,
                user=request.user,
                action="PAYMENT_TOPUP_INTENT_CREATE_CONFLICT",
                description="Topup intent create idempotency conflict",
                status_code=status.HTTP_409_CONFLICT,
                meta={
                    "idempotency_key": idempotency_key,
                    "scope": self.IDEMPOTENCY_SCOPE,
                    "reason_code": reason,
                    "reason": message,
                },
            )
            return Response(
                error("idempotency_conflict", message, status=status.HTTP_409_CONFLICT, request=request, reason=reason).data,
                status=status.HTTP_409_CONFLICT,
                headers=headers,
            )

        response = Response(
            result.body,
            status=result.status_code,
            headers={"Idempotency-Replayed": "true" if result.is_replay else "false"},
        )
        create_audit_log(
            request=request,
            user=request.user,
            action="PAYMENT_TOPUP_INTENT_CREATE",
            description="Topup intent create processed",
            status_code=int(result.status_code),
            meta={
                "idempotency_key": idempotency_key,
                "scope": self.IDEMPOTENCY_SCOPE,
                "is_replay": bool(result.is_replay),
                "amount": amount,
                "intent_id": result.body.get("id") if isinstance(result.body, dict) else None,
            },
        )
        return response


class MyPaymentIntentDetailAPIView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = PaymentIntentSerializer
    lookup_url_kwarg = "intent_id"

    @extend_schema(operation_id="payment_intent_detail", responses={200: PaymentIntentSerializer, 404: ApiErrorEnvelopeSerializer}, tags=["payments"], examples=[TOPUP_INTENT_SUCCESS_EXAMPLE, STANDARD_ERROR_EXAMPLE])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        return PaymentIntent.objects.filter(user=self.request.user).order_by("-id")


class IyzicoTopupCallbackAPIView(generics.GenericAPIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    serializer_class = IyzicoTopupCallbackSerializer

    @extend_schema(operation_id="payment_iyzico_topup_callback", request=IyzicoTopupCallbackSerializer, responses={200: ApiErrorEnvelopeSerializer, 404: ApiErrorEnvelopeSerializer, 502: ApiErrorEnvelopeSerializer}, tags=["payments"])
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            if not _is_json_request(request):
                return HttpResponseRedirect(_topup_result_redirect_url(intent=None, status_code="invalid_callback"))
            serializer.is_valid(raise_exception=True)
        intent, status_code = finalize_topup_from_retrieval(token=serializer.validated_data["token"])
        if not _is_json_request(request):
            return HttpResponseRedirect(_topup_result_redirect_url(intent=intent, status_code=status_code))
        if intent is None:
            return error(status_code, status_code, status=status.HTTP_404_NOT_FOUND, request=request)
        if status_code == "provider_error":
            payload = error(
                status_code,
                intent.processing_error or "provider callback retrieval failed",
                status=status.HTTP_502_BAD_GATEWAY,
                request=request,
            ).data
            payload["data"] = {"intent": PaymentIntentSerializer(intent).data}
            return Response(payload, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"ok": True, "data": {"status": status_code, "intent": PaymentIntentSerializer(intent).data}}, status=200)


class OpsPaymentReversalListAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_payment_reversal_list", responses={200: OpenApiTypes.OBJECT}, tags=["ops-payments"])
    def get(self, request):
        qs = PaymentReversal.objects.select_related("payment_intent", "order", "provider_event").order_by("-id")
        reversal_type = str(request.query_params.get("reversal_type") or "").strip()
        status_value = str(request.query_params.get("status") or "").strip()
        if reversal_type:
            qs = qs.filter(reversal_type=reversal_type)
        if status_value:
            qs = qs.filter(status=status_value)
        if request.query_params.get("payment_intent_id"):
            qs = qs.filter(payment_intent_id=request.query_params["payment_intent_id"])
        if request.query_params.get("order_id"):
            qs = qs.filter(order_id=request.query_params["order_id"])
        data = PaymentReversalSerializer(qs[:100], many=True).data
        return Response({"ok": True, "data": {"count": len(data), "results": data}}, status=status.HTTP_200_OK)


class OpsPaymentReversalResolveAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_payment_reversal_resolve", request=OpsReversalResolveSerializer, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-payments"])
    def post(self, request, reversal_id: int):
        reversal = get_object_or_404(PaymentReversal, id=reversal_id)
        serializer = OpsReversalResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        try:
            result = PaymentReversalService.resolve_manual_review(reversal=reversal)
        except DjangoValidationError as exc:
            return Response(
                {"ok": False, "error": {"code": "reversal_resolution_invalid", "message": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        create_audit_log(
            request=request,
            user=request.user,
            action="PAYMENT_REVERSAL_RESOLVE_OPS",
            description="Ops resolved reversal manual review",
            status_code=status.HTTP_200_OK,
            meta={
                "reversal_id": result.reversal.id,
                "status": result.reversal.status,
                "review_status": result.reversal.review_status,
                "outstanding_exposure_amount": int(result.reversal.outstanding_exposure_amount or 0),
                "note": payload.get("note") or "",
            },
        )
        return Response({"ok": True, "data": {"reversal": PaymentReversalSerializer(result.reversal).data}}, status=status.HTTP_200_OK)


class OpsOrderRefundAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_order_refund", request=OpsOrderRefundSerializer, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-payments"])
    def post(self, request, order_id: int):
        order = get_object_or_404(Order, id=order_id)
        serializer = OpsOrderRefundSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        try:
            result = PaymentReversalService.apply_order_refund(
                order=order,
                amount=int(payload["amount"]),
                reason_code=payload.get("reason_code") or "ORDER_REFUND",
                note=payload.get("note") or "",
                idempotency_key=payload.get("idempotency_key") or None,
            )
        except DjangoValidationError as exc:
            return Response(
                {"ok": False, "error": {"code": "order_refund_invalid", "message": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        create_audit_log(
            request=request,
            user=request.user,
            action="ORDER_REFUND_OPS",
            description="Ops applied order refund",
            status_code=status.HTTP_200_OK,
            meta={
                "order_id": order.id,
                "reversal_id": result.reversal.id,
                "amount": int(payload["amount"]),
                "business_mode": result.business_mode,
                "payout_adjustment_id": result.payout_adjustment_id,
            },
        )
        return Response(
            {
                "ok": True,
                "data": {
                    "reversal": PaymentReversalSerializer(result.reversal).data,
                    "business_mode": result.business_mode,
                    "payout_adjustment_id": result.payout_adjustment_id,
                },
            },
            status=status.HTTP_200_OK,
        )


class OpsTopupReversalAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_topup_reversal", request=OpsTopupReversalSerializer, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-payments"])
    def post(self, request, intent_id: int):
        intent = get_object_or_404(PaymentIntent, id=intent_id)
        serializer = OpsTopupReversalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        try:
            result = PaymentReversalService.apply_topup_reversal(
                payment_intent=intent,
                amount=int(payload["amount"]),
                reason_code=payload.get("reason_code") or "TOPUP_REVERSAL",
                note=payload.get("note") or "",
                idempotency_key=payload.get("idempotency_key") or None,
            )
        except DjangoValidationError as exc:
            return Response(
                {"ok": False, "error": {"code": "topup_reversal_invalid", "message": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        create_audit_log(
            request=request,
            user=request.user,
            action="TOPUP_REVERSAL_OPS",
            description="Ops applied topup reversal",
            status_code=status.HTTP_200_OK,
            meta={
                "payment_intent_id": intent.id,
                "reversal_id": result.reversal.id,
                "amount": int(payload["amount"]),
                "status": result.reversal.status,
                "failure_reason": result.reversal.failure_reason,
            },
        )
        return Response({"ok": True, "data": {"reversal": PaymentReversalSerializer(result.reversal).data}}, status=status.HTTP_200_OK)


class OpsChargebackAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_chargeback", request=OpsChargebackSerializer, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-payments"])
    def post(self, request):
        serializer = OpsChargebackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        try:
            if payload["source"] == "order":
                order = get_object_or_404(Order, id=payload["order_id"])
                result = PaymentReversalService.apply_order_chargeback(
                    order=order,
                    amount=int(payload["amount"]),
                    note=payload.get("note") or "",
                    idempotency_key=payload.get("idempotency_key") or None,
                )
                meta = {"order_id": order.id, "payment_intent_id": None}
            else:
                intent = get_object_or_404(PaymentIntent, id=payload["payment_intent_id"])
                result = PaymentReversalService.apply_chargeback(
                    payment_intent=intent,
                    amount=int(payload["amount"]),
                    note=payload.get("note") or "",
                    idempotency_key=payload.get("idempotency_key") or None,
                )
                meta = {"order_id": None, "payment_intent_id": intent.id}
        except DjangoValidationError as exc:
            return Response(
                {"ok": False, "error": {"code": "chargeback_invalid", "message": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        create_audit_log(
            request=request,
            user=request.user,
            action="CHARGEBACK_OPS",
            description="Ops registered chargeback",
            status_code=status.HTTP_200_OK,
            meta={
                **meta,
                "reversal_id": result.reversal.id,
                "amount": int(payload["amount"]),
                "business_mode": result.business_mode,
                "payout_adjustment_id": result.payout_adjustment_id,
                "status": result.reversal.status,
                "failure_reason": result.reversal.failure_reason,
            },
        )
        return Response(
            {
                "ok": True,
                "data": {
                    "reversal": PaymentReversalSerializer(result.reversal).data,
                    "business_mode": result.business_mode,
                    "payout_adjustment_id": result.payout_adjustment_id,
                },
            },
            status=status.HTTP_200_OK,
        )


class OpsSettlementImportUploadAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_settlement_import_upload", request=SettlementImportUploadSerializer, responses={201: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT}, tags=["ops-settlement"])
    def post(self, request):
        serializer = SettlementImportUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]
        try:
            import_record = stage_uploaded_settlement_file(
                uploaded_file=upload,
                provider=SettlementImport.Provider.IYZICO,
                imported_by=request.user,
                imported_by_label=request.user.username,
                source_metadata={"channel": "ops_api"},
            )
            summary = execute_settlement_import(import_record)
        except DuplicateSettlementImportError as exc:
            existing = exc.existing_import
            create_audit_log(
                request=request,
                user=request.user,
                action="SETTLEMENT_IMPORT_UPLOAD_DUPLICATE",
                description="Settlement import upload rejected as duplicate",
                status_code=status.HTTP_409_CONFLICT,
                meta={"filename": upload.name, "existing_import_id": existing.id, "checksum": existing.checksum_sha256},
            )
            return Response(
                {
                    "ok": False,
                    "error": {"code": "duplicate_file", "message": str(exc)},
                    "data": {"existing_import": SettlementImportSerializer(existing).data},
                },
                status=status.HTTP_409_CONFLICT,
            )
        except Exception as exc:
            create_audit_log(
                request=request,
                user=request.user,
                action="SETTLEMENT_IMPORT_UPLOAD_FAILED",
                description="Settlement import upload failed",
                status_code=status.HTTP_400_BAD_REQUEST,
                meta={"filename": upload.name, "error": str(exc)},
            )
            return Response(
                {"ok": False, "error": {"code": "settlement_import_failed", "message": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        create_audit_log(
            request=request,
            user=request.user,
            action="SETTLEMENT_IMPORT_UPLOAD",
            description="Settlement import uploaded and executed",
            status_code=status.HTTP_201_CREATED,
            meta={
                "import_id": import_record.id,
                "checksum": import_record.checksum_sha256,
                "filename": upload.name,
                "processed": summary.processed,
                "unmatched": summary.unmatched,
                "errors": summary.errors,
            },
        )
        import_record.refresh_from_db()
        return Response(
            {
                "ok": True,
                "data": {
                    "import": SettlementImportSerializer(import_record).data,
                    "summary": summarize_import_execution(summary),
                },
            },
            status=status.HTTP_201_CREATED,
        )


class OpsSettlementImportListAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_settlement_import_list", responses={200: OpenApiTypes.OBJECT}, tags=["ops-settlement"])
    def get(self, request):
        qs = SettlementImport.objects.order_by("-id")
        if request.query_params.get("applied_status"):
            qs = qs.filter(applied_status=request.query_params["applied_status"])
        if request.query_params.get("parse_status"):
            qs = qs.filter(parse_status=request.query_params["parse_status"])
        if request.query_params.get("source_type"):
            qs = qs.filter(source_type=request.query_params["source_type"])
        if request.query_params.get("checksum_sha256"):
            qs = qs.filter(checksum_sha256=str(request.query_params["checksum_sha256"]).strip().lower())
        if request.query_params.get("has_unmatched") in {"true", "false"}:
            want_unmatched = request.query_params["has_unmatched"] == "true"
            qs = qs.exclude(unmatched_records=0) if want_unmatched else qs.filter(unmatched_records=0)
        page = qs[:100]
        data = SettlementImportSerializer(page, many=True).data
        summary = {
            "count": qs.count(),
            "failed": qs.filter(applied_status=SettlementImport.AppliedStatus.FAILED).count(),
            "applied": qs.filter(applied_status=SettlementImport.AppliedStatus.APPLIED).count(),
            "with_unmatched": qs.exclude(unmatched_records=0).count(),
        }
        return Response({"ok": True, "data": {"count": len(data), "results": data, "summary": summary}}, status=status.HTTP_200_OK)


class OpsSettlementImportDetailAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_settlement_import_detail", responses={200: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-settlement"])
    def get(self, request, import_id: int):
        import_record = get_object_or_404(SettlementImport, id=import_id)
        recent_records = SettlementRecord.objects.filter(settlement_import=import_record).order_by("id")[:50]
        return Response(
            {
                "ok": True,
                "data": {
                    "import": SettlementImportSerializer(import_record).data,
                    "records_preview": SettlementRecordSerializer(recent_records, many=True).data,
                    "record_summary": _import_record_summary(import_record),
                },
            },
            status=status.HTTP_200_OK,
        )


class OpsSettlementImportRetryAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_settlement_import_retry", request=None, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-settlement"])
    def post(self, request, import_id: int):
        import_record = get_object_or_404(SettlementImport, id=import_id)
        try:
            summary = retry_settlement_import(import_record)
        except Exception as exc:
            return Response(
                {"ok": False, "error": {"code": "settlement_import_retry_failed", "message": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        import_record.refresh_from_db()
        create_audit_log(
            request=request,
            user=request.user,
            action="SETTLEMENT_IMPORT_RETRY",
            description="Settlement import retried",
            status_code=status.HTTP_200_OK,
            meta={"import_id": import_record.id, **summary.__dict__},
        )
        return Response({"ok": True, "data": {"import": SettlementImportSerializer(import_record).data, "summary": summarize_import_execution(summary), "record_summary": _import_record_summary(import_record)}}, status=status.HTTP_200_OK)


class OpsSettlementRecordListAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_settlement_record_list", responses={200: OpenApiTypes.OBJECT}, tags=["ops-settlement"])
    def get(self, request):
        qs = SettlementRecord.objects.select_related("settlement_import", "payment_intent", "payout", "business").order_by("-id")
        if request.query_params.get("import_id"):
            qs = qs.filter(settlement_import_id=request.query_params["import_id"])
        if request.query_params.get("review_status"):
            qs = qs.filter(review_status=request.query_params["review_status"])
        if request.query_params.get("match_type"):
            qs = qs.filter(match_type=request.query_params["match_type"])
        if request.query_params.get("unmatched_reason_code"):
            qs = qs.filter(unmatched_reason_code=request.query_params["unmatched_reason_code"])
        if request.query_params.get("is_processed") in {"true", "false"}:
            qs = qs.filter(is_processed=request.query_params["is_processed"] == "true")
        if request.query_params.get("stale") in {"true", "false"}:
            stale = request.query_params["stale"] == "true"
            cutoff = _stale_cutoff()
            qs = qs.filter(is_processed=False, unmatched_opened_at__lt=cutoff) if stale else qs.exclude(is_processed=False, unmatched_opened_at__lt=cutoff)
        page = qs[:100]
        data = SettlementRecordSerializer(page, many=True).data
        return Response({"ok": True, "data": {"count": len(data), "results": data, "summary": _settlement_record_summary(qs)}}, status=status.HTTP_200_OK)


class OpsSettlementRecordDetailAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_settlement_record_detail", responses={200: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-settlement"])
    def get(self, request, record_id: int):
        record = get_object_or_404(SettlementRecord, id=record_id)
        return Response({"ok": True, "data": {"record": SettlementRecordSerializer(record).data, "operator_flags": {"stale_manual_review": bool(not record.is_processed and record.unmatched_opened_at and record.unmatched_opened_at < _stale_cutoff()), "can_reprocess": bool(not record.is_processed), "can_review": True}}}, status=status.HTTP_200_OK)


class OpsSettlementRecordReprocessAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_settlement_record_reprocess", request=None, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-settlement"])
    def post(self, request, record_id: int):
        record = get_object_or_404(SettlementRecord, id=record_id)
        record.review_status = SettlementRecord.ReviewStatus.RETRY_SCHEDULED
        record.last_reviewed_at = timezone.now()
        record.save(update_fields=["review_status", "last_reviewed_at", "updated_at"])
        try:
            processed = process_settlement_record(record)
        except Exception as exc:
            record.refresh_from_db()
            create_audit_log(
                request=request,
                user=request.user,
                action="SETTLEMENT_RECORD_REPROCESS_FAILED",
                description="Settlement record manual reprocess failed",
                status_code=status.HTTP_400_BAD_REQUEST,
                meta={"record_id": record.id, "error": str(exc)},
            )
            return Response(
                {
                    "ok": False,
                    "error": {"code": "settlement_record_reprocess_failed", "message": str(exc)},
                    "data": SettlementRecordSerializer(record).data,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        record.refresh_from_db()
        create_audit_log(
            request=request,
            user=request.user,
            action="SETTLEMENT_RECORD_REPROCESS",
            description="Settlement record manually reprocessed",
            status_code=status.HTTP_200_OK,
            meta={"record_id": record.id, "processed": bool(processed), "review_status": record.review_status},
        )
        return Response({"ok": True, "data": {"processed": bool(processed), "record": SettlementRecordSerializer(record).data, "next_action": "resolved" if record.is_processed else "manual_review"}}, status=status.HTTP_200_OK)


class OpsSettlementRecordReviewAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_settlement_record_review", request=SettlementRecordReviewSerializer, responses={200: OpenApiTypes.OBJECT, 400: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-settlement"])
    def patch(self, request, record_id: int):
        record = get_object_or_404(SettlementRecord, id=record_id)
        serializer = SettlementRecordReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        if "operator_note" in payload:
            record.operator_note = payload["operator_note"]
        if "review_status" in payload:
            record.review_status = payload["review_status"]
        record.last_reviewed_at = timezone.now()
        record.save(update_fields=["operator_note", "review_status", "last_reviewed_at", "updated_at"])
        create_audit_log(
            request=request,
            user=request.user,
            action="SETTLEMENT_RECORD_REVIEW",
            description="Settlement record review updated",
            status_code=status.HTTP_200_OK,
            meta={"record_id": record.id, "review_status": record.review_status},
        )
        return Response({"ok": True, "data": {"record": SettlementRecordSerializer(record).data, "operator_flags": {"stale_manual_review": bool(not record.is_processed and record.unmatched_opened_at and record.unmatched_opened_at < _stale_cutoff()), "can_reprocess": bool(not record.is_processed), "can_review": True}}}, status=status.HTTP_200_OK)


class OpsSettlementDashboardAPIView(APIView):
    permission_classes = [IsAdminRole]
    throttle_classes = [OpsActionThrottle]

    @extend_schema(operation_id="ops_settlement_dashboard", responses={200: OpenApiTypes.OBJECT}, tags=["ops-settlement"])
    def get(self, request):
        latest_import = SettlementImport.objects.order_by("-id").first()
        payout_sync = JobHeartbeat.objects.filter(job_name="sync_sent_payout_statuses").first()
        settlement_reprocess = JobHeartbeat.objects.filter(job_name="reprocess_unmatched_settlement_records").first()
        settlement_import = JobHeartbeat.objects.filter(job_name="import_iyzico_settlement").first()
        record_qs = SettlementRecord.objects.all()
        stale_cutoff = _stale_cutoff()
        data = {
            "imports_total": SettlementImport.objects.count(),
            "imports_failed": SettlementImport.objects.filter(applied_status=SettlementImport.AppliedStatus.FAILED).count(),
            "imports_applied": SettlementImport.objects.filter(applied_status=SettlementImport.AppliedStatus.APPLIED).count(),
            "records_total": record_qs.count(),
            "records_unmatched_open": record_qs.filter(is_processed=False, review_status=SettlementRecord.ReviewStatus.OPEN).count(),
            "records_failed": record_qs.filter(is_processed=False).count(),
            "records_processed": record_qs.filter(is_processed=True).count(),
            "records_stale_manual_review": record_qs.filter(is_processed=False, unmatched_opened_at__lt=stale_cutoff).count(),
            "latest_import": SettlementImportSerializer(latest_import).data if latest_import else None,
            "latest_import_record_summary": _import_record_summary(latest_import) if latest_import else None,
            "heartbeats": {
                "payout_sync": {"status": getattr(payout_sync, "status", None), "updated_at": getattr(payout_sync, "updated_at", None), "meta": getattr(payout_sync, "meta", None)},
                "settlement_reprocess": {"status": getattr(settlement_reprocess, "status", None), "updated_at": getattr(settlement_reprocess, "updated_at", None), "meta": getattr(settlement_reprocess, "meta", None)},
                "settlement_import": {"status": getattr(settlement_import, "status", None), "updated_at": getattr(settlement_import, "updated_at", None), "meta": getattr(settlement_import, "meta", None)},
            },
        }
        return Response({"ok": True, "data": data}, status=status.HTTP_200_OK)
