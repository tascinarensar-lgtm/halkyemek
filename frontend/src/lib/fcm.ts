"use client";

import { getMessaging, getToken, isSupported, onMessage, type MessagePayload } from "firebase/messaging";

import type { BrowserNotificationState, DeviceUpsertInput } from "@/features/notifications/types";
import { getFirebaseClientApp, getFirebaseMessagingClientConfig } from "@/lib/firebase";

const APP_VERSION = "frontend-web";
const DEVICE_ID_STORAGE_KEY = "hy:notifications:device-id";
const FCM_TOKEN_STORAGE_KEY = "hy:notifications:fcm-token";
const SERVICE_WORKER_URL = "/firebase-messaging-sw.js";

export interface NotificationDeviceInputResult extends DeviceUpsertInput {
  permission: NotificationPermission;
  tokenSource: "fcm" | "stored";
}

let supportPromise: Promise<boolean> | null = null;

function getRuntimeState() {
  if (typeof window === "undefined") {
    return {
      environment: "unsupported" as const,
      browserLabel: "",
      hostAppLabel: "",
      recommendedBrowserLabel: "",
      isAppleMobile: false,
      isStandalone: false,
    };
  }

  const userAgent = window.navigator.userAgent.toLowerCase();
  const isAppleMobile = /iphone|ipad|ipod/.test(userAgent);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches === true
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

  let hostAppLabel = "";
  if (userAgent.includes("instagram")) {
    hostAppLabel = "Instagram";
  } else if (userAgent.includes("fb_iab") || userAgent.includes("fban") || userAgent.includes("fbav")) {
    hostAppLabel = "Facebook";
  } else if (userAgent.includes("messenger")) {
    hostAppLabel = "Messenger";
  } else if (userAgent.includes("tiktok") || userAgent.includes("musical_ly")) {
    hostAppLabel = "TikTok";
  } else if (userAgent.includes("gsa/")) {
    hostAppLabel = "Google";
  } else if (userAgent.includes("; wv")) {
    hostAppLabel = "uygulama içi tarayıcı";
  }

  let browserLabel = "Tarayıcı";
  if (userAgent.includes("edg/")) {
    browserLabel = "Edge";
  } else if (userAgent.includes("crios") || userAgent.includes("chrome")) {
    browserLabel = "Chrome";
  } else if (userAgent.includes("fxios") || userAgent.includes("firefox")) {
    browserLabel = "Firefox";
  } else if (userAgent.includes("safari")) {
    browserLabel = "Safari";
  }

  const recommendedBrowserLabel = isAppleMobile ? "Safari" : "Chrome";

  if (hostAppLabel) {
    return {
      environment: "in_app_browser" as const,
      browserLabel,
      hostAppLabel,
      recommendedBrowserLabel,
      isAppleMobile,
      isStandalone,
    };
  }

  if (isAppleMobile && !isStandalone) {
    return {
      environment: "ios_home_screen_required" as const,
      browserLabel,
      hostAppLabel,
      recommendedBrowserLabel,
      isAppleMobile,
      isStandalone,
    };
  }

  return {
    environment: "standard" as const,
    browserLabel,
    hostAppLabel,
    recommendedBrowserLabel,
    isAppleMobile,
    isStandalone,
  };
}

function ensureBrowserEnvironment() {
  if (typeof window === "undefined") {
    throw new Error("Bildirim ayarları yalnızca tarayıcıda hazırlanabilir.");
  }
}

function getStoredValue(key: string) {
  ensureBrowserEnvironment();
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function setStoredValue(key: string, value: string) {
  ensureBrowserEnvironment();
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage erisimi yoksa akis calismaya devam etsin.
  }
}

function removeStoredValue(key: string) {
  ensureBrowserEnvironment();
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage erisimi yoksa akis calismaya devam etsin.
  }
}

function getStoredFcmToken() {
  return getStoredValue(FCM_TOKEN_STORAGE_KEY);
}

function setStoredFcmToken(token: string) {
  setStoredValue(FCM_TOKEN_STORAGE_KEY, token);
}

function getOrCreateDeviceId() {
  const existing = getStoredValue(DEVICE_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  setStoredValue(DEVICE_ID_STORAGE_KEY, created);
  return created;
}

async function ensureMessagingSupported() {
  ensureBrowserEnvironment();
  const runtime = getRuntimeState();

  if (!window.isSecureContext) {
    throw new Error("Bildirimler yalnızca güvenli bağlantıda çalışır. Siteyi HTTPS üzerinden veya localhost altında aç.");
  }

  if (runtime.environment === "in_app_browser") {
    throw new Error(`Bu sayfa ${runtime.hostAppLabel || "uygulama içi tarayıcı"} içinde açıldı. Canlı bildirim için bağlantıyı ${runtime.recommendedBrowserLabel || "desteklenen tarayıcı"} ile açıp tekrar dene.`);
  }

  if (runtime.environment === "ios_home_screen_required") {
    throw new Error("iPhone ve iPad cihazlarda canlı bildirim için HalkYemek'i Safari'de açıp Ana Ekrana Ekle adımını tamamlaman gerekir.");
  }

  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Bu tarayıcı canlı web bildirimi desteği sunmuyor.");
  }

  if (!supportPromise) {
    supportPromise = isSupported().catch(() => false);
  }

  const supported = await supportPromise;
  if (!supported) {
    throw new Error("Bu tarayıcıda Firebase web push kullanılamıyor.");
  }
}

