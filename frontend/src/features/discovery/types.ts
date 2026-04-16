export type DistrictCode = "BEYLIKDUZU";
export type BusinessListingType = "CONTRACTED" | "VOLUNTEER";

export interface DistrictSummary {
  code: DistrictCode | string;
  label: string;
}

export interface MarketplaceCategorySummary {
  id: number;
  slug: string;
  name: string;
  description: string;
  sort_order: number;
  is_other: boolean;
  image: string;
}

export interface BusinessCategorySummary {
  id: number;
  slug: string;
  name: string;
  is_other: boolean;
}

export interface PublicBusinessSummary {
  id: number;
  business_name: string;
  district: string;
  district_label: string;
  listing_type: BusinessListingType;
  listing_type_label: string;
  is_featured: boolean;
  short_description: string;
  intro_text: string;
  badge_text: string;
  cover_image: string;
  logo_image: string;
  primary_marketplace_category: BusinessCategorySummary | null;
}

export interface DiscoveryBusinessCard extends PublicBusinessSummary {
  display_priority: number;
}

export interface OfferSummary {
  id: number;
  title: string;
  short_description: string;
  description: string;
  label: string;
  tag: string;
  offer_price_amount: number;
  is_featured: boolean;
  starts_at: string;
  ends_at: string;
  is_live: boolean;
  image: string;
}

export interface WalletSummary {
  balance: number;
  pending_balance: number;
}

export interface ActiveCartSummary {
  cart_id: number;
  business_id: number;
  business_name: string;
  item_count: number;
  subtotal_amount: number;
  customer_fee_amount: number;
  total_amount: number;
}

export interface NotificationReadinessSummary {
  notification_ready: boolean;
  active_device_count: number;
}

export interface DiscoveryHomeResponse {
  district: DistrictSummary;
  categories: MarketplaceCategorySummary[];
  featured_businesses: DiscoveryBusinessCard[];
  other_businesses: DiscoveryBusinessCard[];
  active_offers: OfferSummary[];
  wallet_summary: WalletSummary | null;
  active_cart_summary: ActiveCartSummary | null;
  notification_readiness: NotificationReadinessSummary;
}

export interface DiscoveryCategoryListResponse {
  district: string;
  count: number;
  results: MarketplaceCategorySummary[];
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface PublicBusinessListResponse {
  count: number;
  results: PublicBusinessSummary[];
}

export interface MediaAssetSummary {
  id: number;
  media_type: string;
  asset_role: string;
  url: string;
  alt_text: string;
  sort_order: number;
}

export interface BusinessMenuCategoryOverview {
  id: number;
  name: string;
  description: string | null;
}

export interface PublicBusinessDetailResponse {
  business: PublicBusinessSummary;
  media: MediaAssetSummary[];
  active_offers: OfferSummary[];
  category_overview: BusinessMenuCategoryOverview[];
  server_time: string;
}

export interface MenuItemSummary {
  id: number;
  category_id: number;
  name: string;
  slug: string;
  description: string;
  price_amount: number;
  image_url: string;
  image: string;
  is_available: boolean;
}

export interface PublicMenuCategory {
  id: number;
  name: string;
  description: string | null;
  menu_items: MenuItemSummary[];
}

export interface PublicBusinessMenuResponse {
  business: PublicBusinessSummary;
  categories: PublicMenuCategory[];
  active_offers: OfferSummary[];
}
