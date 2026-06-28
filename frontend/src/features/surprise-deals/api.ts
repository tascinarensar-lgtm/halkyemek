import { authenticatedApiFetch } from "@/lib/api/authenticated-client";
import { publicApiFetch } from "@/lib/api/public-client";
import { toQueryString } from "@/features/discovery/params";

import type {
  CreateSurpriseDealPayload,
  SurpriseDealBusiness,
  SurpriseDealCheckoutPayload,
  SurpriseDealCheckoutSessionResponse,
  SurpriseDealListParams,
  SurpriseDealListResponse,
  SurpriseDealPublic,
  UpdateSurpriseDealPayload,
} from "@/features/surprise-deals/types";

export function listSurpriseDeals(params: SurpriseDealListParams = {}) {
  return publicApiFetch<SurpriseDealListResponse<SurpriseDealPublic>>(
    `/api/v1/surprise-deals/${toQueryString(params as Record<string, string | number | boolean | null | undefined>)}`,
  );
}

export function getSurpriseDeal(id: string | number) {
  return publicApiFetch<SurpriseDealPublic>(`/api/v1/surprise-deals/${id}/`);
}

export function createSurpriseDealCheckoutSession(id: string | number, payload: SurpriseDealCheckoutPayload = {}) {
  return authenticatedApiFetch<SurpriseDealCheckoutSessionResponse>(`/api/v1/surprise-deals/${id}/checkout-session/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    useIdempotencyKey: true,
  });
}

export function listBusinessSurpriseDeals(businessId: string | number) {
  return authenticatedApiFetch<SurpriseDealListResponse<SurpriseDealBusiness>>(`/api/v1/businesses/${businessId}/surprise-deals/`);
}

export function createBusinessSurpriseDeal(businessId: string | number, payload: CreateSurpriseDealPayload) {
  return authenticatedApiFetch<SurpriseDealBusiness>(`/api/v1/businesses/${businessId}/surprise-deals/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateBusinessSurpriseDeal(businessId: string | number, dealId: string | number, payload: UpdateSurpriseDealPayload) {
  return authenticatedApiFetch<SurpriseDealBusiness>(`/api/v1/businesses/${businessId}/surprise-deals/${dealId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function closeBusinessSurpriseDeal(businessId: string | number, dealId: string | number) {
  return authenticatedApiFetch<SurpriseDealBusiness>(`/api/v1/businesses/${businessId}/surprise-deals/${dealId}/close/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function deleteBusinessSurpriseDeal(businessId: string | number, dealId: string | number) {
  return authenticatedApiFetch<void>(`/api/v1/businesses/${businessId}/surprise-deals/${dealId}/`, {
    method: "DELETE",
  });
}
