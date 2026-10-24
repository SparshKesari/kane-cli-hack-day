import { randomBytes } from "node:crypto";

// Activate a participant on TestMu AI from their Hack OS profile: we send the
// profile, TestMu creates (or finds) the account and answers with its username
// and access key. That key is the participant's mandatory credential from then
// on (docs/api/TESTMU_ACCESS.md). Fetch only, no DB.
//
//   TESTMU_PROVISION_URL    POST JSON, see ProvisionProfile; answer { username, access_key, email? }
//                           (also accepted: user_name / accessKey, or the same inside `data`)
//   TESTMU_PROVISION_TOKEN  sent as Authorization: Bearer … (server-to-server secret)
//   Outside production with no URL, a stub answers so the flow can be clicked through.

export type ProvisionProfile = {
  name: string;
  email: string;
  linkedin: string | null;
  x: string | null;
  github: string | null;
  /** Our member id, so a retry finds the same account. */
  external_id: string;
};

export type ProvisionResult =
  | { ok: true; username: string; accessKey: string; email: string | null }
  | { ok: false; reason: "rejected" | "unavailable"; detail: string; message: string | null };

const TIMEOUT_MS = 10_000;
const isProduction = () => process.env.VERCEL_ENV === "production" || process.env.HACKOS_ENV === "production";

/**
 * Whether profile → TestMu activation runs: always on previews and locally (stub),
 * in production only once TESTMU_PROVISION_URL is set, so a deploy before TestMu's
 * endpoint exists doesn't stop anyone at the profile step.
 */
export const activationEnabled = () => !!process.env.TESTMU_PROVISION_URL?.trim() || !isProduction();

/** Pull username / access key out of the common response shapes. */
export function credentialsFromBody(body: unknown): { username: string; accessKey: string; email: string | null } | null {
  if (!body || typeof body !== "object") return null;
  const layers = [body as Record<string, unknown>];
  const data = (body as { data?: unknown }).data;
  if (data && typeof data === "object") layers.push(data as Record<string, unknown>);
  for (const l of layers) {
    const username = [l.username, l.user_name, l.userName].find((v) => typeof v === "string" && v.trim()) as string | undefined;
    const accessKey = [l.access_key, l.accessKey].find((v) => typeof v === "string" && v.trim()) as string | undefined;
    if (username && accessKey) {
      const email = typeof l.email === "string" && l.email.includes("@") ? l.email.trim().toLowerCase() : null;
      return { username: username.trim(), accessKey: accessKey.trim(), email };
    }
  }
  return null;
}

function messageOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const m = (body as { message?: unknown; error?: unknown }).message ?? (body as { error?: unknown }).error;
  return typeof m === "string" ? m.slice(0, 300) : null;
}

export async function provisionTestmuAccount(profile: ProvisionProfile): Promise<ProvisionResult> {
  const url = process.env.TESTMU_PROVISION_URL?.trim();
  if (!url) {
    if (isProduction()) return { ok: false, reason: "unavailable", detail: "TESTMU_PROVISION_URL is not set in production", message: null };
    return { ok: true, username: `hack-${profile.external_id.replace(/\W/g, "")}`, accessKey: `stub_${randomBytes(18).toString("base64url")}`, email: profile.email };
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(process.env.TESTMU_PROVISION_TOKEN ? { authorization: `Bearer ${process.env.TESTMU_PROVISION_TOKEN}` } : {}),
      },
      body: JSON.stringify({ ...profile, event: "kane-cli-hack-day", source: "kaneclihack.sh" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, reason: "unavailable", detail: e instanceof Error ? e.name : "network", message: null };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, reason: res.status >= 500 ? "unavailable" : "rejected", detail: `HTTP ${res.status}`, message: messageOf(body) };
  const creds = credentialsFromBody(body);
  if (!creds) return { ok: false, reason: "unavailable", detail: `HTTP ${res.status} without username/access_key`, message: null };
  return { ok: true, ...creds };
}
