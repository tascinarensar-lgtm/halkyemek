import { authenticatedApiFetch } from "@/lib/api/authenticated-client";
import { toQueryString } from "@/features/discovery/params";

import type {
  PendingWalletTransactionFilters,
  PendingWalletTransactionListResponse,
  WalletDetail,
  WalletTransactionFilters,
  WalletTransactionListResponse,
} from "@/features/wallet/types";

export function getWalletDetail() {
  return authenticatedApiFetch<WalletDetail>("/api/v1/wallet/");
}

export function getWalletTransactions(filters: WalletTransactionFilters) {
  return authenticatedApiFetch<WalletTransactionListResponse>(`/api/v1/wallet/transactions/${toQueryString(filters as Record<string, string | number | boolean | null | undefined>)}`);
}

export function getPendingWalletTransactions(filters: PendingWalletTransactionFilters) {
  return authenticatedApiFetch<PendingWalletTransactionListResponse>(`/api/v1/wallet/pending-transactions/${toQueryString(filters as Record<string, string | number | boolean | null | undefined>)}`);
}
