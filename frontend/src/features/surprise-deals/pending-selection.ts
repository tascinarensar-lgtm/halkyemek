"use client";

import type { SurpriseDealPublic } from "@/features/surprise-deals/types";

const STORAGE_KEY = "hy_pending_surprise_deal";

export type PendingSurpriseDealSelection = {
  deal_id: number;
  business_id: number;
  business_name: string;
  title: string;
  description: string;
  image_url: string;
  sale_price_amount: number;
  original_value_amount: number;
  currency: string;
  quantity_remaining: number;
  pickup_window_start: string;
  pickup_window_end: string;
  grams: number | null;
  min_contents_note: string;
  allergens_note: string | null;
};

function isBrowser() {
  return typeof window !== "undefined";
}

export function buildPendingSurpriseDealSelection(deal: SurpriseDealPublic): PendingSurpriseDealSelection {
  return {
    deal_id: deal.id,
    business_id: deal.business.id,
    business_name: deal.business.name,
    title: deal.title,
    description: deal.description || "",
    image_url: deal.image_url || "",
    sale_price_amount: deal.sale_price_amount,
    original_value_amount: deal.original_value_amount,
    currency: deal.currency,
    quantity_remaining: deal.quantity_remaining,
    pickup_window_start: deal.pickup_window_start,
    pickup_window_end: deal.pickup_window_end,
    grams: deal.grams,
    min_contents_note: deal.min_contents_note || "",
    allergens_note: deal.allergens_note || null,
  };
}

export function savePendingSurpriseDealSelection(selection: PendingSurpriseDealSelection) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
}

export function getPendingSurpriseDealSelection(): PendingSurpriseDealSelection | null {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingSurpriseDealSelection;
    if (!parsed?.deal_id || !parsed?.business_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingSurpriseDealSelection() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}
