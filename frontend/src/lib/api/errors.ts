import type { ApiErrorEnvelope } from "@/types/api";

export class ApiClientError extends Error {
  status: number;
  envelope?: ApiErrorEnvelope;

  constructor(message: string, status: number, envelope?: ApiErrorEnvelope) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.envelope = envelope;
  }
}

function tryParseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function readResponseBody(response: Response) {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: "", json: undefined } as const;
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const shouldTryJson = contentType.includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[");

  return {
    text,
    json: shouldTryJson ? tryParseJson<unknown>(text) : undefined,
  } as const;
}

export async function parseJsonResponse<T>(response: Response): Promise<T | undefined> {
  const { json } = await readResponseBody(response);
  return json as T | undefined;
}

export async function toApiClientError(response: Response) {
  const { text, json } = await readResponseBody(response);
  const payload = json as ApiErrorEnvelope | undefined;
  const headerRequestId = response.headers.get("x-request-id") ?? undefined;
  const fallbackMessage = text.trim() || response.statusText || "Request failed";

  return new ApiClientError(
    payload?.error?.message && typeof payload.error.message === "string"
      ? payload.error.message
      : payload?.error?.code || payload?.error?.request_id || fallbackMessage,
    response.status,
    payload
      ? {
          ...payload,
          error: {
            ...payload.error,
            request_id: payload.error.request_id ?? headerRequestId,
          },
        }
      : undefined,
  );
}

function flattenUnknownMessage(input: unknown): string | undefined {
  if (typeof input === "string") {
    const message = input.trim();
    return message || undefined;
  }

  if (Array.isArray(input)) {
    const parts = input.map(flattenUnknownMessage).filter(Boolean);
    return parts.length ? parts.join(" ") : undefined;
  }

  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const preferred = [record.message, record.detail, record.error];

    for (const candidate of preferred) {
      const resolved = flattenUnknownMessage(candidate);
      if (resolved) return resolved;
    }

    const values = Object.values(record).map(flattenUnknownMessage).filter(Boolean);
    return values.length ? values.join(" ") : undefined;
  }

  return undefined;
}

function normalizeUserFacingMessage(message: string | undefined, fallback: string) {
  const normalized = (message || "").trim();
  if (!normalized) return fallback;

  const lower = normalized.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed") || lower.includes("fetch failed")) {
    return "Sunucuya şu anda ulaşılamıyor. İnternet bağlantınızı veya backend erişimini kontrol edip tekrar deneyin.";
  }

  if (
    lower.includes("1001:api bilgileri bulunamadı")
    || lower.includes("iyzico.keys_not_configured")
    || lower.includes("iyzico.placeholder_keys_not_configured")
  ) {
    return "Bakiye yükleme şu anda başlatılamıyor. Ödeme altyapısının API bilgileri henüz tanımlı değil.";
  }

  if (lower.includes("unexpected token") || lower.includes("json") && lower.includes("parse")) {
    return "Sunucudan beklenen formatta yanıt alınamadı. Lütfen kısa süre sonra tekrar deneyin.";
  }

  if (["request failed", "bad request", "internal server error", "server error"].includes(lower)) {
    return fallback;
  }

  return normalized;
}

export function getApiErrorMessage(error: unknown, fallback = "İşlem başarısız.") {
  if (error instanceof ApiClientError) {
    const message = flattenUnknownMessage(error.envelope?.error?.message);
    if (message) return normalizeUserFacingMessage(message, fallback);
  }

  const directMessage = flattenUnknownMessage(error);
  if (directMessage) {
    return normalizeUserFacingMessage(directMessage, fallback);
  }

  if (error instanceof Error && error.message) {
    return normalizeUserFacingMessage(error.message, fallback);
  }
  return fallback;
}

export function getApiErrorCode(error: unknown) {
  return error instanceof ApiClientError ? error.envelope?.error?.code : undefined;
}

export function getApiRequestId(error: unknown) {
  return error instanceof ApiClientError ? error.envelope?.error?.request_id : undefined;
}

export function isNotificationReadinessError(error: unknown) {
  return getApiErrorCode(error) === "NOTIFICATION_NOT_READY";
}

export function getApiErrorDetails(error: unknown) {
  return error instanceof ApiClientError ? error.envelope?.error?.details : undefined;
}
