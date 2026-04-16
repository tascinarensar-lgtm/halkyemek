import { NextResponse } from "next/server";

import { getSessionState } from "@/lib/auth/session";

export async function GET() {
  const session = await getSessionState();
  return NextResponse.json(session, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
