import { env } from "@/lib/config/env";
import { ApiClientError, parseJsonResponse } from "@/lib/api/errors";
import type { BackendSessionPayload, LoginResponse } from "@/types/auth";
import type { ApiErrorEnvelope } from "@/types/api";

interface BackendSessionEnvelope {
  ok: boolean;
  data: BackendSessionPayload;
}

export async function loginWithGoogleIdToken(idToken: string) {
  const response = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/api/v1/auth/google/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id_token: idToken }),
    cache: "no-store",
  });

  const payload = await parseJsonResponse<LoginResponse | ApiErrorEnvelope>(response);
  if (!response.ok) {
    if (payload && "error" in payload) {
      throw new ApiClientError("Login failed", response.status, payload);
    }
    throw new ApiClientError("Login failed", response.status);
  }

  if (!payload || !("access" in payload)) {
    throw new ApiClientError("Login response is invalid.", 502);
  }

  return payload;
}

export async function refreshBackendAccessToken(refresh: string) {
  const response = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/api/v1/auth/refresh/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh }),
    cache: "no-store",
  });

  const payload = await parseJsonResponse<{ access?: string } | ApiErrorEnvelope>(response);
  if (!response.ok || !payload || !("access" in payload) || typeof payload.access !== "string") {
    if (payload && "error" in payload) {
      throw new ApiClientError("Refresh failed", response.status, payload);
    }
    throw new ApiClientError("Refresh failed", response.status || 500);
  }

  return { access: payload.access };
}

export async function fetchBackendSession(accessToken: string) {
  const response = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/api/v1/auth/me/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = await parseJsonResponse<BackendSessionEnvelope | ApiErrorEnvelope>(response);
  if (!response.ok) {
    if (payload && "error" in payload) {
      throw new ApiClientError("Session fetch failed", response.status, payload);
    }
    throw new ApiClientError("Session fetch failed", response.status || 500);
  }

  if (!payload || !("data" in payload) || !payload.data) {
    throw new ApiClientError("Session response is invalid.", 502);
  }

  return payload.data;
}
