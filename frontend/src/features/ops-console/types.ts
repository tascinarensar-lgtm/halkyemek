export interface ApiDataEnvelope<T> { ok?: boolean; data: T; }

export interface OpsDashboardData {
  payouts: { due_to_dispatch: number; failed_total: number; sent_waiting_confirm: number; confirmed_total: number };
  earnings: { pending: number; eligible: number; paid: number };
}

export interface OpsMetricsData {
  counts: Record<string, number>;
  payouts_by_status: Record<string, number>;
}

export interface OpsPaymentIntentItem {
  id: number;
  provider: string;
  purpose: string;
  amount: number;
  status: string;
  provider_payment_id?: string | null;
  provider_session_token?: string;
  provider_page_url?: string;
  normalized_status?: string;
  is_processed: boolean;
  processed_at?: string | null;
  processing_error?: string | null;
  is_settled: boolean;
  settled_at?: string | null;
  marketplace_conversation_id?: string;
  payment_reference?: string;
  manual_payment_account_name?: string;
  manual_payment_iban?: string;
  manual_payment_instructions?: string[];
  user_id?: number;
  username?: string;
  email?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OpsPaymentIntentListResponse {
  count: number;
  results: OpsPaymentIntentItem[];
  summary: Record<string, number>;
}

export interface OpsManualTopupConfirmResponse {
  intent: OpsPaymentIntentItem;
  provider_event_id: string;
  wallet_transaction_id: number | null;
  wallet_balance: number;
  already_confirmed: boolean;
}

export interface OpsBusinessContact {
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
}

export interface OpsBusinessListItem {
  id: number;
  business_name: string;
  category: string;
  district: string;
  supports_halkyemek: boolean;
  supports_halktasarruf: boolean;
  address_line?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string | null;
  listing_type: string;
  is_featured: boolean;
  display_priority: number;
  is_active: boolean;
  is_approved: boolean;
  is_listed: boolean;
  marketplace_is_visible: boolean;
  payout_onboarding_status: string;
  iyzico_submerchant_key?: string | null;
  kyc_contact_name?: string | null;
  kyc_contact_surname?: string | null;
  kyc_identity_number?: string | null;
  kyc_tax_number?: string | null;
  kyc_iban?: string | null;
  active_membership_count: number;
  contact?: OpsBusinessContact | null;
}

export interface OpsBusinessesListResponse {
  count: number;
  results: OpsBusinessListItem[];
}

export interface OpsBusinessCreateInput {
  business_name: string;
  category: string;
  supports_halkyemek?: boolean;
  supports_halktasarruf?: boolean;
  adress?: string;
  address_line?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  google_maps_url?: string | null;
  district?: string;
  listing_type?: string;
  is_active?: boolean;
  is_approved?: boolean;
  is_listed?: boolean;
  marketplace_is_visible?: boolean;
  is_featured?: boolean;
  display_priority?: number;
  short_description?: string;
  intro_text?: string;
  badge_text?: string;
  kyc_contact_name?: string;
  kyc_contact_surname?: string;
  kyc_identity_number?: string;
  kyc_tax_number?: string;
  kyc_iban?: string;
  contact_user_id?: number | null;
  owner_user_id?: number | null;
  owner_role?: string;
}

export interface OpsBusinessCreateResponse extends OpsBusinessListItem {
  adress?: string;
}

export interface OpsBusinessMembership {
  id: number;
  user_id: number;
  username?: string;
  email?: string;
  role: string;
  is_active?: boolean;
  access_halkyemek?: boolean;
  access_halktasarruf?: boolean;
  granted_by_id?: number | null;
  granted_by_username?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OpsBusinessDetail {
  id: number;
  business_name: string;
  category: string;
  district: string;
  supports_halkyemek: boolean;
  supports_halktasarruf: boolean;
  listing_type: string;
  is_featured: boolean;
  display_priority: number;
  adress?: string;
  address_line?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string | null;
  is_active: boolean;
  is_approved: boolean;
  is_listed: boolean;
  marketplace_is_visible: boolean;
  payout_onboarding_status: string;
  payout_onboarding_note?: string | null;
  kyc_contact_name?: string | null;
  kyc_contact_surname?: string | null;
  kyc_identity_number?: string | null;
  kyc_tax_number?: string | null;
  kyc_iban?: string | null;
  contact?: OpsBusinessContact | null;
  iyzico_onboarding: Record<string, unknown>;
  memberships: OpsBusinessMembership[];
}

export interface OpsBusinessMembershipUpsertInput {
  user_id?: number;
  email?: string;
  role: string;
  is_active?: boolean;
  access_halkyemek?: boolean;
  access_halktasarruf?: boolean;
}

export interface OpsBusinessStatusInput {
  business_name?: string;
  category?: string;
  supports_halkyemek?: boolean;
  supports_halktasarruf?: boolean;
  adress?: string;
  is_active?: boolean;
  is_approved?: boolean;
  is_listed?: boolean;
  listing_type?: string;
  is_featured?: boolean;
  display_priority?: number;
  address_line?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string | null;
  marketplace_is_visible?: boolean;
  payout_onboarding_note?: string;
  kyc_contact_name?: string;
  kyc_contact_surname?: string;
  kyc_identity_number?: string;
  kyc_tax_number?: string;
  kyc_iban?: string;
}

export interface PayoutItem {
  id: number;
  batch?: number | null;
  business: number;
  amount: number;
  currency: string;
  provider_reference?: string | null;
  status: string;
  idempotency_key?: string | null;
  provider_payout_id?: string | null;
  provider_dispatch_payload?: Record<string, unknown> | null;
  provider_status_payload?: Record<string, unknown> | null;
  provider_item_reference_code?: string | null;
  attempt_count: number;
  status_sync_attempt_count: number;
  next_retry_at?: string | null;
  provider_error?: string | null;
  last_error_code?: string | null;
  last_error_at?: string | null;
  created_at?: string;
  sent_at?: string | null;
  confirmed_at?: string | null;
}

export interface ReconcileResponse { summary: Record<string, unknown>; issues: unknown[]; }

export interface SettlementImportItem {
  id: number;
  provider: string;
  source_type: string;
  source_label?: string | null;
  source_metadata?: Record<string, unknown> | null;
  original_filename?: string | null;
  checksum_sha256?: string | null;
  imported_by_username?: string | null;
  imported_by_label?: string | null;
  imported_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  parse_status: string;
  applied_status: string;
  total_rows: number;
  created_records: number;
  duplicate_records: number;
  processed_records: number;
  failed_records: number;
  skipped_rows: number;
  unmatched_records: number;
  retry_count: number;
  error_message?: string | null;
  summary?: Record<string, unknown>;
  latest_event?: Record<string, unknown> | null;
  operator_context?: Record<string, unknown> | null;
}

export interface SettlementImportListResponse { count: number; results: SettlementImportItem[]; summary: Record<string, number>; }
export interface SettlementImportDetailResponse { import: SettlementImportItem; records_preview: SettlementRecordItem[]; record_summary: Record<string, unknown>; }

export interface SettlementRecordItem {
  id: number;
  import_id?: number;
  row_number?: number | null;
  provider: string;
  external_settlement_id?: string | null;
  external_transaction_id?: string | null;
  amount: number;
  currency: string;
  settlement_reference_code?: string | null;
  provider_reference?: string | null;
  conversation_id?: string | null;
  submerchant_key?: string | null;
  business?: number | null;
  order?: number | null;
  payment_intent?: number | null;
  payment_intent_status?: string | null;
  payout?: number | null;
  payout_status?: string | null;
  match_type?: string | null;
  is_processed: boolean;
  processed_at?: string | null;
  processing_error?: string | null;
  retry_count: number;
  next_retry_at?: string | null;
  last_retry_at?: string | null;
  unmatched_reason_code?: string | null;
  unmatched_reason_label?: string | null;
  review_status: string;
  operator_note?: string | null;
  lifecycle_events?: Array<Record<string, unknown>>;
  unmatched_opened_at?: string | null;
  unmatched_resolved_at?: string | null;
  last_reviewed_at?: string | null;
  stale_manual_review?: boolean;
  unmatched_age_seconds?: number | null;
  next_action?: string | null;
  settled_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SettlementRecordListResponse { count: number; results: SettlementRecordItem[]; summary: Record<string, unknown>; }
export interface SettlementRecordDetailResponse { record: SettlementRecordItem; operator_flags: Record<string, boolean>; }
export interface SettlementDashboardData {
  imports_total: number;
  imports_failed: number;
  imports_applied: number;
  records_total: number;
  records_unmatched_open: number;
  records_failed: number;
  records_processed: number;
  records_stale_manual_review: number;
  latest_import?: SettlementImportItem | null;
  latest_import_record_summary?: Record<string, unknown> | null;
  heartbeats: Record<string, { status?: string | null; updated_at?: string | null; meta?: Record<string, unknown> | null }>;
}

export interface BroadcastInput {
  title: string;
  body: string;
  audience?: string;
  district?: string;
  payload?: Record<string, unknown>;
}

export type EmailBroadcastAudience = "ALL" | "CUSTOMERS" | "BUSINESS_MEMBERS";

export interface EmailBroadcastPayload {
  subject: string;
  message: string;
  audience?: EmailBroadcastAudience;
  district?: string;
  dry_run?: boolean;
}

export interface EmailBroadcastPreviewResponse {
  broadcast_id: string;
  estimated_count: number;
  dry_run: true;
  task_id?: string;
}

export interface EmailBroadcastQueueResponse {
  broadcast_id: string;
  estimated_count: number;
  dry_run: false;
  task_id: string;
}

export type OpsSurpriseDealStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "CLOSED" | "EXPIRED" | "CANCELLED";

export interface OpsSurpriseDealBusinessSummary {
  id: number;
  name: string;
  district: string;
  is_active?: boolean;
  is_approved?: boolean;
  is_listed?: boolean;
  marketplace_is_visible?: boolean;
}

export interface OpsSurpriseDealItem {
  id: number;
  title: string;
  business: OpsSurpriseDealBusinessSummary;
  business_name: string;
  district: string;
  status: OpsSurpriseDealStatus | string;
  sale_price_amount: number;
  original_value_amount: number;
  currency: string;
  quantity_total: number;
  quantity_remaining: number;
  quantity_reserved: number;
  pickup_window_start: string;
  pickup_window_end: string;
  created_at: string;
  published_at?: string | null;
  closed_at?: string | null;
  reservation_count: number;
  committed_count: number;
  expired_count: number;
  cancelled_count: number;
}

export interface OpsSurpriseDealListResponse {
  count: number;
  results: OpsSurpriseDealItem[];
}

export interface OpsSurpriseDealReservationSummary {
  total: number;
  reserved: number;
  committed: number;
  released: number;
  expired: number;
  cancelled: number;
  by_status: Record<string, number>;
}

export interface OpsSurpriseDealReservationItem {
  id: number;
  status: string;
  quantity: number;
  user_id: number;
  username?: string;
  checkout_session_id?: number | null;
  checkout_session_status?: string | null;
  order_id?: number | null;
  order_status?: string | null;
  reserved_at?: string | null;
  committed_at?: string | null;
  released_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
}

export interface OpsSurpriseDealOrderItem {
  id: number;
  status: string;
  user_id: number;
  username?: string;
  amount: number;
  total_charged_amount: number;
  paid_at?: string | null;
  used_at?: string | null;
  created_at?: string | null;
  checkout_session_id?: number | null;
}

export interface OpsSurpriseDealDetailResponse {
  deal: OpsSurpriseDealItem;
  business: OpsSurpriseDealBusinessSummary;
  reservation_summary: OpsSurpriseDealReservationSummary;
  recent_reservations: OpsSurpriseDealReservationItem[];
  recent_orders: OpsSurpriseDealOrderItem[];
}
