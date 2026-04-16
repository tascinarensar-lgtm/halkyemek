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
  menu_item_snapshot: Record<string, unknown>;
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
  menu_item_id: number;
  menu_item_name?: string;
  name?: string;
  quantity: number;
  unit_price_amount: number;
  line_total_amount: number;
  sort_order: number;
}

export interface CheckoutSessionDetail {
  id: number;
  token: string;
  cashier_code?: string | null;
  status: string;
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
  business: CheckoutSessionBusiness;
  cart: { id: number };
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
