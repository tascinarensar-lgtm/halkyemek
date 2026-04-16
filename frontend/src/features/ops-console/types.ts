export interface ApiDataEnvelope<T> { ok?: boolean; data: T; }

export interface OpsDashboardData {
  payouts: { due_to_dispatch: number; failed_total: number; sent_waiting_confirm: number; confirmed_total: number };
  earnings: { pending: number; eligible: number; paid: number };
}

export interface OpsMetricsData {
  counts: Record<string, number>;
  payouts_by_status: Record<string, number>;
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
  listing_type: string;
  is_featured: boolean;
  display_priority: number;
  is_active: boolean;
  is_approved: boolean;
  is_listed: boolean;
  marketplace_is_visible: boolean;
  payout_onboarding_status: string;
  iyzico_submerchant_key?: string | null;
  active_membership_count: number;
  contact?: OpsBusinessContact | null;
}

export interface OpsBusinessesListResponse {
  count: number;
  results: OpsBusinessListItem[];
}

export interface OpsBusinessMembership {
  id: number;
  user_id: number;
  username?: string;
  email?: string;
  role: string;
  is_active?: boolean;
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
  listing_type: string;
  is_featured: boolean;
  display_priority: number;
  adress?: string;
  is_active: boolean;
  is_approved: boolean;
  is_listed: boolean;
  marketplace_is_visible: boolean;
  payout_onboarding_status: string;
  payout_onboarding_note?: string | null;
  contact?: OpsBusinessContact | null;
  iyzico_onboarding: Record<string, unknown>;
  memberships: OpsBusinessMembership[];
}

export interface OpsBusinessMembershipUpsertInput {
  user_id: number;
  role: string;
  is_active?: boolean;
}

export interface OpsBusinessStatusInput {
  is_active?: boolean;
  is_approved?: boolean;
  is_listed?: boolean;
  listing_type?: string;
  is_featured?: boolean;
  display_priority?: number;
  marketplace_is_visible?: boolean;
  payout_onboarding_note?: string;
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
