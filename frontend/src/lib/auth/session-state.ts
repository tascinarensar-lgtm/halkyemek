import type { BackendSessionPayload, LoginResponse, SessionState } from "@/types/auth";

function normalizeActiveBusinessId(candidate: number | null | undefined, businesses: BackendSessionPayload["businesses"]) {
  if (typeof candidate === "number" && businesses.some((item) => item.id === candidate)) {
    return candidate;
  }

  return businesses[0]?.id ?? null;
}

export function buildSessionState(payload: LoginResponse, previousActiveBusinessId?: number | null): SessionState;
export function buildSessionState(payload: BackendSessionPayload, previousActiveBusinessId?: number | null): SessionState;
export function buildSessionState(payload: BackendSessionPayload | LoginResponse, previousActiveBusinessId?: number | null): SessionState {
  return {
    isAuthenticated: true,
    user: payload.user,
    businesses: payload.businesses,
    hasBusinessMembership: payload.has_business_membership,
    activeBusinessId: normalizeActiveBusinessId(previousActiveBusinessId, payload.businesses),
  };
}

export function getAnonymousSessionState(): SessionState {
  return { isAuthenticated: false, user: null, businesses: [], hasBusinessMembership: false, activeBusinessId: null };
}