async function ensureNotificationPermission(requestPermission: boolean) {
  ensureBrowserEnvironment();

  if (!("Notification" in window)) {
    throw new Error("Bu tarayıcı bildirim izni yönetimini desteklemiyor.");
  }

  if (window.Notification.permission === "default" && requestPermission) {
    return window.Notification.requestPermission();
  }

  return window.Notification.permission;
}

async function ensurePushServiceWorkerRegistration() {
  await ensureMessagingSupported();
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  return registration;
}

function getPlatform() {
  const runtime = getRuntimeState();
  return runtime.isAppleMobile ? "IOS" : "WEB";
}

export async function getBrowserNotificationState(): Promise<BrowserNotificationState> {
  if (typeof window === "undefined") {
    return {
      supported: false,
      configured: false,
      secureContext: false,
      permission: "unsupported",
      hasStoredToken: false,
      environment: "unsupported",
      browserLabel: "",
      hostAppLabel: "",
      recommendedBrowserLabel: "",
      isAppleMobile: false,
      isStandalone: false,
    };
  }

  const runtime = getRuntimeState();
  const configured = Boolean(getFirebaseMessagingClientConfig()?.vapidKey);
  const secureContext = window.isSecureContext;
  const basicSupport =
    runtime.environment === "standard"
    && "Notification" in window
    && "serviceWorker" in navigator
    && "PushManager" in window;
  const supported = basicSupport ? await isSupported().catch(() => false) : false;
  const permission = supported ? window.Notification.permission : "unsupported";

  return {
    supported,
    configured,
    secureContext,
    permission,
    hasStoredToken: Boolean(getStoredFcmToken()),
    ...runtime,
  };
}

export async function buildNotificationDeviceInput(options?: { requestPermission?: boolean; allowNoop?: boolean }) {
  const requestPermission = options?.requestPermission ?? false;
  const allowNoop = options?.allowNoop ?? false;

  if (typeof window === "undefined") {
    return null;
  }

  const config = getFirebaseMessagingClientConfig();
  if (!config?.vapidKey) {
    if (allowNoop) {
      return null;
    }
    throw new Error("FCM Web Push icin VAPID anahtari eksik. Once frontend env ayarlarini tamamlayin.");
  }

  await ensureMessagingSupported();

  const permission = await ensureNotificationPermission(requestPermission);
  const deviceId = getOrCreateDeviceId();

  if (permission === "denied") {
    const storedToken = getStoredFcmToken();
    if (!storedToken) {
      if (allowNoop) {
        return null;
      }
      throw new Error("Tarayıcı bildirim izni kapalı. Tarayıcı ayarlarından izni açtıktan sonra tekrar dene.");
    }

    return {
      platform: getPlatform(),
      fcm_token: storedToken,
      device_id: deviceId,
      app_version: APP_VERSION,
      permission_granted: false,
      permission,
      tokenSource: "stored" as const,
    } satisfies NotificationDeviceInputResult;
  }

  if (permission !== "granted") {
    return null;
  }

  const registration = await ensurePushServiceWorkerRegistration();
  const messaging = getMessaging(getFirebaseClientApp());
  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: registration,
  });

  if (!token) {
    throw new Error("Bu cihaz için FCM token alınamadı. Tarayıcı iznini ve service worker kaydını kontrol et.");
  }

  setStoredFcmToken(token);

  return {
    platform: getPlatform(),
    fcm_token: token,
    device_id: deviceId,
    app_version: APP_VERSION,
    permission_granted: true,
    permission,
    tokenSource: "fcm" as const,
  } satisfies NotificationDeviceInputResult;
}

export async function syncStoredFcmPermissionState() {
  return buildNotificationDeviceInput({ requestPermission: false, allowNoop: true });
}

export async function startForegroundMessageListener(onForegroundMessage: (payload: MessagePayload) => void) {
  if (typeof window === "undefined" || !getFirebaseMessagingClientConfig()?.vapidKey) {
    return () => undefined;
  }

  await ensureMessagingSupported();
  const messaging = getMessaging(getFirebaseClientApp());
  return onMessage(messaging, onForegroundMessage);
}

export async function showBrowserTestNotification() {
  const permission = await ensureNotificationPermission(true);
  if (permission === "denied") {
    throw new Error("Tarayıcı bu site için bildirimleri engellemiş. Adres çubuğundaki site ayarlarından bildirim iznini açıp tekrar dene.");
  }
  if (permission !== "granted") {
    throw new Error("Bildirim izni verilmedi. Bu cihazda test bildirimi göstermek için tarayıcı iznini onayla.");
  }

  const registration = await ensurePushServiceWorkerRegistration();
  await registration.showNotification("HalkYemek test bildirimi", {
    body: "Bu bildirimi PC ekranında görüyorsan cihaz bildirimleri çalışıyor.",
    icon: "/logo-halkyemek.png",
    badge: "/hy-favicon.svg",
    tag: `halkyemek-local-test-${Date.now()}`,
    data: { url: "/bildirimler" },
  });
}

export function clearStoredNotificationToken() {
  removeStoredValue(FCM_TOKEN_STORAGE_KEY);
}
