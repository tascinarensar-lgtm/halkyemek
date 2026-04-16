import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const cookiePrefix = process.env.SESSION_COOKIE_PREFIX ?? "hy";
const sessionCookieName = `${cookiePrefix}_session`;
const refreshCookieName = `${cookiePrefix}_refresh`;
const accessCookieName = `${cookiePrefix}_access`;

const protectedPrefixes = [
  "/sepet",
  "/checkout",
  "/siparislerim",
  "/cuzdan",
  "/bildirimler",
  "/hesabim",
  "/isletme",
  "/ops",
];

function getSafeNextValue(pathname: string, search: string) {
  const value = `${pathname}${search}`;
  return value.startsWith("/") ? value : pathname;
}

function parseSessionCookie(rawValue: string | undefined) {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as {
      isAuthenticated?: boolean;
      hasBusinessMembership?: boolean;
      user?: { role?: string | null } | null;
    };
  } catch {
    return null;
  }
}

function redirectTo(request: NextRequest, pathname: string, nextValue?: string) {
  const url = new URL(pathname, request.url);
  if (nextValue) {
    url.searchParams.set("next", nextValue);
  }
  return NextResponse.redirect(url);
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requiresAuth = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!requiresAuth) {
    return NextResponse.next();
  }

  const refreshCookie = request.cookies.get(refreshCookieName)?.value;
  const accessCookie = request.cookies.get(accessCookieName)?.value;
  const sessionCookie = request.cookies.get(sessionCookieName)?.value;
  const session = parseSessionCookie(sessionCookie);
  const nextValue = getSafeNextValue(pathname, search);

  if (!refreshCookie || !accessCookie || !sessionCookie || !session?.isAuthenticated) {
    return redirectTo(request, "/giris", nextValue);
  }

  if (pathname === "/ops" || pathname.startsWith("/ops/")) {
    if (session.user?.role !== "ADMIN") {
      return redirectTo(request, "/hesabim");
    }
  }

  if (pathname === "/isletme" || pathname.startsWith("/isletme/")) {
    if (!session.hasBusinessMembership) {
      return redirectTo(request, "/hesabim");
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|api/proxy).*)"],
};
