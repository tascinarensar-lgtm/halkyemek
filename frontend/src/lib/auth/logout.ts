"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { QueryClient } from "@tanstack/react-query";

import { notifyAuthStateCleared } from "@/lib/auth/events";
import { getAnonymousSessionState } from "@/lib/auth/session-state";
import { SESSION_QUERY_KEY } from "@/lib/query/keys";

const PRIVATE_QUERY_PREFIXES = [
  "business-operations",
  "cart",
  "checkout-session",
  "notifications",
  "orders",
  "wallet",
] as const;

const LOGOUT_TIMEOUT_MS = 3_000;
const QUERY_CANCEL_TIMEOUT_MS = 1_500;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage?: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage || "İşlem zaman aşımına uğradı.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function requestLogout() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Çıkış işlemi zaman aşımına uğradı. Lütfen tekrar dene.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error("Çıkış işlemi tamamlanamadı.");
  }
}

export async function finalizeClientLogout({
  queryClient,
  router,
  redirectTo = "/",
  hardRedirect = true,
}: {
  queryClient: QueryClient;
  router: AppRouterInstance;
  redirectTo?: string;
  hardRedirect?: boolean;
}) {
  await withTimeout(queryClient.cancelQueries(), QUERY_CANCEL_TIMEOUT_MS).catch(() => undefined);
  notifyAuthStateCleared("logout");
  queryClient.setQueryData(SESSION_QUERY_KEY, getAnonymousSessionState());

  for (const prefix of PRIVATE_QUERY_PREFIXES) {
    queryClient.removeQueries({ queryKey: [prefix] });
  }

  router.replace(redirectTo);

  if (hardRedirect && typeof window !== "undefined") {
    window.location.replace(redirectTo);
    return;
  }

  router.refresh();
}

