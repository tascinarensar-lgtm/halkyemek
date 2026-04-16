from rest_framework.views import APIView
from rest_framework.response import Response
from common.permissions import IsAdminRole
from rest_framework import status
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes

from django.utils import timezone
from django.db.models import Q, Count, Sum

from common.drf import enforce_json_content_type
from payouts.models import Payout, BusinessEarning
from payouts.api.serializers import PayoutSerializer
from payouts.services import PayoutService
from payouts.reconciliation import reconcile_business
from logs.services import create_audit_log
from businesses.models import BusinessProfile

from wallets.models import WalletTransaction, PendingWalletTransaction
from payments.models import ProviderEvent, PaymentIntent

class MetricsAPIView(APIView):
    permission_classes = [IsAdminRole]

    @extend_schema(operation_id="ops_payout_metrics", responses={200: OpenApiTypes.OBJECT}, tags=["ops-payouts"])
    def get(self, request):
        data = {
            "counts": {
                "provider_events": ProviderEvent.objects.count(),
                "payment_intents": PaymentIntent.objects.count(),
                "wallet_transactions": WalletTransaction.objects.count(),
                "pending_wallet_transactions": PendingWalletTransaction.objects.count(),
                "payouts_total": Payout.objects.count(),
                "earnings_total": BusinessEarning.objects.count(),
            },
            "payouts_by_status": {
                s: Payout.objects.filter(status=s).count()
                for s in ["CREATED","DISPATCHING","FAILED","SENT","CONFIRMED","CANCELLED"]
            },
        }
        return Response({"ok": True, "data": data}, status=200)
    
class DispatchDuePayoutsAPIView(APIView):
    throttle_scope = "ops"
    permission_classes = [IsAdminRole]

    @extend_schema(operation_id="ops_payout_dispatch_due", request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT}, tags=["ops-payouts"])
    def post(self, request):
        enforce_json_content_type(request)
        limit = int(request.data.get("limit", 50))
        worker = str(request.data.get("worker", "api"))
        n = PayoutService.dispatch_due_payouts(limit=limit, worker_id=worker)
        create_audit_log(
            request=request,
            user=request.user,
            action="PAYOUT_DISPATCH_DUE",
            description="Dispatch due payouts",
            status_code=200,
            meta={"processed": n, "limit": limit, "worker": worker},
        )
        return Response({"ok": True, "data": {"processed": n}}, status=200)

class PayoutListAPIView(APIView):
    throttle_scope = "ops"
    permission_classes = [IsAdminRole]

    @extend_schema(operation_id="ops_payouts_list", responses={200: OpenApiTypes.OBJECT}, tags=["ops-payouts"])
    def get(self, request):
        qs = Payout.objects.all().order_by("-id")[:200]
        return Response({"ok": True, "data": PayoutSerializer(qs, many=True).data}, status=200)

class PayoutDetailAPIView(APIView):
    throttle_scope = "ops"
    permission_classes = [IsAdminRole]

    @extend_schema(operation_id="ops_payouts_detail", responses={200: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-payouts"])
    def get(self, request, payout_id: int):
        p = get_object_or_404(Payout, id=payout_id)
        return Response({"ok": True, "data": PayoutSerializer(p).data}, status=200)
    
class ConfirmPayoutAPIView(APIView):
    throttle_scope = "ops"
    permission_classes = [IsAdminRole]

    @extend_schema(operation_id="ops_payout_confirm", request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-payouts"])
    def post(self, request, payout_id: int):
        enforce_json_content_type(request)
        note = str(request.data.get("note", ""))[:255]
        result = PayoutService.confirm_payout(
            payout_id=payout_id,
            actor=request.user,
            source="manual",
            note=note,
        )

        create_audit_log(
            request=request,
            user=request.user,
            action="PAYOUT_CONFIRM",
            description="Manual payout confirm",
            status_code=200,
            meta={
                "payout_id": payout_id,
                "note": note,
                "changed": bool(result.changed),
                "final_status": result.status,
            },
        )
        return Response(
            {
                "ok": True,
                "data": {
                    "payout_id": int(result.payout_id),
                    "status": result.status,
                    "changed": bool(result.changed),
                },
            },
            status=200,
        )
    
class OpsDashboardAPIView(APIView): #Sistemin genel finansal durumunun anlık özetini verir.
    throttle_scope = "ops"
    permission_classes = [IsAdminRole]

    @extend_schema(operation_id="ops_payout_dashboard", responses={200: OpenApiTypes.OBJECT}, tags=["ops-payouts"])
    def get(self, request):
        now = timezone.now()

        due_qs = Payout.objects.filter(
            Q(status="CREATED") | Q(status="FAILED"),
        ).filter(
            Q(next_retry_at__isnull=True) | Q(next_retry_at__lte=now)
        )

        data = {
            "payouts": {
                "due_to_dispatch": due_qs.count(),
                "failed_total": Payout.objects.filter(status="FAILED").count(),
                "sent_waiting_confirm": Payout.objects.filter(status="SENT").count(),
                "confirmed_total": Payout.objects.filter(status="CONFIRMED").count(),
            },
            "earnings": {
                "pending": BusinessEarning.objects.filter(status="PENDING").count(),
                "eligible": BusinessEarning.objects.filter(status="ELIGIBLE").count(),
                "paid": BusinessEarning.objects.filter(status="PAID").count(),
            },
        }
        return Response({"ok": True, "data": data}, status=200)


class ReconcileBusinessAPIView(APIView): #Belirli bir işletme için detaylı finansal mutabakat (reconciliation) yapar.
    throttle_scope = "ops"
    permission_classes = [IsAdminRole]

    @extend_schema(operation_id="ops_reconcile_business", responses={200: OpenApiTypes.OBJECT, 404: OpenApiTypes.OBJECT}, tags=["ops-payouts"])
    def get(self, request, business_id: int):
        b = get_object_or_404(BusinessProfile, id=business_id)
        rep = reconcile_business(b)
        return Response({"ok": True, "data": {"summary": rep.summary, "issues": rep.issues}}, status=200)
