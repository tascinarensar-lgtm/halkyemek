import { cookies } from "next/headers";

import { env } from "@/lib/config/env";
import type { SessionState } from "@/types/auth";

const prefix = env.SESSION_COOKIE_PREFIX;

export interface SessionCookieSnapshot {
  accessToken: string | null;
  refreshToken: string | null;
  sessionCookie: string | null;
}

export const cookieNames = {
  access: `${prefix}_access`,
  refresh: `${prefix}_refresh`,
  session: `${prefix}_session`,
};

export const accessCookieMaxAgeSeconds = 60 * 15;
export const sessionCookieMaxAgeSeconds = 60 * 60 * 24 * 14;

export async function getCookieStore() {
  return cookies();
}

export async function readSessionCookies(): Promise<SessionCookieSnapshot> {
  const store = await getCookieStore();
  const accessToken = store.get(cookieNames.access)?.value ?? null;
  const refreshToken = store.get(cookieNames.refresh)?.value ?? null;
  const sessionCookie = store.get(cookieNames.session)?.value ?? null;

  return {
    accessToken,
    refreshToken,
    sessionCookie,
  };
}

export function getSessionCookieOptions(maxAge = sessionCookieMaxAgeSeconds) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.SESSION_COOKIE_SECURE,
    path: "/",
    maxAge,
  };
}

export async function setAccessCookie(accessToken: string) {
  const store = await getCookieStore();
  store.set(cookieNames.access, accessToken, getSessionCookieOptions(accessCookieMaxAgeSeconds));
}

export async function setRefreshCookie(refreshToken: string) {
  const store = await getCookieStore();
  store.set(cookieNames.refresh, refreshToken, getSessionCookieOptions());
}

export async function setSessionCookie(sessionState: SessionState) {
  const store = await getCookieStore();
  store.set(cookieNames.session, JSON.stringify(sessionState), getSessionCookieOptions());
}

export async function clearSessionCookies() {
  const store = await getCookieStore();
  Object.values(cookieNames).forEach((name) => store.set(name, "", getSessionCookieOptions(0)));
}
