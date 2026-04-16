export interface PaymentIntent {
  id: number;
  provider: string;
  purpose: string;
  amount: number;
  status: string;
  provider_payment_id: string | null;
  provider_session_token: string;
  provider_page_url: string;
  normalized_status: string;
  is_processed: boolean;
  processed_at: string | null;
  processing_error: string;
  is_settled: boolean;
  settled_at: string | null;
  marketplace_conversation_id: string;
  created_at: string;
  updated_at: string;
}

export interface TopupIntentCreateInput {
  amount: number;
}

export interface TopupIntentViewModel {
  id: number;
  provider: string;
  amount: number;
  providerPaymentUrl: string | null;
  rawStatus: string;
  normalizedStatus: string;
  isProcessed: boolean;
  processedAt: string | null;
  processingError: string | null;
  isSettled: boolean;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusLabel: string;
  statusTone: "default" | "success" | "warning" | "danger";
}
