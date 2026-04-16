import type { ReadonlyURLSearchParams } from "next/navigation";

import { env } from "@/lib/config/env";

const VALID_DISTRICT_CODES = new Set(["BEYLIKDUZU"]);

export function resolveDistrict(value?: string | null) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized && VALID_DISTRICT_CODES.has(normalized)) {
    return normalized;
  }
  return env.NEXT_PUBLIC_DEFAULT_DISTRICT;
}

export function parseBooleanParam(value?: string | null, fallback = true) {
  if (value == null) return fallback;
  return value === "true" || value === "1";
}

export function resolvePositiveIntegerParam(value?: string | null, fallback = 0) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

export function resolvePageParam(value?: string | null, fallback = 1) {
  return resolvePositiveIntegerParam(value, fallback);
}

export function getStringParam(value?: string | string[] | null, fallback = "") {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export function buildUpdatedSearchParams(
  current: URLSearchParams | ReadonlyURLSearchParams,
  updates: Record<string, string | number | boolean | null | undefined>,
) {
  const next = new URLSearchParams(current.toString());

  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      next.delete(key);
      return;
    }

    next.set(key, String(value));
  });

  return next;
}

export function withSearchParams(pathname: string, params: Record<string, string | number | boolean | null | undefined>) {
  const query = toQueryString(params);
  return `${pathname}${query}`;
}

export function toQueryString(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });

  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}
