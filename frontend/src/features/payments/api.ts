import { authenticatedApiFetch } from "@/lib/api/authenticated-client";

import type { PaymentIntent, TopupIntentCreateInput, TopupIntentViewModel } from "@/features/payments/types";

export function createTopupIntent(input: TopupIntentCreateInput) {
  return authenticatedApiFetch<PaymentIntent>("/api/v1/payments/topup/intents/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    useIdempotencyKey: true,
  });
}

export function getTopupIntentDetail(intentId: string | number) {
  return authenticatedApiFetch<PaymentIntent>(`/api/v1/payments/intents/${intentId}/`);
}

export function mapPaymentIntent(intent: PaymentIntent): TopupIntentViewModel {
  const normalized = String(intent.normalized_status || "").trim().toUpperCase();
  const rawStatus = String(intent.status || "").trim().toUpperCase();
  const provider = String(intent.provider || "").trim().toUpperCase();
  const isManualTopup = provider === "MOCK" || normalized.startsWith("MANUAL_");

  let tone: TopupIntentViewModel["statusTone"] = "default";
  let label = "Durum bilgisi hazırlanıyor";

  if (intent.is_settled || normalized === "SETTLED" || normalized === "COMPLETED") {
    tone = "success";
    label = "Bakiyene yansıdı";
  } else if (isManualTopup && normalized === "MANUAL_PENDING") {
    tone = "warning";
    label = "HalkYemek onayi bekliyor";
  } else if (rawStatus === "PAID" || normalized === "SUCCESS" || normalized === "PAID") {
    tone = "warning";
    label = "Ödeme alındı, bakiyeye hazırlanıyor";
  } else if (rawStatus === "FAILED" || normalized === "FAILED") {
    tone = "danger";
    label = "İşlem başarısız";
  } else if (rawStatus === "CANCELLED" || normalized === "CANCELLED") {
    tone = "danger";
    label = "İşlem iptal edildi";
  } else if (!intent.is_processed || rawStatus === "INITIATED" || normalized === "PENDING") {
    tone = "warning";
    label = "İşlem bekliyor";
  } else if (intent.is_processed && !intent.is_settled) {
    tone = "warning";
    label = "Ödeme alındı, yansıtılıyor";
  }

  return {
    id: intent.id,
    provider: intent.provider,
    amount: intent.amount,
    providerPaymentUrl: intent.provider_page_url || null,
    rawStatus,
    normalizedStatus: normalized,
    isProcessed: intent.is_processed,
    processedAt: intent.processed_at,
    processingError: intent.processing_error || null,
    isSettled: intent.is_settled,
    settledAt: intent.settled_at,
    paymentReference: intent.payment_reference || intent.marketplace_conversation_id || `HY-PI-${intent.id}`,
    manualPaymentAccountName: intent.manual_payment_account_name || null,
    manualPaymentIban: intent.manual_payment_iban || null,
    manualPaymentInstructions: Array.isArray(intent.manual_payment_instructions) ? intent.manual_payment_instructions : [],
    isManualTopup,
    createdAt: intent.created_at,
    updatedAt: intent.updated_at,
    statusLabel: label,
    statusTone: tone,
  };
}
