export type UserRole = "CUSTOMER" | "ADMIN";

export interface BusinessMembershipSummary {
  id: number;
  name: string;
  member_role: string;
  access_halkyemek: boolean;
  access_halktasarruf: boolean;
  supports_halkyemek: boolean;
  supports_halktasarruf: boolean;
}

export interface AuthUser {
  id: number;
  username: string;
  google_email: string;
  role: UserRole;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  is_new: boolean;
  user: AuthUser;
  has_business_membership: boolean;
  business_membership_count: number;
  businesses: BusinessMembershipSummary[];
}

export interface BackendSessionPayload {
  user: AuthUser;
  has_business_membership: boolean;
  business_membership_count: number;
  businesses: BusinessMembershipSummary[];
}

export interface SessionState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  businesses: BusinessMembershipSummary[];
  hasBusinessMembership: boolean;
  activeBusinessId: number | null;
  activeHalkTasarrufBusinessId: number | null;
}
