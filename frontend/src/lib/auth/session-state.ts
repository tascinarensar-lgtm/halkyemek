import type { BackendSessionPayload, LoginResponse, SessionState } from "@/types/auth";

function normalizeActiveBusinessId(
  candidate: number | null | undefined,
  businesses: BackendSessionPayload["businesses"],
  product: "halkyemek" | "halktasarruf",
) {
  const eligibleBusinesses = businesses.filter((item) =>
    product === "halkyemek"
      ? item.supports_halkyemek && item.access_halkyemek
      : item.supports_halktasarruf && item.access_halktasarruf,
  );

  if (typeof candidate === "number" && eligibleBusinesses.some((item) => item.id === candidate)) {
    return candidate;
  }

  return eligibleBusinesses[0]?.id ?? null;
}

export function buildSessionState(
  payload: LoginResponse,
  previousActiveBusinessId?: number | null,
  previousActiveHalkTasarrufBusinessId?: number | null,
): SessionState;
export function buildSessionState(
  payload: BackendSessionPayload,
  previousActiveBusinessId?: number | null,
  previousActiveHalkTasarrufBusinessId?: number | null,
): SessionState;
export function buildSessionState(
  payload: BackendSessionPayload | LoginResponse,
  previousActiveBusinessId?: number | null,
  previousActiveHalkTasarrufBusinessId?: number | null,
): SessionState {
  return {
    isAuthenticated: true,
    user: payload.user,
    businesses: payload.businesses,
    hasBusinessMembership: payload.has_business_membership,
    activeBusinessId: normalizeActiveBusinessId(previousActiveBusinessId, payload.businesses, "halkyemek"),
    activeHalkTasarrufBusinessId: normalizeActiveBusinessId(previousActiveHalkTasarrufBusinessId, payload.businesses, "halktasarruf"),
  };
}

export function getAnonymousSessionState(): SessionState {
  return {
    isAuthenticated: false,
    user: null,
    businesses: [],
    hasBusinessMembership: false,
    activeBusinessId: null,
    activeHalkTasarrufBusinessId: null,
  };
}
