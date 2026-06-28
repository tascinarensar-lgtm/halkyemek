import { authenticatedApiFetch } from "@/lib/api/authenticated-client";
import { toQueryString } from "@/features/discovery/params";
import {
  buildNotificationDeviceInput,
  getBrowserNotificationState,
  showBrowserTestNotification,
  startForegroundMessageListener,
  syncStoredFcmPermissionState,
} from "@/lib/fcm";

import type {
  BrowserNotificationState,
  DeviceUpsertInput,
  DeviceUpsertResponse,
  NotificationListResponse,
  NotificationReadiness,
} from "@/features/notifications/types";

export function getNotificationReadiness() {
  return authenticatedApiFetch<NotificationReadiness>("/api/v1/notifications/readiness/");
}

export function getNotifications(page?: number) {
  return authenticatedApiFetch<NotificationListResponse>(`/api/v1/notifications/${toQueryString({ page } as Record<string, string | number | boolean | null | undefined>)}`);
}

function postDeviceRegistration(input: DeviceUpsertInput) {
  const payload = {
    platform: input.platform,
    fcm_token: input.fcm_token,
    device_id: input.device_id,
    app_version: input.app_version,
    permission_granted: input.permission_granted,
    token: input.fcm_token,
    device_type: input.platform.toLowerCase(),
  };

  return authenticatedApiFetch<DeviceUpsertResponse>("/api/v1/notifications/devices/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function registerDevice() {
  const input = await buildNotificationDeviceInput({ requestPermission: true, allowNoop: false });
  if (!input) {
    throw new Error("Bildirim izni verilmediği için bu cihaz henüz hazır değil.");
  }
  return postDeviceRegistration(input);
}

export async function syncRegisteredDeviceIfPossible() {
  const input = await syncStoredFcmPermissionState();
  if (!input) {
    return null;
  }
  return postDeviceRegistration(input);
}

export function getBrowserPushState(): Promise<BrowserNotificationState> {
  return getBrowserNotificationState();
}

export { showBrowserTestNotification, startForegroundMessageListener };
