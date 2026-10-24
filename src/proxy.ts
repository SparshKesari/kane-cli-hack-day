import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  PRINCIPAL_HEADER,
  TESTMU_COOKIE,
  classifyPath,
  connectPath,
  credentialsFrom,
  hasStaffCookie,
  keyFingerprint,
  keyRequired,
  signValue,
  unsignValue,
  type TestmuSession,
} from "@/lib/testmu-gate";
import { findKnownKey } from "@/lib/testmu-keystore";
import { checkAccessKey, type VerifyResult } from "@/lib/testmu-verify";

// The TestMu AI access-key gate (docs/api/TESTMU_ACCESS.md). Runs before every
// route; cheap when TESTMU_KEY_REQUIRED is off and no key headers are sent.
//
//   key headers sent  → matched against keys TestMu gave us at activation
//                       (testmu_links fingerprint), else checked with TestMu when
//                       TESTMU_VERIFY_URL is set; cached per instance. Valid → a
//                       60-second signed principal is forwarded for getMember();
//                       invalid → 401, whatever the switch says.
//   switch on, API    → needs the hd_testmu cookie, valid key headers, or a staff cookie.
//   switch on, page   → participant pages redirect to TestMu connect without the cookie.
// Route handlers and server actions still authorize the person themselves; this
// only decides whether a TestMu key stands behind the request.

const OK_TTL_MS = 5 * 60_000;
const BAD_TTL_MS = 30_000;
type Checked = VerifyResult & { memberId?: number | null };
const cache = new Map<string, { at: number; result: Checked }>();

async function checkKey(c: { username: string; accessKey: string }): Promise<Checked> {
  try {
    const known = await findKnownKey(c);
    if (known) return { ok: true, username: c.username, email: null, memberId: known.memberId };
  } catch {
    return { ok: false, reason: "unavailable", detail: "key store unreachable" };
  }
  return checkAccessKey(c);
}

async function checkCached(c: { username: string; accessKey: string }) {
  const fp = keyFingerprint(c);
  const hit = cache.get(fp);
  if (hit && Date.now() - hit.at < (hit.result.ok ? OK_TTL_MS : BAD_TTL_MS)) return hit.result;
  const result = await checkKey(c);
  if (result.ok || result.reason === "invalid") {
    if (cache.size > 5000) cache.clear();
    cache.set(fp, { at: Date.now(), result });
  }
  return result;
}

function deny(code: "TESTMU_KEY_REQUIRED" | "TESTMU_UNAVAILABLE", message: string, pathname: string) {
  const requestId = randomUUID();
  const status = code === "TESTMU_KEY_REQUIRED" ? 401 : 503;
  const next = code === "TESTMU_KEY_REQUIRED" ? "Sign in to TestMu AI, or send X-TestMu-Username and X-TestMu-Access-Key." : "Try again in a minute, or ask at the help desk.";
  return NextResponse.json(
    {
      schema_version: 1,
      status: "error",
      message,
      data: null,
      evidence: [],
      actions: [{ id: "connect_testmu", label: "Connect TestMu AI", requires_human_confirmation: false, href: connectPath(pathname) }],
      links: [],
      ui_resource: null,
      ui_type: null,
      design_version: "kane-hack-os@1",
      fallback: { text: `${message} ${next}` },
      freshness: null,
      warnings: [],
      error: { code, message, next_action: next, manual_route: "/api/v1/auth/testmu/start", details: null },
      request_id: requestId,
      server_time: new Date().toISOString(),
    },
    { status, headers: { "x-request-id": requestId, ...(status === 401 ? { "www-authenticate": 'Basic realm="TestMu AI"' } : {}) } },
  );
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const kind = classifyPath(pathname);
  if (kind === "open") return NextResponse.next();

  const forwarded = new Headers(req.headers);
  forwarded.delete(PRINCIPAL_HEADER); // only this proxy may set it

  const creds = kind === "api" || kind === "public_api" ? credentialsFrom(req.headers) : null;
  if (creds) {
    const r = await checkCached(creds);
    if (!r.ok) {
      return r.reason === "invalid"
        ? deny("TESTMU_KEY_REQUIRED", "That TestMu AI username and access key were not accepted.", pathname)
        : deny("TESTMU_UNAVAILABLE", "We couldn't check your TestMu AI access key right now.", pathname);
    }
    forwarded.set(PRINCIPAL_HEADER, signValue({ u: r.username, e: r.email, m: r.memberId ?? null, exp: Date.now() + 60_000 } satisfies TestmuSession));
    // A Basic header carried the key; don't let it reach handlers that read Authorization as a bearer.
    if (/^Basic\s/i.test(req.headers.get("authorization") ?? "")) forwarded.delete("authorization");
    return NextResponse.next({ request: { headers: forwarded } });
  }

  if (!keyRequired() || kind === "public_api" || kind === "other") return NextResponse.next({ request: { headers: forwarded } });

  const hasKeyCookie = !!unsignValue<TestmuSession>(req.cookies.get(TESTMU_COOKIE)?.value);
  const isStaff = hasStaffCookie(req.cookies.get("hd_staff")?.value, req.cookies.get("hd_admin")?.value);
  if (hasKeyCookie || isStaff) return NextResponse.next({ request: { headers: forwarded } });

  if (kind === "page") return NextResponse.redirect(new URL(connectPath(`${pathname}${search}`), req.url));
  return deny("TESTMU_KEY_REQUIRED", "Connect your TestMu AI account first: this needs your TestMu AI access key.", pathname);
}

export const config = {
  // Everything except build assets and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|woff2?)$).*)"],
};
