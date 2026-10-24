import { NextResponse } from "next/server";
import { toAppError } from "@/server/core";
import { startConnect } from "@/server/testmu";

// GET /api/v1/auth/testmu/start?next=/team
// Where the gate sends a browser without a TestMu AI key. Signed in as yourself:
// activates your TestMu AI account from your profile, then on to `next`. Not
// signed in: the profile at /register (or TestMu's own login page, when
// TESTMU_AUTH_URL is set). `next` must be a participant page (src/lib/next-path.ts).
// If activation fails, back to /register, which explains and offers a retry.

export async function GET(req: Request) {
  const next = new URL(req.url).searchParams.get("next");
  try {
    return NextResponse.redirect(new URL(await startConnect(next), req.url));
  } catch (e) {
    const err = toAppError(e);
    console.warn("[testmu] start failed", err.code, err.message);
    return NextResponse.redirect(new URL("/register?testmu=failed", req.url));
  }
}
