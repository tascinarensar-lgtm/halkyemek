import type { PaginatedResponse } from "@/types/pagination";

export type BusinessMemberRole = "CASHIER" | "MANAGER" | "OWNER" | "ADMIN" | string;

export interface ApiDataEnvelope<T> {
  ok: boolean;
  data: T;
}

export interface BusinessDashboardSummary {
  business: {
    id: number;
    name: string;
    district: string;
    member_role: BusinessMemberRole;
  };
  consume_today: {
    count: number;
    total_charged_amount: number;
  };
  sessions: {
    pending: Array<{
      id: number;
      token: string;
      cashier_code?: string | null;
      status: string;
      amount: number;
      total_payable_amount: number;
      item_count: number;
      expires_at: string | null;
    }>;
    latest_consumed: Array<{
      id: number;
      token: string;
      amount: number;
      total_payable_amount: number;
      item_count: number;
      consumed_at: string | null;
      order_id: number | null;
    }>;
  };
  offers: {
    active_count: number;
    live_count: number;
    featured_count: number;
  };
  showcase: {
    listing_type: string;
    is_featured: boolean;
    is_listed: boolean;
    marketplace_is_visible: boolean;
  };
  media: {
    total_count: number;
    active_count: number;
    gallery_count: number;
    cover_count: number;
    logo_count: number;
    thumbnail_count: number;
  };
  finance: {
    earning: {
      pending_count: number;
      eligible_count: number;
      in_payout_count: number;
      paid_count: number;
      outstanding_net_amount?: number;
    };
    payout: {
      created_count: number;
      failed_count: number;
      sent_count: number;
      confirmed_count: number;
      confirmed_amount_total?: number;
    };
  };
}

export interface BusinessConsumePreview {
  checkout_session_id: number;
  token: string;
  cashier_code?: string | null;
  status: string;
  expires_at: string | null;
  amount: number;
  total_payable_amount: number;
  subtotal_amount?: number;
  customer_fee_amount?: number;
  business_fee_amount?: number;
  business_net_amount?: number;
  currency?: string;
  item_count: number;
  business: {
    id: number;
    name: string;
  };
  items?: Array<{
    menu_item_id: number;
    name?: string;
    menu_item_name?: string;
    quantity: number;
    unit_price_amount: number;
    line_total_amount: number;
    sort_order: number;
  }>;
  can_consume: boolean;
  failure_reason: string;
  existing_order_id: number | null;
}

export interface BusinessConsumeResponse {
  status: string;
  order_id: number;
  amount: number;
  total_charged_amount: number;
  checkout_session_id: number;
}

export interface BusinessConsumeHistoryItem {
  checkout_session_id: number;
  checkout_token: string;
  checkout_session_cashier_code?: string | null;
  consumed_at: string | null;
  consumed_by_user_id: number | null;
  customer_user_id: number | null;
  amount: number;
  total_payable_amount: number;
  item_count: number;
  order: {
    id: number | null;
    status: string;
    subtotal_amount: number;
    customer_fee_amount: number;
    business_fee_amount: number;
    business_net_amount: number;
    total_charged_amount: number;
    paid_at: string | null;
    used_at: string | null;
  };
  earning?: {
    status: string;
    net_amount: number;
    outstanding_amount: number;
    eligible_at: string | null;
    paid_at: string | null;
    payout: {
      id: number | null;
      status: string;
    } | null;
  } | null;
}

export type BusinessConsumeHistoryResponse = PaginatedResponse<BusinessConsumeHistoryItem>;

export interface BusinessOrderDetail {
  id: number;
  status: string;
  amount: number;
  total_charged_amount: number;
  subtotal_amount: number;
  customer_fee_amount: number;
  business_fee_amount: number;
  business_net_amount: number;
  item_count: number;
  created_at: string | null;
  paid_at: string | null;
  used_at: string | null;
  expires_at: string | null;
  checkout_session_id: number | null;
  checkout_session_token?: string | null;
  checkout_session_cashier_code?: string | null;
  consumed_by_user_id?: number | null;
  customer_user_id: number;
  earning?: {
    status: string;
    gross_amount: number;
    platform_fee_amount: number;
    net_amount: number;
    outstanding_amount: number;
    eligible_at: string | null;
    paid_at: string | null;
    payout: {
      id: number | null;
      status: string;
      confirmed_at: string | null;
    } | null;
  } | null;
  items: Array<{
    id: number;
    menu_item_id: number;
    menu_item_name: string;
    quantity: number;
    unit_price_amount: number;
    line_total_amount: number;
    sort_order: number;
  }>;
}

