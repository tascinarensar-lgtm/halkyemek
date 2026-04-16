import { NextResponse } from "next/server";
import { z } from "zod";

import { getSessionState } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/auth/cookies";

const bodySchema = z.object({
  businessId: z.number().int().positive(),
});

export async function PATCH(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const session = await getSessionState();
    const matchedBusiness = session.businesses.find((item) => item.id === body.businessId);

    if (!session.isAuthenticated || !matchedBusiness) {
      return NextResponse.json(
        { ok: false, error: { code: "business_not_available", message: "Bu işletme oturum içinde görünmüyor." } },
        { status: 400 },
      );
    }

    const nextSession = { ...session, activeBusinessId: body.businessId };
    await setSessionCookie(nextSession);

    return NextResponse.json(nextSession);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: { code: "validation_error", message: error.flatten().fieldErrors } },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { ok: false, error: { code: "session_business_update_failed", message: "Aktif işletme güncellenemedi." } },
      { status: 500 },
    );
  }
}
