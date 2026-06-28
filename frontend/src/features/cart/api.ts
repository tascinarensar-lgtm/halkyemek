import { authenticatedApiFetch } from "@/lib/api/authenticated-client";
import { ApiClientError } from "@/lib/api/errors";

import type { PaginatedResponse } from "@/types/pagination";
import type { CartDetail, CheckoutSessionDetail, DeviceUpsertResponse, NotificationReadiness } from "@/features/cart/types";

export function getCart() {
  return authenticatedApiFetch<CartDetail>("/api/v1/cart/");
}

export function addCartItem(input: { menu_item_id: number; quantity?: number }) {
  return authenticatedApiFetch<CartDetail>("/api/v1/cart/items/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu_item_id: input.menu_item_id, quantity: input.quantity ?? 1 }),
  });
}

export function updateCartItemQuantity(input: { itemId: number; quantity: number }) {
  return authenticatedApiFetch<CartDetail>(`/api/v1/cart/items/${input.itemId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity: input.quantity }),
  });
}

export function removeCartItem(itemId: number) {
  return authenticatedApiFetch<CartDetail>(`/api/v1/cart/items/${itemId}/`, {
    method: "DELETE",
  });
}

export function clearCart() {
  return authenticatedApiFetch<CartDetail>("/api/v1/cart/clear/", {
    method: "DELETE",
  });
}

export function getCheckoutPreview() {
  return authenticatedApiFetch<CartDetail>("/api/v1/cart/checkout-preview/");
}

export function createCheckoutSession() {
  return authenticatedApiFetch<CheckoutSessionDetail>("/api/v1/checkout-sessions/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    useIdempotencyKey: true,
  });
}

export function listCheckoutSessions(filters: { status?: string; page?: number; page_size?: number } = {}) {
  const search = new URLSearchParams();
  if (filters.status) search.set("status", filters.status);
  if (filters.page) search.set("page", String(filters.page));
  if (filters.page_size) search.set("page_size", String(filters.page_size));
  const query = search.toString();
  return authenticatedApiFetch<PaginatedResponse<CheckoutSessionDetail>>(`/api/v1/checkout-sessions/${query ? `?${query}` : ""}`);
}

export function getCheckoutSession(token: string) {
  return authenticatedApiFetch<CheckoutSessionDetail>(`/api/v1/checkout-sessions/${token}/`);
}

export function cancelCheckoutSession(token: string) {
  return authenticatedApiFetch<CheckoutSessionDetail>(`/api/v1/checkout-sessions/${token}/cancel/`, {
    method: "POST",
  });
}

export async function getLatestCheckoutSession() {
  try {
    return await authenticatedApiFetch<CheckoutSessionDetail>("/api/v1/checkout-sessions/latest/");
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function getNotificationReadiness() {
  return authenticatedApiFetch<NotificationReadiness>("/api/v1/notifications/readiness/");
}

export function registerDevice(input: { platform: string; fcm_token: string; device_id: string; app_version: string; permission_granted: boolean }) {
  return authenticatedApiFetch<DeviceUpsertResponse>("/api/v1/notifications/devices/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
