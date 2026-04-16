import { NextResponse } from "next/server";

import { getSessionState } from "@/lib/auth/session";
import { cookieNames, getCookieStore } from "@/lib/auth/cookies";

export async function POST() {
  const store = await getCookieStore();
  const refresh = store.get(cookieNames.refresh)?.value;
  if (!refresh) {
    return NextResponse.json(
      { ok: false, error: { code: "refresh_missing", message: "Refresh token bulunamadı." } },
      { status: 401 },
    );
  }

  const session = await getSessionState();
  if (!session.isAuthenticated) {
    return NextResponse.json(
      { ok: false, error: { code: "refresh_failed", message: "Oturum yenilenemedi." } },
      { status: 401 },
    );
  }

  return NextResponse.json({ ok: true, data: session }, { headers: { "Cache-Control": "no-store" } });
}
