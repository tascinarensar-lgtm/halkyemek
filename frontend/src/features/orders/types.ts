import type { PaginatedResponse } from "@/types/pagination";

export interface OrderItem {
  id: number;
  menu_item_id: number;
  menu_item_name: string;
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
  cart_id?: number;
  checkout_session_id?: number;
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
}
