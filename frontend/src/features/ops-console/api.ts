import { authenticatedApiFetch } from "@/lib/api/authenticated-client";

import type {
  ApiDataEnvelope,
  BroadcastInput,
  EmailBroadcastPayload,
  EmailBroadcastPreviewResponse,
  EmailBroadcastQueueResponse,
  OpsBusinessCreateInput,
  OpsBusinessCreateResponse,
  OpsBusinessDetail,
  OpsBusinessMembership,
  OpsBusinessMembershipUpsertInput,
  OpsBusinessesListResponse,
  OpsBusinessStatusInput,
  OpsDashboardData,
  OpsManualTopupConfirmResponse,
  OpsMetricsData,
  OpsPaymentIntentListResponse,
  OpsSurpriseDealDetailResponse,
  OpsSurpriseDealItem,
  OpsSurpriseDealListResponse,
  PayoutItem,
  ReconcileResponse,
  SettlementDashboardData,
  SettlementImportDetailResponse,
  SettlementImportListResponse,
  SettlementRecordDetailResponse,
  SettlementRecordListResponse,
} from "@/features/ops-console/types";

export type OpsBusinessProduct = "halkyemek" | "halktasarruf";
export type OpsBusinessListParams = {
  product?: OpsBusinessProduct;
  q?: string;
  district?: string;
  is_active?: boolean;
  is_approved?: boolean;
  is_listed?: boolean;
  payout_onboarding_status?: string;
};

function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function getEnvelope<T>(path: string) {
  const response = await authenticatedApiFetch<ApiDataEnvelope<T>>(path);
  return response.data;
}

