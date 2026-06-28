import { notifyAuthStateCleared } from "@/lib/auth/events";
import { createIdempotencyKey, createRequestId } from "@/lib/utils/request";
import { parseJsonResponse, toApiClientError } from "@/lib/api/errors";
import { repairTextPayload } from "@/lib/utils/text";

export interface AuthenticatedFetchOptions extends RequestInit {
  useIdempotencyKey?: boolean;
}

const upstreamPathHeaderName = "X-HY-Upstream-Path";

function normalizeProxyPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function buildProxyHeaders(path: string, init?: AuthenticatedFetchOptions) {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Request-ID", createRequestId());
  headers.set(upstreamPathHeaderName, path);

  if (init?.useIdempotencyKey && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", createIdempotencyKey());
  }

  return headers;
}

export async function authenticatedApiFetch<T>(path: string, init?: AuthenticatedFetchOptions): Promise<T> {
  const normalizedPath = normalizeProxyPath(path);
  let response: Response;

  try {
    response = await fetch(`/api/proxy${normalizedPath}`, {
      ...init,
      headers: buildProxyHeaders(normalizedPath, init),
      cache: init?.cache ?? "no-store",
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Ağ isteği tamamlanamadı.");
  }

  if (!response.ok) {
    if (response.status === 401) {
      notifyAuthStateCleared("unauthorized");
    }
    throw await toApiClientError(response);
  }

  return repairTextPayload(((await parseJsonResponse<T>(response)) ?? null) as T);
}
