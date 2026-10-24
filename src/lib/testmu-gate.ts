import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// The TestMu AI access-key gate: pure helpers shared by src/proxy.ts and
// src/server/testmu.ts. No DB, no next/headers, so the proxy can import it.
//
// How a caller proves it holds a TestMu AI access key:
//   browser : the hd_testmu cookie, signed here after /api/v1/auth/testmu/callback
//             verified the key TestMu redirected back with. The raw key is never
//             stored in the cookie or the DB (only a fingerprint).
//   CLI/MCP : X-TestMu-Username + X-TestMu-Access-Key headers, or
//             Authorization: Basic base64(username:access_key). The proxy checks
//             the key with TestMu and forwards a short-lived signed principal
//             (x-testmu-principal) that getMember() trusts.
// Staff (hd_staff / hd_admin cookies) are not TestMu users and pass as staff.
//
// TESTMU_KEY_REQUIRED=true turns the gate on. Off (the default), a valid key
// still authenticates, but nothing is refused for lacking one.

export const TESTMU_COOKIE = "hd_testmu";
export const TESTMU_STATE_COOKIE = "hd_testmu_state";
export const PRINCIPAL_HEADER = "x-testmu-principal";
export const COOKIE_HOURS = 12;

/** `m` is the member id when known (keys we provisioned or linked). */
export type TestmuSession = { u: string; e: string | null; m?: number | null; exp: number };
export type TestmuPrincipal = TestmuSession;
export type TestmuState = { n: string; next: string; exp: number };

export function keyRequired(env: Record<string, string | undefined> = process.env) {
  return /^(1|true|on|yes)$/i.test(env.TESTMU_KEY_REQUIRED?.trim() ?? "");
}

// ── Signing (same base64url(JSON).HMAC shape as src/lib/session.ts) ─────────

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

export function signValue(payload: object, key = secret()) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", `testmu:${key}`).update(body).digest("base64url")}`;
}

export function unsignValue<T extends { exp: number }>(token: string | null | undefined, now = Date.now(), key = secret()): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", `testmu:${key}`).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return typeof v?.exp === "number" && v.exp > now ? v : null;
  } catch {
    return null;
  }
}

/** Staff cookies are signed by src/lib/session.ts (plain SESSION_SECRET, no prefix). */
export function hasStaffCookie(staff: string | undefined, admin: string | undefined, now = Date.now(), key = secret()) {
  for (const [token, check] of [
    [staff, (v: { exp?: number }) => typeof v.exp === "number" && v.exp > now],
    [admin, (v: { admin?: boolean }) => v.admin === true],
  ] as const) {
    if (!token) continue;
    const [body, mac] = token.split(".");
    if (!body || !mac) continue;
    const expected = createHmac("sha256", key).update(body).digest();
    const given = Buffer.from(mac, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) continue;
    try {
      if ((check as (v: unknown) => boolean)(JSON.parse(Buffer.from(body, "base64url").toString()))) return true;
    } catch {}
  }
  return false;
}

// ── Credentials from a request ───────────────────────────────────────────────

export type KeyCredentials = { username: string; accessKey: string };

/** X-TestMu-Username/X-TestMu-Access-Key, or Authorization: Basic. Bearer is left to pairing tokens. */
export function credentialsFrom(headers: Headers): KeyCredentials | null {
  const u = headers.get("x-testmu-username")?.trim();
  const k = headers.get("x-testmu-access-key")?.trim();
  if (u && k) return { username: u, accessKey: k };
  const auth = headers.get("authorization") ?? "";
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(auth.trim());
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString();
  const i = decoded.indexOf(":");
  if (i <= 0 || i === decoded.length - 1) return null;
  return { username: decoded.slice(0, i), accessKey: decoded.slice(i + 1) };
}

/** What we keep instead of the key: enough to notice a rotated key, useless to an attacker. */
export const keyFingerprint = (c: KeyCredentials) => createHash("sha256").update(`testmu-key:${c.username}:${c.accessKey}`).digest("hex");

// ── Which paths the gate covers ──────────────────────────────────────────────

/**
 * Participant pages: the same list personal sign-in may return to (src/lib/next-path.ts),
 * minus /register and /passport/login: that's where the access key comes from.
 */
const GATED_PAGE = /^\/(passport|activate|pair|readiness|help|match|team|t|studio|submit|me|setup)(\/|$)/;
const KEY_SOURCE_PAGE = /^\/(register|passport\/login)(\/|$)/;

/** Never gated: the key handshake itself, the API docs, and server-to-server callers with their own secrets. */
const ALWAYS_OPEN = [/^\/api\/v1\/auth\/testmu(\/|$)/, /^\/api\/v1\/auth\/register$/, /^\/api\/v1\/openapi\.json$/, /^\/api\/docs(\/|$)/, /^\/api\/cron\//, /^\/api\/import\//, /^\/webhooks\//];

/**
 * Public, aggregate-only reads the plan marks "Everyone" (TV, Mission Control,
 * public Ship Pages, receipt checks). Override with TESTMU_KEY_PUBLIC_PATHS, a
 * comma-separated list of path prefixes; set it to "none" to gate these too.
 */
export const DEFAULT_PUBLIC_API = [
  "/api/v1/live/",
  "/api/v1/dashboard",
  "/api/v1/event/brief",
  "/api/v1/public/",
  "/api/v1/submissions/receipt/",
  "/api/v1/kane/catalog",
];

export function publicApiPrefixes(env: Record<string, string | undefined> = process.env) {
  const raw = env.TESTMU_KEY_PUBLIC_PATHS?.trim();
  if (!raw) return DEFAULT_PUBLIC_API;
  if (raw.toLowerCase() === "none") return [];
  return raw.split(",").map((s) => s.trim()).filter((s) => s.startsWith("/"));
}

export type PathKind = "open" | "public_api" | "api" | "page" | "other";

/** /{team-slug}/status, rewritten to /api/v1/teams/{slug}/status (next.config.ts). Real two-segment pages excluded. */
const TEAM_STATUS_ALIAS = /^\/(?!(?:api|ship|t|team|studio|ops|judge|photo|passport|help|submit|activate|match|live|dashboard|me|pair|readiness|register|setup|print|docs)\/)[\w-]+\/status\/?$/;

export function classifyPath(pathname: string, env: Record<string, string | undefined> = process.env): PathKind {
  if (ALWAYS_OPEN.some((r) => r.test(pathname))) return "open";
  if (TEAM_STATUS_ALIAS.test(pathname)) return "api";
  if (pathname.startsWith("/api/") || pathname === "/mcp" || pathname.startsWith("/mcp/")) {
    return publicApiPrefixes(env).some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p)) ? "public_api" : "api";
  }
  if (KEY_SOURCE_PAGE.test(pathname)) return "other";
  return GATED_PAGE.test(pathname) ? "page" : "other";
}

/** Where to send a browser that needs to connect TestMu first. */
export function connectPath(next: string) {
  return `/api/v1/auth/testmu/start?next=${encodeURIComponent(next)}`;
}
