import type { BusinessMembershipSummary, SessionState } from "@/types/auth";

export function getAccessibleBusiness(businesses: BusinessMembershipSummary[], businessId?: number | null) {
  if (!Number.isFinite(businessId ?? NaN)) {
    return null;
  }
  return businesses.find((item) => item.id === businessId) ?? null;
}

export function getFallbackBusiness(session: SessionState | undefined | null) {
  const businesses = session?.businesses ?? [];
  return getAccessibleBusiness(businesses, session?.activeBusinessId) ?? businesses[0] ?? null;
}

export function resolveBusinessContext(session: SessionState | undefined | null, requestedBusinessId?: number | null) {
  const businesses = session?.businesses ?? [];
  const requestedBusiness = getAccessibleBusiness(businesses, requestedBusinessId);
  const fallbackBusiness = getFallbackBusiness(session);
  const resolvedBusiness = requestedBusiness ?? fallbackBusiness;

  return {
    businesses,
    requestedBusiness,
    fallbackBusiness,
    resolvedBusiness,
    requestedBusinessId: requestedBusinessId ?? null,
    resolvedBusinessId: resolvedBusiness?.id ?? null,
    hasMembership: businesses.length > 0,
    hasRequestedAccess: requestedBusinessId == null ? true : requestedBusiness !== null,
  };
}