export const getOpsDashboard = () => getEnvelope<OpsDashboardData>("/api/v1/ops/dashboard/");
export const getOpsMetrics = () => getEnvelope<OpsMetricsData>("/api/v1/ops/metrics/");
export const listOpsPaymentIntents = (params: Record<string, string | number | boolean | undefined | null>) => getEnvelope<OpsPaymentIntentListResponse>(`/api/v1/payments/ops/intents/${qs(params)}`);
export const confirmManualTopup = (intentId: string | number, input: { received_amount?: number; note?: string; idempotency_key?: string }) => authenticatedApiFetch<ApiDataEnvelope<OpsManualTopupConfirmResponse>>(`/api/v1/payments/ops/intents/${intentId}/manual-topup-confirm/`, { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, idempotency_key: input.idempotency_key || `manual-topup-${intentId}-${Date.now()}` }) });
export const listOpsBusinesses = (params: OpsBusinessListParams) => getEnvelope<OpsBusinessesListResponse>(`/api/v1/ops/businesses/${qs(params)}`);
export const createOpsBusiness = (input: OpsBusinessCreateInput) => authenticatedApiFetch<ApiDataEnvelope<OpsBusinessCreateResponse>>("/api/v1/ops/businesses/", { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const getOpsBusinessDetail = (businessId: string | number) => getEnvelope<OpsBusinessDetail>(`/api/v1/ops/businesses/${businessId}/`);
export const listOpsBusinessMemberships = (businessId: string | number) => getEnvelope<OpsBusinessMembership[]>(`/api/v1/ops/businesses/${businessId}/memberships/`);
export const upsertOpsBusinessMembership = (businessId: string | number, input: OpsBusinessMembershipUpsertInput) => authenticatedApiFetch<ApiDataEnvelope<Record<string, unknown>>>(`/api/v1/ops/businesses/${businessId}/memberships/`, { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const deactivateOpsBusinessMembership = (businessId: string | number, userId: number) => authenticatedApiFetch<ApiDataEnvelope<Record<string, unknown>>>(`/api/v1/ops/businesses/${businessId}/memberships/deactivate/`, { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) });
export const updateOpsBusinessStatus = (businessId: string | number, input: OpsBusinessStatusInput) => authenticatedApiFetch<ApiDataEnvelope<Record<string, unknown>>>(`/api/v1/ops/businesses/${businessId}/status/`, { method: "PATCH", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const triggerOpsSubmerchant = (businessId: string | number) => authenticatedApiFetch<Record<string, unknown>>(`/api/v1/ops/businesses/${businessId}/iyzico/submerchant/`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `ops-submerchant-${businessId}-${Date.now()}` }, body: JSON.stringify({}) });
export const listPayouts = () => getEnvelope<PayoutItem[]>("/api/v1/ops/payouts/");
export const getPayoutDetail = (payoutId: string | number) => getEnvelope<PayoutItem>(`/api/v1/ops/payouts/${payoutId}/`);
export const confirmPayout = (payoutId: string | number, note: string) => authenticatedApiFetch<ApiDataEnvelope<Record<string, unknown>>>(`/api/v1/ops/payouts/${payoutId}/confirm/`, { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
export const dispatchPayouts = (limit: number, worker: string) => authenticatedApiFetch<ApiDataEnvelope<Record<string, unknown>>>("/api/v1/ops/payouts/dispatch-due/", { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit, worker }) });
export const getReconcileBusiness = (businessId: string | number) => getEnvelope<ReconcileResponse>(`/api/v1/ops/reconcile/business/${businessId}/`);
export const getSettlementDashboard = () => getEnvelope<SettlementDashboardData>("/api/v1/payments/ops/settlement/dashboard/");
export const listSettlementImports = (params: Record<string, string | number | boolean | undefined | null>) => getEnvelope<SettlementImportListResponse>(`/api/v1/payments/ops/settlement/imports/${qs(params)}`);
export const getSettlementImportDetail = (importId: string | number) => getEnvelope<SettlementImportDetailResponse>(`/api/v1/payments/ops/settlement/imports/${importId}/`);
export const retrySettlementImport = (importId: string | number) => authenticatedApiFetch<ApiDataEnvelope<Record<string, unknown>>>(`/api/v1/payments/ops/settlement/imports/${importId}/retry/`, { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
export async function uploadSettlementFile(file: File) {
  const formData = new FormData();
  formData.set("file", file);
  return authenticatedApiFetch<Record<string, unknown>>("/api/v1/payments/ops/settlement/imports/upload/", { method: "POST", useIdempotencyKey: true, body: formData });
}
export const listSettlementRecords = (params: Record<string, string | number | boolean | undefined | null>) => getEnvelope<SettlementRecordListResponse>(`/api/v1/payments/ops/settlement/records/${qs(params)}`);
export const getSettlementRecordDetail = (recordId: string | number) => getEnvelope<SettlementRecordDetailResponse>(`/api/v1/payments/ops/settlement/records/${recordId}/`);
export const reprocessSettlementRecord = (recordId: string | number) => authenticatedApiFetch<Record<string, unknown>>(`/api/v1/payments/ops/settlement/records/${recordId}/reprocess/`, { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
export const reviewSettlementRecord = (recordId: string | number, input: { review_status?: string; operator_note?: string }) => authenticatedApiFetch<Record<string, unknown>>(`/api/v1/payments/ops/settlement/records/${recordId}/review/`, { method: "PATCH", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const queueBroadcast = (input: BroadcastInput) => authenticatedApiFetch<Record<string, unknown>>("/api/v1/notifications/admin/broadcast/", { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const queueEmailBroadcast = (input: EmailBroadcastPayload) => authenticatedApiFetch<EmailBroadcastPreviewResponse | EmailBroadcastQueueResponse>("/api/v1/notifications/admin/email-broadcast/", { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const listOpsSurpriseDeals = (params: Record<string, string | number | boolean | undefined | null>) => getEnvelope<OpsSurpriseDealListResponse>(`/api/v1/ops/surprise-deals/${qs(params)}`);
export const getOpsSurpriseDealDetail = (dealId: string | number) => getEnvelope<OpsSurpriseDealDetailResponse>(`/api/v1/ops/surprise-deals/${dealId}/`);
export const closeOpsSurpriseDeal = (dealId: string | number) => authenticatedApiFetch<ApiDataEnvelope<OpsSurpriseDealItem>>(`/api/v1/ops/surprise-deals/${dealId}/close/`, { method: "POST", useIdempotencyKey: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
