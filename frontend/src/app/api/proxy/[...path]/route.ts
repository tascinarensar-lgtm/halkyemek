import { NextRequest, NextResponse } from "next/server";

import { clearSessionCookies, cookieNames, getCookieStore, setAccessCookie } from "@/lib/auth/cookies";
import { env } from "@/lib/config/env";
import { refreshBackendAccessToken } from "@/lib/auth/backend-auth";
import { isJwtExpired } from "@/lib/auth/session";

const forbiddenProxyPrefixes = ["api/v1/auth/google/", "api/v1/auth/refresh/"];
const refreshInFlight = new Map<string, Promise<string | null>>();
const upstreamPathHeaderName = "x-hy-upstream-path";
const multipartContentType = "multipart/form-data";
const upstreamTimeoutMs = 15_000;

function shouldBlockProxyPath(path: string) {
  return forbiddenProxyPrefixes.some((prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix));
}

function buildErrorResponse(status: number, code: string, message: string, requestId?: string | null) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(requestId ? { request_id: requestId } : {}),
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(requestId ? { "X-Request-ID": requestId } : {}),
      },
    },
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function trimLeadingSlashes(path: string) {
  return path.replace(/^\/+/, "");
}

function trimTrailingSlashes(path: string) {
  return path.replace(/\/+$/, "");
}

async function refreshAccessToken(refreshToken: string) {
  const existing = refreshInFlight.get(refreshToken);
  if (existing) {
    return existing;
  }

  const refreshPromise = (async () => {
    try {
      const refreshed = await refreshBackendAccessToken(refreshToken);
      await setAccessCookie(refreshed.access);
      return refreshed.access;
    } catch {
      await clearSessionCookies();
      return null;
    } finally {
      refreshInFlight.delete(refreshToken);
    }
  })();

  refreshInFlight.set(refreshToken, refreshPromise);
  return refreshPromise;
}

async function ensureAccessToken(forceRefresh = false) {
  const store = await getCookieStore();
  const refresh = store.get(cookieNames.refresh)?.value;
  const access = store.get(cookieNames.access)?.value;

  if (!forceRefresh && access && !isJwtExpired(access)) {
    return access;
  }

  if (!refresh) {
    await clearSessionCookies();
    return null;
  }

  return refreshAccessToken(refresh);
}

function buildProxyHeaders(request: NextRequest, token: string, options?: { omitContentType?: boolean }) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: request.headers.get("accept") || "application/json",
    ...(!options?.omitContentType && request.headers.get("content-type")
      ? { "Content-Type": request.headers.get("content-type") as string }
      : {}),
    ...(request.headers.get("x-request-id") ? { "X-Request-ID": request.headers.get("x-request-id") as string } : {}),
    ...(request.headers.get("idempotency-key") ? { "Idempotency-Key": request.headers.get("idempotency-key") as string } : {}),
  };
}

async function forwardRequest(
  request: NextRequest,
  path: string,
  token: string,
  rawBody?: BodyInit,
  options?: { omitContentType?: boolean },
) {
  const search = request.nextUrl.search || "";
  const url = `${env.NEXT_PUBLIC_API_BASE_URL}/${path}${search}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);

  try {
    return await fetch(url, {
      method: request.method,
      headers: buildProxyHeaders(request, token, options),
      body: rawBody ? rawBody : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function toClientResponse(response: Response) {
  const requestId = response.headers.get("x-request-id");
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!response.ok && !contentType.toLowerCase().includes("application/json")) {
    const code = response.status >= 500 ? "proxy_upstream_error" : "proxy_unexpected_response";
    const message = response.status >= 500 ? "Sunucu yanıtı işlenemedi." : "Beklenmeyen bir yanıt alındı.";
    return buildErrorResponse(response.status, code, message, requestId);
  }

  return new NextResponse(text, {
    status: response.status,
    headers: {
      "Content-Type": contentType || "application/json",
      ...(requestId ? { "X-Request-ID": requestId } : {}),
      "Cache-Control": "no-store",
    },
  });
}

function buildUpstreamPath(request: NextRequest, segments: string[]) {
  const path = segments.filter(Boolean).join("/");
  if (!path) {
    return path;
  }

  const explicitUpstreamPath = request.headers.get(upstreamPathHeaderName);
  if (explicitUpstreamPath) {
    const normalizedExplicitPath = trimLeadingSlashes(explicitUpstreamPath);
    if (trimTrailingSlashes(normalizedExplicitPath) === trimTrailingSlashes(path)) {
      return normalizedExplicitPath;
    }
  }

  return request.nextUrl.pathname.endsWith("/") ? `${path}/` : path;
}

async function handle(request: NextRequest, params: { path: string[] }) {
  const normalizedPath = buildUpstreamPath(request, params.path);
  if (!normalizedPath) {
    return buildErrorResponse(400, "invalid_proxy_path", "Proxy path is missing.");
  }

  if (shouldBlockProxyPath(normalizedPath)) {
    return buildErrorResponse(400, "invalid_proxy_path", "Bu auth endpoint proxy üzerinden çağrılamaz.");
  }

  const contentType = request.headers.get("content-type") || "";
  const isMultipart = contentType.toLowerCase().includes(multipartContentType);
  const rawBody =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : isMultipart
        ? await request.formData()
        : await request.text();
  let token = await ensureAccessToken();
  if (!token) {
    return buildErrorResponse(401, "unauthorized", "Session not found");
  }

  let response: Response;
  try {
    response = await forwardRequest(request, normalizedPath, token, rawBody, { omitContentType: isMultipart });
  } catch (error) {
    return isAbortError(error)
      ? buildErrorResponse(504, "proxy_upstream_timeout", "Sunucu yanıtı zamanında tamamlanmadı. Lütfen tekrar dene.")
      : buildErrorResponse(502, "proxy_network_error", "Backend proxy isteği tamamlanamadı.");
  }

  if (response.status === 401) {
    const refreshedToken = await ensureAccessToken(true);
    if (!refreshedToken) {
      return buildErrorResponse(401, "unauthorized", "Session expired");
    }

    token = refreshedToken;
    try {
      response = await forwardRequest(request, normalizedPath, token, rawBody, { omitContentType: isMultipart });
    } catch (error) {
      return isAbortError(error)
        ? buildErrorResponse(504, "proxy_upstream_timeout", "Sunucu yanıtı zamanında tamamlanmadı. Lütfen tekrar dene.")
        : buildErrorResponse(502, "proxy_network_error", "Backend proxy isteği tamamlanamadı.");
    }

    if (response.status === 401) {
      await clearSessionCookies();
      return buildErrorResponse(401, "unauthorized", "Session expired", response.headers.get("x-request-id"));
    }
  }

  return toClientResponse(response);
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, await context.params);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, await context.params);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, await context.params);
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, await context.params);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handle(request, await context.params);
}
