"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MessagePayload } from "firebase/messaging";
import { toast } from "sonner";

import {
  startForegroundMessageListener,
  syncRegisteredDeviceIfPossible,
} from "@/features/notifications/api";
import { useSession } from "@/hooks/use-session";

function invalidateNotificationRelatedQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    queryClient.invalidateQueries({ queryKey: ["cart"] }),
    queryClient.invalidateQueries({ queryKey: ["topup"] }),
    queryClient.invalidateQueries({ queryKey: ["orders"] }),
    queryClient.invalidateQueries({ queryKey: ["wallet"] }),
  ]);
}

function showNativeForegroundNotification(payload: MessagePayload) {
  if (typeof window === "undefined" || !("Notification" in window) || window.Notification.permission !== "granted") {
    return;
  }

  const title = payload.data?.title || payload.notification?.title || "Yeni bir bildirimin var";
  const body = payload.data?.body || payload.notification?.body || "HalkYemek hesabında yeni bir gelişme oluştu.";
  const url = payload.data?.url || "/bildirimler";

  try {
    const notification = new window.Notification(title, {
      body,
      icon: "/logo-halkyemek.png",
      badge: "/hy-favicon.svg",
      tag: payload.data?.tag || "halkyemek-notification",
    });
    notification.onclick = () => {
      window.focus();
      window.location.assign(url);
      notification.close();
    };
  } catch {
    // Native notifications are best-effort; the in-app toast still informs the user.
  }
}

export function WebPushBootstrap() {
  const queryClient = useQueryClient();
  const sessionQuery = useSession();
  const listenerStartedRef = useRef(false);

  useEffect(() => {
    if (!sessionQuery.data?.isAuthenticated) {
      return;
    }

    let cancelled = false;

    void syncRegisteredDeviceIfPossible()
      .then(async (result) => {
        if (cancelled || !result) {
          return;
        }

        queryClient.setQueryData(["notifications", "readiness"], result.notification_readiness);
        queryClient.setQueryData(["notifications", "browser-state"], {
          supported: true,
          configured: true,
          secureContext: true,
          permission: result.permission_granted ? "granted" : "denied",
          hasStoredToken: true,
        });
        await invalidateNotificationRelatedQueries(queryClient);
      })
      .catch(() => {
        // Silent on background sync; explicit user action surfaces errors instead.
      });

    return () => {
      cancelled = true;
    };
  }, [queryClient, sessionQuery.data?.isAuthenticated]);

  useEffect(() => {
    if (listenerStartedRef.current) {
      return;
    }
    listenerStartedRef.current = true;

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    void startForegroundMessageListener(async (payload) => {
      const title = payload.data?.title || payload.notification?.title || "Yeni bir bildirimin var";
      const description = payload.data?.body || payload.notification?.body || "HalkYemek hesabında yeni bir gelişme oluştu.";
      showNativeForegroundNotification(payload);
      toast.success(title, { description });
      await invalidateNotificationRelatedQueries(queryClient);
    })
      .then((handler) => {
        if (cancelled) {
          handler();
          return;
        }
        unsubscribe = handler;
      })
      .catch(() => {
        // Browsers without push support should not block the rest of the app.
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient]);

  return null;
}
