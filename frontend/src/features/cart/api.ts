import { authenticatedApiFetch } from "@/lib/api/authenticated-client";

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

export function getCheckoutSession(token: string) {
  return authenticatedApiFetch<CheckoutSessionDetail>(`/api/v1/checkout-sessions/${token}/`);
}

export function cancelCheckoutSession(token: string) {
  return authenticatedApiFetch<CheckoutSessionDetail>(`/api/v1/checkout-sessions/${token}/cancel/`, {
    method: "POST",
  });
}

export function getLatestCheckoutSession() {
  return authenticatedApiFetch<CheckoutSessionDetail>("/api/v1/checkout-sessions/latest/");
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
