// Browser calls to /api/v1 from participant pages. Same-origin, so the
// hd_testmu cookie (TestMu AI access key, verified server-side) and the
// member session ride along; the key itself never reaches page scripts.
// If the TestMu connection lapsed mid-page (cookie expired, switch just turned
// on), the proxy answers 401 TESTMU_KEY_REQUIRED and we send the person to
// reconnect, returning to this page.

export const TESTMU_CONNECT = "/api/v1/auth/testmu/start";

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { credentials: "same-origin", ...init });
  if (res.status === 401 && typeof window !== "undefined") {
    const body = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === "TESTMU_KEY_REQUIRED") {
      // A full navigation on purpose: /start is a route handler that leaves for TestMu AI.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${TESTMU_CONNECT}?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }
  return res;
}
