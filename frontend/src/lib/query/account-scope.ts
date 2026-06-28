import type { QueryClient } from "@tanstack/react-query";

const ACCOUNT_SCOPED_QUERY_KEYS = [
  ["cart"],
  ["checkout-session"],
  ["checkout-sessions"],
  ["discovery"],
  ["notifications"],
  ["orders"],
  ["topup"],
  ["wallet"],
] as const;

export function clearAccountScopedQueries(queryClient: QueryClient) {
  for (const queryKey of ACCOUNT_SCOPED_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey });
  }
}
