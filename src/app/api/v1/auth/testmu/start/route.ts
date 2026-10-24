import { NextResponse } from "next/server";
import { envelopeResponse } from "@/server/core";
import { startConnect } from "@/server/testmu";

// GET /api/v1/auth/testmu/start?next=/team
// Sends the browser to TestMu AI to register / log in / connect. TestMu comes
// back to /api/v1/auth/testmu/callback with the access key. `next` must be a
// participant page (src/lib/next-path.ts); anything else returns to /passport.

export async function GET(req: Request) {
  try {
    return NextResponse.redirect(new URL(await startConnect(new URL(req.url).searchParams.get("next")), req.url));
  } catch (e) {
    return envelopeResponse(async () => {
      throw e;
    });
  }
}
