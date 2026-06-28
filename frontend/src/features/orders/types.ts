import type { PaginatedResponse } from "@/types/pagination";

export interface OrderItem {
  id: number;
  menu_item_id: number | null;
  item_type?: "MENU_ITEM" | "SURPRISE_DEAL" | string;
  source_type?: "MENU_ITEM" | "SURPRISE_DEAL" | string;
  menu_item_name: string;
  display_name?: string;
  surprise_deal_id?: number | null;
  original_value_amount?: number | null;
  pickup_window_start?: string | null;
  pickup_window_end?: string | null;
  quantity: number;
  unit_price_amount: number;
  line_total_amount: number;
  sort_order: number;
}

export interface OrderPricingSnapshot extends Record<string, unknown> {
  fee_model?: string;
}

export interface OrderSource extends Record<string, unknown> {
  contract?: string;
  source_type?: "CART" | "SURPRISE_DEAL" | string;
  cart_id?: number;
  checkout_session_id?: number;
  surprise_deal?: Record<string, unknown> | null;
}

export interface Order {
  id: number;
  user: number;
  user_username: string;
  business: number;
  business_name: string;
  checkout_session_id: number | null;
  cart_id: number | null;
  amount: number;
  subtotal_amount: number;
  customer_fee_amount: number;
  business_fee_amount: number;
  total_charged_amount: number;
  business_net_amount: number;
  item_count: number;
  status: string;
  paid_at: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_at: string;
  checkout_session_created_at: string | null;
  checkout_session_expires_at: string | null;
  checkout_session_consumed_at: string | null;
  pricing: OrderPricingSnapshot;
  source: OrderSource;
  order_items: OrderItem[];
}

export type OrderListResponse = PaginatedResponse<Order>;

export interface OrderFilters {
  status?: string;
  search?: string;
  ordering?: string;
  page?: number;
  user?: number;
}
