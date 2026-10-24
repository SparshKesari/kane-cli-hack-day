// Pure helpers for the TestMu AI hack-day plan claim (no I/O, unit tested in
// tests/unit/activation-rules.test.mts). The HTTP call itself lives in
// src/server/event-activation.ts.

export type ClaimOutcome = "claimed" | "not_registered" | "error";

/** Why an "error" happened, so the person sees what to do (the stored status stays "error"). */
export type ClaimReason = "wrong_password" | "invalid" | "ineligible" | "region" | "ended" | "retry";

export type ClaimResult = {
  outcome: ClaimOutcome;
  /** For staff (stored as last_error): status, code and the API's messages. Never the email. */
  detail: string | null;
  reason?: ClaimReason;
  /** The API's own field messages ("The password must be at least 8 characters."), safe to show. */
  fields?: string[];
};

// The Hack Day 2026 API (POST {email, password, …}): these four answer HTTP 200 with the
// account's credentials. INELIGIBLE is also a 200, with no credentials.
const SUCCESS_CODES = new Set(["SIGNEDUP", "JOINED_TEAM", "ALREADY_CLAIMED", "ALREADY_ACTIVE"]);
const SECRET_KEY = /token|password|passwd|secret|access[_-]?key|api[_-]?key|credential/i;

/** The answer without its credentials (access_token and the like), for storing and for staff. */
export function redactClaimBody(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(redactClaimBody);
  if (!body || typeof body !== "object") return body;
  return Object.fromEntries(Object.entries(body).filter(([k]) => !SECRET_KEY.test(k)).map(([k, v]) => [k, redactClaimBody(v)]));
}

function fieldMessages(body: unknown): string[] {
  const errors = body && typeof body === "object" ? (body as { errors?: unknown }).errors : undefined;
  if (!errors || typeof errors !== "object") return [];
  return Object.values(errors as Record<string, unknown>)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .filter((m): m is string => typeof m === "string" && m.length > 0)
    .slice(0, 3)
    .map((m) => m.slice(0, 200));
}

// The real API's answer for an email with no TestMu AI account (it may come
// with a 2xx): {"code":"NON_SIGNEDUP","message":"Claim recorded. Trial will be activated after signup."}
const NON_SIGNEDUP = /^NON[_\s-]?SIGNE?D[_\s-]?UP$|^NOT[_\s-]?SIGNE?D[_\s-]?UP$/i;

const NOT_REGISTERED = /not[_\s-]?found|not[_\s-]?registered|does\s*n[o’']t\s*exist|does not exist|no\s+(such\s+)?(user|account)|\buser\b|\baccount\b/i;

/** Flatten `{code, message, errors: {field: [msg]}}` into one line of text. */
export function claimErrorText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as { code?: unknown; message?: unknown; error?: unknown; errors?: unknown };
  const parts: string[] = [];
  for (const v of [b.code, b.message, b.error]) if (typeof v === "string" && v) parts.push(v);
  if (b.errors && typeof b.errors === "object") {
    for (const [field, msgs] of Object.entries(b.errors as Record<string, unknown>)) {
      const list = Array.isArray(msgs) ? msgs : [msgs];
      for (const m of list) if (typeof m === "string") parts.push(`${field}: ${m}`);
    }
  }
  return parts.join(" · ").slice(0, 500);
}

/**
 * The one mapping from the claim API's answer to what the participant sees.
 *   code NON_SIGNEDUP (any status, older API)                → not_registered
 *   2xx with SIGNEDUP / JOINED_TEAM / ALREADY_* (or no code)  → claimed
 *   2xx INELIGIBLE                                            → error, ineligible
 *   other 2xx codes                                           → error (staff sort it out)
 *   401 INVALID_CREDENTIALS                                   → error, wrong_password
 *   403 REGION_NOT_SUPPORTED / 410 CAMPAIGN_ENDED             → error, region / ended
 *   429, 5xx (502 FAILED), timeout, network                   → error, retry
 *   404, or 400/422 saying the user/account isn't there       → not_registered (older API)
 *   other 400/422 (INVALID_REQUEST)                           → error, invalid, with the field messages
 * `status` null means the request never got an answer (network, timeout).
 */
export function mapClaimResponse(status: number | null, body: unknown, failure?: string): ClaimResult {
  if (status === null) return { outcome: "error", detail: failure ?? "no response", reason: "retry" };
  const text = claimErrorText(body);
  const raw = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : undefined;
  if (code && NON_SIGNEDUP.test(code)) return { outcome: "not_registered", detail: `HTTP ${status} · ${text}` };
  const detail = `HTTP ${status}${text ? ` · ${text}` : body === undefined ? " · malformed response" : ""}`;
  if (status >= 200 && status < 300) {
    if (!code || SUCCESS_CODES.has(code)) return { outcome: "claimed", detail: null };
    return code === "INELIGIBLE" ? { outcome: "error", detail, reason: "ineligible" } : { outcome: "error", detail };
  }
  if (status === 401 || code === "INVALID_CREDENTIALS") return { outcome: "error", detail, reason: "wrong_password" };
  if (code === "REGION_NOT_SUPPORTED") return { outcome: "error", detail, reason: "region" };
  if (status === 410 || code === "CAMPAIGN_ENDED") return { outcome: "error", detail, reason: "ended" };
  if (status === 429 || status >= 500) return { outcome: "error", detail, reason: "retry" };
  if (status === 404) return { outcome: "not_registered", detail };
  if ((status === 400 || status === 422) && text) {
    // "The email field is required." is a request problem, not an unknown user.
    const lowered = text.toLowerCase();
    // So is "already claimed for this account": the staff see the detail and sort it out.
    const requestProblem = (/required/.test(lowered) || /already/.test(lowered)) && !/not\s*(found|registered)/.test(lowered);
    if (!requestProblem && NOT_REGISTERED.test(text)) return { outcome: "not_registered", detail };
    return { outcome: "error", detail, reason: "invalid", fields: fieldMessages(body) };
  }
  return { outcome: "error", detail };
}
