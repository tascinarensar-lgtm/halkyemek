import type { PaginatedResponse } from "@/types/pagination";

export type BrowserNotificationEnvironment =
  | "standard"
  | "in_app_browser"
  | "ios_home_screen_required"
  | "unsupported";

export interface NotificationReadiness {
  notification_ready: boolean;
  bypass_applied?: boolean;
  code?: string;
  message?: string;
  active_device_count: number;
  active_permitted_device_count?: number;
  inactive_device_count?: number;
  denied_permission_device_count?: number;
}

export interface BrowserNotificationState {
  supported: boolean;
  configured: boolean;
  secureContext: boolean;
  permission: NotificationPermission | "unsupported";
  hasStoredToken: boolean;
  environment?: BrowserNotificationEnvironment;
  browserLabel?: string;
  hostAppLabel?: string;
  recommendedBrowserLabel?: string;
  isAppleMobile?: boolean;
  isStandalone?: boolean;
}

export interface DeviceUpsertInput {
  platform: string;
  fcm_token: string;
  device_id: string;
  app_version: string;
  permission_granted: boolean;
}

export interface DeviceUpsertResponse {
  id: number;
  platform: string;
  permission_granted: boolean;
  is_active: boolean;
  token_rotated_deactivated_count: number;
  notification_readiness: NotificationReadiness;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
}

export type NotificationListResponse = PaginatedResponse<NotificationItem>;
