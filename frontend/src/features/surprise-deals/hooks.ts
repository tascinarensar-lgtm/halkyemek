"use client";

import { useQuery } from "@tanstack/react-query";

import { getSurpriseDeal, listSurpriseDeals } from "@/features/surprise-deals/api";
import { surpriseDealQueryKeys } from "@/features/surprise-deals/query-keys";

import type { SurpriseDealListParams } from "@/features/surprise-deals/types";

export function useSurpriseDeals(params: SurpriseDealListParams = {}) {
  return useQuery({
    queryKey: surpriseDealQueryKeys.list(params),
    queryFn: () => listSurpriseDeals(params),
    refetchOnMount: "always",
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
}

export function useSurpriseDeal(id: string | number | null | undefined) {
  return useQuery({
    queryKey: surpriseDealQueryKeys.detail(id ?? "pending"),
    queryFn: () => getSurpriseDeal(id ?? ""),
    enabled: id !== null && id !== undefined && String(id).length > 0,
  });
}
