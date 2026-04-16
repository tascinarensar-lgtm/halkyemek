import { authenticatedApiFetch } from "@/lib/api/authenticated-client";
import { toQueryString } from "@/features/discovery/params";

import type { Order, OrderFilters, OrderListResponse } from "@/features/orders/types";

export function getOrders(filters: OrderFilters) {
  return authenticatedApiFetch<OrderListResponse>(`/api/v1/orders/${toQueryString(filters as Record<string, string | number | boolean | null | undefined>)}`);
}

export function getOrderDetail(orderId: string | number) {
  return authenticatedApiFetch<Order>(`/api/v1/orders/${orderId}/`);
}
