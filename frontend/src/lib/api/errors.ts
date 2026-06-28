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
    return "Bağlantı kurulamadı. Lütfen tekrar deneyin.";
  }

  if (lower.includes("proxy_upstream_error") || lower.includes("sunucu yanıtı işlenemedi")) {
    return "Sunucu yanıtı alınamadı. Sayfayı yenileyip tekrar deneyin.";
  }

  if (
    lower.includes("authentication credentials were not provided")
    || lower.includes("not authenticated")
    || lower.includes("invalid token")
    || lower.includes("token is invalid")
  ) {
    return "Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.";
  }

  if (lower.includes("permission denied") || lower.includes("you do not have permission")) {
    return "Bu işlem için yetkiniz yok.";
  }

  if (lower === "not found" || lower.includes("no ") && lower.includes("matches the given query")) {
    return "Aradığınız kayıt bulunamadı.";
  }

  if (lower.includes("throttled") || lower.includes("too many requests")) {
    return "Çok hızlı işlem yapıldı. Kısa süre sonra tekrar deneyin.";
  }

  if (
    lower.includes("1001:api bilgileri bulunamadı")
    || lower.includes("iyzico.keys_not_configured")
    || lower.includes("iyzico.placeholder_keys_not_configured")
  ) {
    return "Ödeme altyapısı henüz hazır değil.";
  }

  if (lower.includes("unexpected token") || lower.includes("json") && lower.includes("parse")) {
    return "Sunucu yanıtı işlenemedi. Lütfen tekrar deneyin.";
  }

  if (
    [
      "request failed",
      "bad request",
      "internal server error",
      "server error",
      "network error",
      "login failed",
    ].includes(lower)
  ) {
    return fallback;
  }

  return normalized;
}

function getStatusFallback(status: number, fallback: string) {
  if (status === 400) return "Bilgileri kontrol edip tekrar deneyin.";
  if (status === 401) return "Oturum süreniz dolmuş. Lütfen tekrar giriş yapın.";
  if (status === 403) return "Bu işlem için yetkiniz yok.";
  if (status === 404) return "Aradığınız kayıt bulunamadı.";
  if (status === 409) return "Bu işlem şu anda tamamlanamıyor.";
  if (status === 410) return "Bu bağlantının süresi dolmuş.";
  if (status === 429) return "Çok hızlı işlem yapıldı. Kısa süre sonra tekrar deneyin.";
  if (status >= 500) return "Sunucuda kısa süreli bir sorun oluştu. Lütfen tekrar deneyin.";
  return fallback;
}

function getCodeFallback(code: string | undefined, fallback: string) {
  if (!code) return fallback;

  const normalizedCode = code.toUpperCase();
  if (normalizedCode === "NOTIFICATION_NOT_READY") return "Bildirim izni tamamlanınca devam edebilirsiniz.";
  if (normalizedCode.includes("INSUFFICIENT")) return "Bakiye yetersiz. Cüzdanınıza bakiye yükleyip tekrar deneyin.";
  if (normalizedCode.includes("EXPIRED")) return "Bu işlem süresi dolmuş. Lütfen yeniden başlatın.";
  if (normalizedCode.includes("ALREADY_CONSUMED")) return "Bu QR daha önce kullanılmış.";
  if (normalizedCode === "MENU_ITEM_SOLD_OUT") return "Bu ürün az önce tükendi.";
  if (normalizedCode === "MENU_ITEM_QUOTA_EXCEEDED") return "Sepetteki miktar kalan kotayı aşıyor.";
  if (normalizedCode.includes("NOT_FOUND")) return "Aradığınız kayıt bulunamadı.";
  if (normalizedCode.includes("PERMISSION") || normalizedCode.includes("FORBIDDEN")) return "Bu işlem için yetkiniz yok.";

  return fallback;
}

export function getApiErrorMessage(error: unknown, fallback = "İşlem tamamlanamadı.") {
  if (error instanceof ApiClientError) {
    const codeFallback = getCodeFallback(error.envelope?.error?.code, getStatusFallback(error.status, fallback));
    const message = flattenUnknownMessage(error.envelope?.error?.message);
    if (message) return normalizeUserFacingMessage(message, codeFallback);
    return codeFallback;
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
