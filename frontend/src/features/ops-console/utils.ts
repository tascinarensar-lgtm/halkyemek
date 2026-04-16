import type { QueryClient } from "@tanstack/react-query";

export function normalizeOpsId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function asText(value: unknown, fallback = "-"): string {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

export function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return JSON.stringify({ error: "unserializable_value" }, null, 2);
  }
}

export function parseJsonObjectInput(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload JSON nesne formatında olmalı.");
  }
  return parsed as Record<string, unknown>;
}

export function isPayoutTerminalStatus(status: unknown) {
  const normalized = asText(status, "").toUpperCase();
  return normalized === "CONFIRMED" || normalized === "CANCELLED";
}

export function canManuallyConfirmPayout(status: unknown) {
  const normalized = asText(status, "").toUpperCase();
  return normalized === "SENT" || normalized === "FAILED" || normalized === "DISPATCHING";
}

export function isSettlementReviewEditable(isPending: boolean, canReview: unknown) {
  return !isPending && Boolean(canReview);
}

export function hasNonEmptyText(value: string | null | undefined) {
  return Boolean(value && value.trim());
}

export async function invalidateOpsQueries(queryClient: QueryClient, queryKeys: readonly unknown[][]) {
  await Promise.all(
    queryKeys.map(async (queryKey) => {
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.refetchQueries({ queryKey, type: "active" });
    }),
  );
}
