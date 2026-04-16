import { authenticatedApiFetch } from "@/lib/api/authenticated-client";
import { toQueryString } from "@/features/discovery/params";

import type {
  ApiDataEnvelope,
  BusinessCategoryInput,
  BusinessCategoryItem,
  BusinessConsumeHistoryResponse,
  BusinessConsumePreview,
  BusinessConsumeResponse,
  BusinessDashboardSummary,
  BusinessMediaAsset,
  BusinessMediaAssetInput,
  BusinessMenuItem,
  BusinessMenuItemInput,
  BusinessOffer,
  BusinessOfferInput,
  BusinessOrderDetail,
  BusinessProfileOperations,
  BusinessProfilePatchInput,
  BusinessProfilePatchResult,
  ConsumeHistoryFilters,
} from "@/features/business-operations/types";

async function getEnvelopeData<T>(path: string) {
  const response = await authenticatedApiFetch<ApiDataEnvelope<T>>(path);
  return response.data;
}

async function getCollectionData<T>(path: string) {
  const response = await authenticatedApiFetch<unknown>(path);

  if (Array.isArray(response)) {
    return response as T[];
  }

  if (response && typeof response === "object") {
    const record = response as Record<string, unknown>;

    if (Array.isArray(record.data)) {
      return record.data as T[];
    }

    if (Array.isArray(record.results)) {
      return record.results as T[];
    }
  }

  return [] as T[];
}