export interface BusinessProfileOperations {
  id: number;
  business_name: string;
  short_description: string;
  intro_text: string;
  badge_text: string;
  address_line?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string | null;
  marketplace_is_visible: boolean;
  listing_type: string;
  is_featured: boolean;
  display_priority: number;
  editable: {
    member_fields: string[];
    admin_fields: string[];
  };
  member_role: BusinessMemberRole;
}

export interface BusinessProfilePatchInput {
  short_description?: string;
  intro_text?: string;
  badge_text?: string;
  address_line?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  google_maps_url?: string | null;
  marketplace_is_visible?: boolean;
  listing_type?: string;
  is_featured?: boolean;
  display_priority?: number;
}

export interface BusinessProfilePatchResult {
  business_id: number;
  updated_fields: string[];
}

export interface ConsumeHistoryFilters {
  consumed_after?: string;
  consumed_before?: string;
  checkout_status?: string;
  page?: number;
}

export interface BusinessCategoryItem {
  id: number;
  assignment_id: number | null;
  slug: string;
  name: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  is_primary: boolean;
  is_selected: boolean;
  public_menu_item_count: number;
}

export interface BusinessCategoryInput {
  marketplace_category?: number;
  sort_order?: number;
  is_active?: boolean;
  is_primary?: boolean;
}

export interface BusinessMenuMarketplaceCategory {
  id: number;
  slug: string;
  name: string;
  description: string;
  is_primary: boolean;
}

export interface BusinessEntityMediaAsset {
  id: number;
  asset_role: BusinessMediaRole;
  alt_text: string;
  sort_order: number;
  url: string;
  file_url: string;
  file_path: string;
}

export interface BusinessMenuItem {
  id: number;
  category: number;
  category_name: string;
  name: string;
  slug: string;
  description: string;
  minimum_grams: number | null;
  price_amount: number;
  image_url: string;
  sort_order: number;
  is_active: boolean;
  is_visible: boolean;
  is_available: boolean;
  quota_enabled: boolean;
  quota_total: number | null;
  quota_remaining: number | null;
  low_stock_threshold: number;
  marketplace_categories: BusinessMenuMarketplaceCategory[];
  media_assets: BusinessEntityMediaAsset[];
  primary_image_url: string;
}

export interface BusinessMenuItemInput {
  name: string;
  slug: string;
  description?: string;
  minimum_grams?: number | null;
  price_amount: number;
  sort_order?: number;
  is_active?: boolean;
  is_visible?: boolean;
  is_available?: boolean;
  quota_enabled?: boolean;
  quota_total?: number | null;
  quota_remaining?: number | null;
  low_stock_threshold?: number;
  marketplace_category_ids: number[];
}

export interface BusinessOffer {
  id: number;
  business: number;
  menu_item: number | null;
  menu_item_name: string | null;
  title: string;
  short_description: string;
  description: string;
  label: string;
  tag: string;
  offer_price_amount: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  is_featured: boolean;
  daily_limit: number | null;
  sort_order: number;
  media_assets: BusinessEntityMediaAsset[];
  primary_image_url: string;
}

export interface BusinessOfferInput {
  menu_item?: number | null;
  title: string;
  short_description?: string;
  description?: string;
  label?: string;
  tag?: string;
  offer_price_amount: number;
  starts_at: string;
  ends_at: string;
  is_active?: boolean;
  is_featured?: boolean;
  daily_limit?: number | null;
  sort_order?: number;
}

export type BusinessMediaType = "IMAGE" | "VIDEO" | "DOCUMENT" | string;
export type BusinessMediaRole = "GALLERY" | "COVER" | "LOGO" | "THUMBNAIL" | string;

export interface BusinessMediaAsset {
  id: number;
  business: number | null;
  menu_item: number | null;
  marketplace_category: number | null;
  offer: number | null;
  file_url: string;
  file_path: string;
  url: string;
  media_type: BusinessMediaType;
  asset_role: BusinessMediaRole;
  alt_text: string;
  sort_order: number;
  is_active: boolean;
  uploaded_by: number | null;
  metadata: Record<string, unknown>;
}

export interface BusinessMediaAssetInput {
  menu_item?: number | null;
  marketplace_category?: number | null;
  offer?: number | null;
  file_url?: string;
  file_path?: string;
  media_type: BusinessMediaType;
  asset_role: BusinessMediaRole;
  alt_text?: string;
  sort_order?: number;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}
