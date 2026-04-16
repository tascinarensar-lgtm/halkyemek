import { env } from "@/lib/config/env";
import { createRequestId } from "@/lib/utils/request";
import { parseJsonResponse, toApiClientError } from "@/lib/api/errors";

export async function publicApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "X-Request-ID": createRequestId(),
        ...(init?.headers ?? {}),
      },
      cache: init?.cache ?? "no-store",
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Ağ isteği tamamlanamadı.");
  }

  if (!response.ok) {
    throw await toApiClientError(response);
  }

  return ((await parseJsonResponse<T>(response)) ?? null) as T;
}