async function sendJson<TResponse, TPayload>(path: string, method: "POST" | "PATCH" | "PUT", payload: TPayload) {
  return authenticatedApiFetch<TResponse>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function sendDelete(path: string) {
  await authenticatedApiFetch<unknown>(path, {
    method: "DELETE",
  });
}

async function sendFormData<TResponse>(path: string, formData: FormData) {
  return authenticatedApiFetch<TResponse>(path, {
    method: "POST",
    body: formData,
  });
}

export function getBusinessDashboardSummary(businessId: string | number) {
  return getEnvelopeData<BusinessDashboardSummary>(`/api/v1/businesses/${businessId}/operations/dashboard-summary/`);
}

export function getBusinessConsumePreview(businessId: string | number, token: string) {
  return authenticatedApiFetch<BusinessConsumePreview>(`/api/v1/businesses/${businessId}/checkout-sessions/${token}/preview/`);
}

export function consumeBusinessCheckoutSession(businessId: string | number, token: string) {
  return authenticatedApiFetch<BusinessConsumeResponse>(`/api/v1/businesses/${businessId}/checkout-sessions/${token}/consume/`, {
    method: "POST",
    useIdempotencyKey: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export function lookupBusinessCheckoutSession(businessId: string | number, query: string) {
  const search = new URLSearchParams({ query });
  return authenticatedApiFetch<BusinessConsumePreview>(`/api/v1/businesses/${businessId}/checkout-sessions/lookup/?${search.toString()}`);
}

export function getBusinessConsumeHistory(businessId: string | number, filters: ConsumeHistoryFilters) {
  return authenticatedApiFetch<BusinessConsumeHistoryResponse>(`/api/v1/businesses/${businessId}/operations/consume-history/${toQueryString(filters as Record<string, string | number | boolean | null | undefined>)}`);
}

export function getBusinessOrderDetail(businessId: string | number, orderId: string | number) {
  return getEnvelopeData<BusinessOrderDetail>(`/api/v1/businesses/${businessId}/operations/orders/${orderId}/`);
}

export function getBusinessProfileOperations(businessId: string | number) {
  return getEnvelopeData<BusinessProfileOperations>(`/api/v1/businesses/${businessId}/operations/profile/`);
}

export async function updateBusinessProfileOperations(businessId: string | number, input: BusinessProfilePatchInput) {
  const response = await authenticatedApiFetch<ApiDataEnvelope<BusinessProfilePatchResult>>(`/api/v1/businesses/${businessId}/operations/profile/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.data;
}

export function listBusinessCategories(businessId: string | number) {
  return getCollectionData<BusinessCategoryItem>(`/api/v1/businesses/${businessId}/categories/`);
}

export function createBusinessCategory(businessId: string | number, input: BusinessCategoryInput) {
  return sendJson<BusinessCategoryItem, BusinessCategoryInput>(`/api/v1/businesses/${businessId}/categories/`, "POST", input);
}

export function updateBusinessCategory(businessId: string | number, categoryId: string | number, input: Partial<BusinessCategoryInput>) {
  return sendJson<BusinessCategoryItem, Partial<BusinessCategoryInput>>(`/api/v1/businesses/${businessId}/categories/${categoryId}/`, "PATCH", input);
}

export function deleteBusinessCategory(businessId: string | number, categoryId: string | number) {
  return sendDelete(`/api/v1/businesses/${businessId}/categories/${categoryId}/`);
}

export function listBusinessMenuItems(businessId: string | number) {
  return getCollectionData<BusinessMenuItem>(`/api/v1/businesses/${businessId}/menu-items/`);
}

export function createBusinessMenuItem(businessId: string | number, input: BusinessMenuItemInput) {
  return sendJson<BusinessMenuItem, BusinessMenuItemInput>(`/api/v1/businesses/${businessId}/menu-items/`, "POST", input);
}

export function updateBusinessMenuItem(businessId: string | number, menuItemId: string | number, input: Partial<BusinessMenuItemInput>) {
  return sendJson<BusinessMenuItem, Partial<BusinessMenuItemInput>>(`/api/v1/businesses/${businessId}/menu-items/${menuItemId}/`, "PATCH", input);
}

export function deleteBusinessMenuItem(businessId: string | number, menuItemId: string | number) {
  return sendDelete(`/api/v1/businesses/${businessId}/menu-items/${menuItemId}/`);
}

export function listBusinessOffers(businessId: string | number) {
  return getCollectionData<BusinessOffer>(`/api/v1/businesses/${businessId}/offers/`);
}

export function createBusinessOffer(businessId: string | number, input: BusinessOfferInput) {
  return sendJson<BusinessOffer, BusinessOfferInput>(`/api/v1/businesses/${businessId}/offers/`, "POST", input);
}

export function updateBusinessOffer(businessId: string | number, offerId: string | number, input: Partial<BusinessOfferInput>) {
  return sendJson<BusinessOffer, Partial<BusinessOfferInput>>(`/api/v1/businesses/${businessId}/offers/${offerId}/`, "PATCH", input);
}

export function deleteBusinessOffer(businessId: string | number, offerId: string | number) {
  return sendDelete(`/api/v1/businesses/${businessId}/offers/${offerId}/`);
}

export function listBusinessMediaAssets(businessId: string | number) {
  return getCollectionData<BusinessMediaAsset>(`/api/v1/businesses/${businessId}/media/`);
}

export function createBusinessMediaAsset(businessId: string | number, input: BusinessMediaAssetInput) {
  return sendJson<BusinessMediaAsset, BusinessMediaAssetInput>(`/api/v1/businesses/${businessId}/media/`, "POST", input);
}

export function uploadBusinessMediaAsset(businessId: string | number, formData: FormData) {
  return sendFormData<BusinessMediaAsset>(`/api/v1/businesses/${businessId}/media/`, formData);
}

export function updateBusinessMediaAsset(businessId: string | number, mediaAssetId: string | number, input: Partial<BusinessMediaAssetInput>) {
  return sendJson<BusinessMediaAsset, Partial<BusinessMediaAssetInput>>(`/api/v1/businesses/${businessId}/media/${mediaAssetId}/`, "PATCH", input);
}

export function deleteBusinessMediaAsset(businessId: string | number, mediaAssetId: string | number) {
  return sendDelete(`/api/v1/businesses/${businessId}/media/${mediaAssetId}/`);
}
