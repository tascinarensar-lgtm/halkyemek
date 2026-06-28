export type SurpriseDealStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "CLOSED" | "EXPIRED" | "CANCELLED";

export interface SurpriseDealBusinessSummary {
  id: number;
  name: string;
  district: string;
  short_description: string;
  badge_text: string;
}

export interface SurpriseDealPublic {
  id: number;
  business: SurpriseDealBusinessSummary;
  title: string;
  description: string;
  original_value_amount: number;
  sale_price_amount: number;
  currency: string;
  quantity_remaining: number;
  pickup_window_start: string;
  pickup_window_end: string;
  min_contents_note: string;
  grams: number | null;
  allergens_note: string | null;
  image_url: string;
  is_sold_out: boolean;
}

export interface SurpriseDealBusiness extends SurpriseDealPublic {
  quantity_total: number;
  quantity_reserved: number;
  status: SurpriseDealStatus;
  created_by: number | null;
  published_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  active_reserved_count: number;
}

export type SurpriseDealReservationStatus = "RESERVED" | "COMMITTED" | "RELEASED" | "EXPIRED" | "CANCELLED";

export interface SurpriseDealReservation {
  id: number;
  status: SurpriseDealReservationStatus;
  quantity: number;
  expires_at: string;
}

export interface SurpriseDealCheckoutSessionSummary {
  id: number;
  token: string;
  cashier_code: string | null;
  status: string;
  expires_at: string;
  source_type: "SURPRISE_DEAL";
}

export interface SurpriseDealCheckoutSessionResponse {
  checkout_session: SurpriseDealCheckoutSessionSummary;
  surprise_deal: SurpriseDealPublic;
  reservation: SurpriseDealReservation;
  total_amount: number;
  wallet_balance: number;
  insufficient_balance: boolean;
}

export interface SurpriseDealListResponse<TDeal> {
  count: number;
  results: TDeal[];
}

export interface CreateSurpriseDealPayload {
  title: string;
  description?: string;
  original_value_amount: number;
  sale_price_amount: number;
  quantity_total: number;
  pickup_window_start: string;
  pickup_window_end: string;
  status?: SurpriseDealStatus;
  min_contents_note?: string;
  grams?: number | null;
  allergens_note?: string | null;
  image_url?: string;
}

export type UpdateSurpriseDealPayload = Partial<CreateSurpriseDealPayload>;

export interface SurpriseDealListParams {
  district?: string;
  business?: string | number;
  ordering?: string;
}

export interface SurpriseDealCheckoutPayload {
  quantity?: number;
}
