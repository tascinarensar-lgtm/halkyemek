export interface CartPricingSnapshot {
  subtotal_amount: number;
  customer_fee_amount: number;
  business_fee_amount: number;
  total_payable_amount: number;
  business_net_amount: number;
  platform_total_fee_amount: number;
  currency: string;
  fee_model?: string;
}

export interface CartItemSnapshot {
  cart_item_id: number;
  menu_item_id: number;
  name: string;
  quantity: number;
  unit_price_amount: number;
  line_total_amount: number;
  sort_order: number;
  menu_item_snapshot: {
    menu_item_id?: number;
    business_id?: number;
    category_id?: number;
    name?: string;
    price_amount?: number;
    image_url?: string;
    quota_enabled?: boolean;
    quota_remaining?: number | null;
    quota_label?: string | null;
    is_sold_out?: boolean;
    can_add_to_cart?: boolean;
    low_stock_threshold?: number;
    [key: string]: unknown;
  };
}

export interface CartDetail {
  id: number;
  status: string;
  business: number;
  subtotal_amount: number;
  customer_fee_amount: number;
  total_amount: number;
  currency: string;
  item_count: number;
  pricing: CartPricingSnapshot | null;
  items: CartItemSnapshot[];
  updated_at: string;
}

export interface CheckoutSessionBusiness {
  id: number;
  name: string;
}

export interface CheckoutSessionItem {
  menu_item_id?: number | null;
  source_type?: "CART" | "SURPRISE_DEAL" | string;
  surprise_deal_id?: number;
  menu_item_name?: string;
  name?: string;
  quantity: number;
  unit_price_amount: number;
  line_total_amount: number;
  sort_order: number;
  image_url?: string;
  pickup_window_start?: string;
  pickup_window_end?: string;
  original_value_amount?: number;
  menu_item_snapshot?: CartItemSnapshot["menu_item_snapshot"];
}

export interface CheckoutSessionDetail {
  id: number;
  token: string;
  cashier_code?: string | null;
  status: string;
  source_type: "CART" | "SURPRISE_DEAL" | string;
  amount: number;
  total_payable_amount: number;
  subtotal_amount: number;
  customer_fee_amount: number;
  business_fee_amount: number;
  business_net_amount: number;
  platform_total_fee_amount: number;
  item_count: number;
  currency: string;
  expires_at: string | null;
  created_at?: string;
  updated_at?: string;
  consumed_at?: string | null;
  cancelled_at?: string | null;
  business: CheckoutSessionBusiness;
  cart: { id: number | null };
  pricing: CartPricingSnapshot | null;
  items: CheckoutSessionItem[];
}

export interface NotificationReadiness {
  notification_ready: boolean;
  active_device_count: number;
  message?: string;
}

export interface DeviceUpsertResponse {
  id: number;
  platform: string;
  permission_granted: boolean;
  is_active: boolean;
  token_rotated_deactivated_count: number;
  notification_readiness: NotificationReadiness;
}
