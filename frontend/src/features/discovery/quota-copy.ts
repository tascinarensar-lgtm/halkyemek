export type MenuQuotaLike = {
  quota_enabled?: boolean;
  quota_remaining?: number | null;
  quota_label?: string | null;
  is_sold_out?: boolean;
};

export type BusinessMenuQuotaLike = {
  menu_quota_item_count?: number | null;
  menu_quota_remaining?: number | null;
  menu_quota_label?: string | null;
  menu_quota_is_sold_out?: boolean;
};

export type QuotaDisplayTone = "available" | "low" | "sold_out";

export function getMenuQuotaDisplayText(item: MenuQuotaLike | null | undefined) {
  if (!item?.quota_enabled) return null;
  if (item.is_sold_out || item.quota_remaining === 0) return "Hepsi tükendi";
  if (typeof item.quota_remaining === "number" && Number.isFinite(item.quota_remaining) && item.quota_remaining > 0) {
    return `${item.quota_remaining} adet bulunmakta`;
  }
  return item.quota_label ?? null;
}

export function getMenuQuotaDisplayTone(item: MenuQuotaLike | null | undefined): QuotaDisplayTone {
  if (!item || item.is_sold_out || item.quota_remaining === 0) return "sold_out";
  if (item.quota_label?.startsWith("Son ")) return "low";
  return "available";
}

export function getBusinessMenuQuotaDisplayText(business: BusinessMenuQuotaLike | null | undefined) {
  const itemCount = Number(business?.menu_quota_item_count ?? 0);
  if (!Number.isFinite(itemCount) || itemCount <= 0) return null;
  if (business?.menu_quota_is_sold_out || business?.menu_quota_remaining === 0) return "Hepsi tükendi";
  if (typeof business?.menu_quota_remaining === "number" && Number.isFinite(business.menu_quota_remaining) && business.menu_quota_remaining > 0) {
    return `${business.menu_quota_remaining} adet bulunmakta`;
  }
  return business?.menu_quota_label ?? null;
}

export function getBusinessMenuQuotaDisplayTone(business: BusinessMenuQuotaLike | null | undefined): QuotaDisplayTone {
  if (!business || business.menu_quota_is_sold_out || business.menu_quota_remaining === 0) return "sold_out";
  return "available";
}
