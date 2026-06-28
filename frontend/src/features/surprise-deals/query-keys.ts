import type { SurpriseDealListParams } from "@/features/surprise-deals/types";

function normalizeListParams(params: SurpriseDealListParams = {}) {
  return {
    district: params.district ?? "",
    business: params.business == null ? "" : String(params.business),
    ordering: params.ordering ?? "pickup_window_start",
  };
}

export const surpriseDealQueryKeys = {
  all: ["surprise-deals"] as const,
  list: (params: SurpriseDealListParams = {}) => [...surpriseDealQueryKeys.all, "list", normalizeListParams(params)] as const,
  detail: (id: string | number) => [...surpriseDealQueryKeys.all, "detail", String(id)] as const,
  businessList: (businessId: string | number) => [...surpriseDealQueryKeys.all, "business", String(businessId)] as const,
};
