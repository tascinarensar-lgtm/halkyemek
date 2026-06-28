import type { BusinessMembershipSummary, SessionState } from "@/types/auth";

export type BusinessWorkspace = "halkyemek" | "halktasarruf";

function supportsWorkspace(business: BusinessMembershipSummary, workspace: BusinessWorkspace) {
  return workspace === "halkyemek"
    ? business.supports_halkyemek && business.access_halkyemek
    : business.supports_halktasarruf && business.access_halktasarruf;
}

export function getAccessibleBusiness(
  businesses: BusinessMembershipSummary[],
  businessId?: number | null,
  workspace: BusinessWorkspace = "halkyemek",
) {
  if (!Number.isFinite(businessId ?? NaN)) {
    return null;
  }
  return businesses.find((item) => item.id === businessId && supportsWorkspace(item, workspace)) ?? null;
}

export function getFallbackBusiness(session: SessionState | undefined | null, workspace: BusinessWorkspace = "halkyemek") {
  const businesses = (session?.businesses ?? []).filter((item) => supportsWorkspace(item, workspace));
  const activeId = workspace === "halkyemek" ? session?.activeBusinessId : session?.activeHalkTasarrufBusinessId;
  return getAccessibleBusiness(businesses, activeId, workspace) ?? businesses[0] ?? null;
}

export function resolveBusinessContext(
  session: SessionState | undefined | null,
  requestedBusinessId?: number | null,
  workspace: BusinessWorkspace = "halkyemek",
) {
  const businesses = (session?.businesses ?? []).filter((item) => supportsWorkspace(item, workspace));
  const requestedBusiness = getAccessibleBusiness(businesses, requestedBusinessId, workspace);
  const fallbackBusiness = getFallbackBusiness(session, workspace);
  const resolvedBusiness = requestedBusiness ?? fallbackBusiness;
  const activeBusinessId = workspace === "halkyemek" ? session?.activeBusinessId ?? null : session?.activeHalkTasarrufBusinessId ?? null;

  return {
    businesses,
    requestedBusiness,
    fallbackBusiness,
    resolvedBusiness,
    requestedBusinessId: requestedBusinessId ?? null,
    resolvedBusinessId: resolvedBusiness?.id ?? null,
    activeBusinessId,
    workspace,
    hasMembership: businesses.length > 0,
    hasRequestedAccess: requestedBusinessId == null ? true : requestedBusiness !== null,
  };
}
