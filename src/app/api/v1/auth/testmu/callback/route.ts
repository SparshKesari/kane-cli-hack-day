import { NextResponse } from "next/server";
import { envelopeResponse } from "@/server/core";
import { finishConnect } from "@/server/testmu";

// GET|POST /api/v1/auth/testmu/callback
//   ?state=…&username=…&access_key=…   (names: TESTMU_CALLBACK_USERNAME_PARAM / _KEY_PARAM)
//   ?state=…&code=…                     (exchanged at TESTMU_TOKEN_URL)
// POST accepts the same fields form-encoded (response_mode=form_post keeps the
// key out of URLs and logs). On success: hd_testmu cookie, a personal session
// when the TestMu email matches a registration, and a redirect to `next`.

async function finish(req: Request, params: URLSearchParams) {
  try {
    return NextResponse.redirect(new URL(await finishConnect(params), req.url), 303);
  } catch (e) {
    return envelopeResponse(async () => {
      throw e;
    });
  }
}

export async function GET(req: Request) {
  return finish(req, new URL(req.url).searchParams);
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const params = new URLSearchParams();
  form?.forEach((v, k) => typeof v === "string" && params.set(k, v));
  return finish(req, params);
}
