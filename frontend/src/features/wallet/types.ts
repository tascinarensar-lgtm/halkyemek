import type { PaginatedResponse } from "@/types/pagination";

export interface WalletDetail {
  user_id: number;
  balance: number;
  pending_balance: number;
  is_active: boolean;
  restriction_reason: string | null;
  restricted_at: string | null;
  ledger_in_sync: boolean;
  pending_ledger_in_sync: boolean;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: number;
  transaction_type: string;
  amount: number;
  before_balance: number;
  after_balance: number;
  order_id: number | null;
  provider_event_id: string | null;
  payment_intent_id: number | null;
  description: string;
  created_at: string;
}

export interface PendingWalletTransaction {
  id: number;
  transaction_type: string;
  amount: number;
  before_pending: number;
  after_pending: number;
  provider_event_id: string | null;
  payment_intent_id: number | null;
  description: string;
  created_at: string;
}

export interface WalletTransactionFilters {
  type?: string;
  payment_intent_id?: string;
  order_id?: string;
  page?: number;
}

export interface PendingWalletTransactionFilters {
  type?: string;
  payment_intent_id?: string;
  page?: number;
}

export type WalletTransactionListResponse = PaginatedResponse<WalletTransaction>;
export type PendingWalletTransactionListResponse = PaginatedResponse<PendingWalletTransaction>;
