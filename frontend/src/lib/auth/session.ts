import { decodeJwt } from "jose";

import type { LoginResponse, SessionState } from "@/types/auth";
import { cookieNames, getCookieStore, readSessionCookies, setAccessCookie, setRefreshCookie, setSessionCookie } from "@/lib/auth/cookies";
import { fetchBackendSession, refreshBackendAccessToken } from "@/lib/auth/backend-auth";
import { ApiClientError } from "@/lib/api/errors";
import { buildSessionState, getAnonymousSessionState } from "@/lib/auth/session-state";

function sanitizeSessionState(input: unknown): SessionState | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<SessionState> & {
    user?: Partial<NonNullable<SessionState["user"]>>;
    businesses?: Array<Partial<SessionState["businesses"][number]>>;
  };

  const user = candidate.user;
  const businesses = Array.isArray(candidate.businesses)
    ? candidate.businesses
        .filter((item): item is NonNullable<typeof item> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          id: typeof item.id === "number" ? item.id : Number(item.id),
          name: typeof item.name === "string" ? item.name : "",
          member_role: typeof item.member_role === "string" ? item.member_role : "",
        }))
        .filter((item) => Number.isInteger(item.id) && item.id > 0 && item.name.length > 0)
    : [];

  if (!candidate.isAuthenticated) {
    return getAnonymousSessionState();
  }

  if (!user || typeof user !== "object") {
    return null;
  }

  if (
    typeof user.id !== "number" ||
    typeof user.username !== "string" ||
    typeof user.google_email !== "string" ||
    (user.role !== "CUSTOMER" && user.role !== "ADMIN")
  ) {
    return null;
  }

  const preferredBusinessId = typeof candidate.activeBusinessId === "number" ? candidate.activeBusinessId : null;
  const activeBusinessId = businesses.some((item) => item.id === preferredBusinessId)
    ? preferredBusinessId
    : businesses[0]?.id ?? null;

  return {
    isAuthenticated: true,
    user: {
      id: user.id,
      username: user.username,
      google_email: user.google_email,
      role: user.role,
    },
    businesses,
    hasBusinessMembership: Boolean(candidate.hasBusinessMembership ?? businesses.length > 0),
    activeBusinessId,
  };
}

function canFallbackToCachedSession(error: unknown) {
  return !(error instanceof ApiClientError) || error.status >= 500;
}

async function rebuildAuthoritativeSession(accessToken: string, previousSession?: SessionState | null) {
  const backendSession = await fetchBackendSession(accessToken);
  const nextSession = buildSessionState(backendSession, previousSession?.activeBusinessId);
  await setSessionCookie(nextSession);
  return nextSession;
}

async function resolveAuthoritativeSession(accessToken: string, previousSession?: SessionState | null) {
  const backendSession = await fetchBackendSession(accessToken);
  return buildSessionState(backendSession, previousSession?.activeBusinessId);
}

async function refreshAndRebuild(refreshToken: string, previousSession?: SessionState | null) {
  const refreshed = await refreshBackendAccessToken(refreshToken);
  await setAccessCookie(refreshed.access);
  return rebuildAuthoritativeSession(refreshed.access, previousSession);
}

function parseSessionCookie(sessionCookie: string | null) {
  return sessionCookie ? (() => {
    try {
      return sanitizeSessionState(JSON.parse(sessionCookie));
    } catch {
      return null;
    }
  })() : null;
}

export async function persistLoginSession(payload: LoginResponse) {
  const sessionState = buildSessionState(payload);

  await Promise.all([
    setAccessCookie(payload.access),
    setRefreshCookie(payload.refresh),
    setSessionCookie(sessionState),
  ]);

  return sessionState;
}

export async function readSessionState(): Promise<SessionState> {
  const { accessToken, refreshToken, sessionCookie } = await readSessionCookies();
  const parsed = parseSessionCookie(sessionCookie);

  if (!refreshToken) {
    return getAnonymousSessionState();
  }

  if (accessToken && !isJwtExpired(accessToken)) {
    try {
      return await resolveAuthoritativeSession(accessToken, parsed);
    } catch (error) {
      if (parsed?.isAuthenticated && canFallbackToCachedSession(error)) {
        return parsed;
      }
      return getAnonymousSessionState();
    }
  }

  if (parsed?.isAuthenticated) {
    return parsed;
  }

  return getAnonymousSessionState();
}

export async function getSessionState(): Promise<SessionState> {
  const { accessToken, refreshToken, sessionCookie } = await readSessionCookies();
  const parsed = parseSessionCookie(sessionCookie);

  if (!refreshToken) {
    return getAnonymousSessionState();
  }

  if (accessToken && !isJwtExpired(accessToken)) {
    try {
      return await rebuildAuthoritativeSession(accessToken, parsed);
    } catch (error) {
      if (parsed?.isAuthenticated && canFallbackToCachedSession(error)) {
        return parsed;
      }
      return getAnonymousSessionState();
    }
  }

  try {
    return await refreshAndRebuild(refreshToken, parsed);
  } catch (error) {
    if (parsed?.isAuthenticated && canFallbackToCachedSession(error)) {
      return parsed;
    }
    return getAnonymousSessionState();
  }
}

export async function getAccessToken() {
  const store = await getCookieStore();
  return store.get(cookieNames.access)?.value ?? null;
}

export async function getRefreshToken() {
  const store = await getCookieStore();
  return store.get(cookieNames.refresh)?.value ?? null;
}

export function isJwtExpired(token: string) {
  try {
    const jwt = decodeJwt(token);
    if (!jwt.exp) return false;
    return jwt.exp * 1000 <= Date.now() + 10_000;
  } catch {
    return true;
  }
}
