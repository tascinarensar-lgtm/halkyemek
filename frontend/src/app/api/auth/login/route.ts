import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { loginWithGoogleIdToken } from "@/lib/auth/backend-auth";
import { ApiClientError, getApiErrorMessage } from "@/lib/api/errors";
import { persistLoginSession } from "@/lib/auth/session";

const bodySchema = z.object({
  idToken: z.string().min(10),
});

const redirectBodySchema = z.object({
  credential: z.string().min(10),
  g_csrf_token: z.string().min(1),
});

function getSafeNextPath(candidate: string | null) {
  if (!candidate || !candidate.startsWith("/")) {
    return "/";
  }

  return candidate.startsWith("//") ? "/" : candidate;
}

async function parseBody(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    return await request.json();
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return Object.fromEntries(formData.entries());
  }

  const raw = await request.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
}

function validateGoogleCsrf(request: NextRequest, csrfToken: string) {
  const csrfCookie = request.cookies.get("g_csrf_token")?.value ?? "";
  return Boolean(csrfCookie) && csrfCookie === csrfToken;
}

export async function POST(request: NextRequest) {
  const nextPath = getSafeNextPath(request.nextUrl.searchParams.get("next"));
  let isRedirectSubmission = false;

  try {
    const body = await parseBody(request);

    if (body && typeof body === "object" && "credential" in body) {
      isRedirectSubmission = true;
      const parsed = redirectBodySchema.parse(body);

      if (!validateGoogleCsrf(request, parsed.g_csrf_token)) {
        return NextResponse.redirect(new URL("/giris?error=csrf", request.url), { status: 303 });
      }

      const payload = await loginWithGoogleIdToken(parsed.credential);
      await persistLoginSession(payload);
      return NextResponse.redirect(new URL(nextPath, request.url), { status: 303 });
    }

    const parsed = bodySchema.parse(body);
    const payload = await loginWithGoogleIdToken(parsed.idToken);
    const session = await persistLoginSession(payload);
    return NextResponse.json(session);
  } catch (error) {
    if (isRedirectSubmission) {
      const redirectUrl = new URL("/giris", request.url);
      if (nextPath !== "/") {
        redirectUrl.searchParams.set("next", nextPath);
      }
      redirectUrl.searchParams.set("error", "login_failed");
      return NextResponse.redirect(redirectUrl, { status: 303 });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: { code: "validation_error", message: error.flatten().fieldErrors } }, { status: 400 });
    }
    if (error instanceof ApiClientError) {
      return NextResponse.json(
        error.envelope ?? { ok: false, error: { code: "login_failed", message: getApiErrorMessage(error, "Login failed") } },
        { status: error.status || 400 },
      );
    }
    return NextResponse.json({ ok: false, error: { code: "login_failed", message: getApiErrorMessage(error, "Login failed") } }, { status: 400 });
  }
}
