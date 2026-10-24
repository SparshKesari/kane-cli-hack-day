import type { KeyCredentials } from "./testmu-gate";

// Ask TestMu AI whether a username + access key is real. Fetch only (no DB,
// no server-only), so src/proxy.ts can call it. src/server/testmu.ts turns the
// result into AppErrors for route handlers.
//
//   TESTMU_VERIFY_URL   GET with Basic username:access_key; 2xx = valid, 401/403 = invalid.
//                       The email is read from email | data.email | user.email | data.user.email.
//   TESTMU_VERIFY_STUB  outside production with no URL: "valid" (default) | "invalid"
//   TESTMU_VERIFY_STUB_EMAIL=1  let the stub treat an email-shaped username as verified (local only)

export type VerifyResult =
  | { ok: true; username: string; email: string | null }
  | { ok: false; reason: "invalid" | "unavailable"; detail: string };

const TIMEOUT_MS = 8000;
const isProduction = () => process.env.VERCEL_ENV === "production" || process.env.HACKOS_ENV === "production";

export function emailFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { email?: unknown; data?: { email?: unknown; user?: { email?: unknown } }; user?: { email?: unknown } };
  const pick = (v: unknown) => (typeof v === "string" && v.includes("@") ? v.trim().toLowerCase() : null);
  return pick(b.email) ?? pick(b.data?.email) ?? pick(b.user?.email) ?? pick(b.data?.user?.email);
}

export async function checkAccessKey(c: KeyCredentials): Promise<VerifyResult> {
  const url = process.env.TESTMU_VERIFY_URL?.trim();
  if (!url) {
    if (isProduction()) return { ok: false, reason: "unavailable", detail: "TESTMU_VERIFY_URL is not set in production" };
    if ((process.env.TESTMU_VERIFY_STUB ?? "valid") === "invalid") return { ok: false, reason: "invalid", detail: "stub: invalid" };
    // The stub never vouches for an email (previews share the live DB, so that would let
    // anyone act as any participant) unless TESTMU_VERIFY_STUB_EMAIL is set for local tests.
    const vouch = process.env.TESTMU_VERIFY_STUB_EMAIL === "1" && c.username.includes("@");
    return { ok: true, username: c.username, email: vouch ? c.username.toLowerCase() : null };
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Basic ${Buffer.from(`${c.username}:${c.accessKey}`).toString("base64")}`, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, reason: "unavailable", detail: e instanceof Error ? e.name : "network" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: "invalid", detail: `HTTP ${res.status}` };
  if (!res.ok) return { ok: false, reason: "unavailable", detail: `HTTP ${res.status}` };
  return { ok: true, username: c.username, email: emailFrom(await res.json().catch(() => null)) };
}
