// Pure helpers for the TestMu AI Hack Day team sync (no I/O, unit tested in
// tests/unit/testmu-team.test.mts). The HTTP call lives in src/server/testmu-team.ts.
//
// TestMu AI builds one org per hack-day team. Once the captain's step-2 claim
// succeeds, POST /api/trials/hack-day/team/invite {email, password, member_email}
// moves each teammate into the captain's org (MEMBER_ADDED) or records an invite
// for an email that hasn't claimed yet (MEMBER_INVITED, then JOINED_TEAM on claim).

export type InviteRequest = { email: string; password: string; member_email: string };

export type InviteResult = { code: string; done: boolean; message: string | null; organizationId: number | null; retryAfter: number | null };

/** Invite codes that mean the teammate is, or will be, in the captain's TestMu AI team. */
export const INVITE_DONE_CODES = ["MEMBER_ADDED", "MEMBER_INVITED", "ALREADY_IN_TEAM"];
export const RATE_LIMITED = "RATE_LIMITED";
export const UNAVAILABLE = "UNAVAILABLE";
/** Answers about one teammate: the sync carries on with the next. Anything else stops it. */
const CONTINUE_CODES = [...INVITE_DONE_CODES, "INELIGIBLE", "NOT_HACK_DAY_ORG", "MEMBER_IN_ANOTHER_TEAM", "ALREADY_INVITED", "INVALID_REQUEST"];
const RETRY_AFTER_DEFAULT_SEC = 60;
const TEAM_SYNC_MESSAGES: Record<string, (name: string) => string> = {
  MEMBER_ADDED: () => "In your TestMu AI team.",
  MEMBER_INVITED: () => "Invited. Joins your TestMu AI team when they activate their TestMu AI plan (step 2).",
  ALREADY_IN_TEAM: () => "Already in your TestMu AI team.",
  NOT_TEAM_LEAD: () => "Your TestMu AI account isn’t the admin of its own Hack Day account, so it can’t add teammates. Ask at the help desk.",
  MEMBER_IN_ANOTHER_TEAM: (n) => `${n} already belongs to another TestMu AI team. Ask at the help desk.`,
  ALREADY_INVITED: (n) => `${n} was already invited to another TestMu AI team. Ask at the help desk.`,
  NOT_HACK_DAY_ORG: (n) => `${n} has a TestMu AI account but hasn’t joined Hack Day yet. They need to activate their TestMu AI plan (step 2 on /activate), then retry.`,
  TEAM_FULL: () => "Your TestMu AI team already has 4 people, including pending invites. Ask at the help desk.",
  INVALID_CREDENTIALS: () => "TestMu AI didn’t accept that password. Enter the TestMu AI password you used in step 2, then retry.",
  INELIGIBLE: (n) => `${n}’s TestMu AI account isn’t eligible to join a team. Ask at the help desk.`,
  RATE_LIMITED: () => "TestMu AI is busy and asked us to slow down. Retry in a minute.",
};

/** The invite API's answer → its code, and whether that teammate is done. 429 has no code: RATE_LIMITED. */
export function inviteResultFrom(status: number, body: unknown, retryAfter: string | null): InviteResult {
  const code = status === 429 ? RATE_LIMITED : (codeOf(body) ?? (status >= 500 ? UNAVAILABLE : `HTTP_${status}`));
  const done = status >= 200 && status < 300 && INVITE_DONE_CODES.includes(code);
  return { code, done, message: messageOf(body), organizationId: organizationIdOf(body), retryAfter: code === RATE_LIMITED ? retryAfterSeconds(retryAfter) : null };
}

/** Retry-After in seconds (a number or an HTTP date), with a default when it's missing. */
export function retryAfterSeconds(header: string | null): number {
  const n = header?.trim() ? Number(header.trim()) : NaN;
  if (Number.isFinite(n) && n >= 0) return Math.max(1, Math.ceil(n));
  const at = header ? Date.parse(header) : NaN;
  if (Number.isFinite(at)) return Math.max(1, Math.ceil((at - Date.now()) / 1000));
  return RETRY_AFTER_DEFAULT_SEC;
}

/** Whether the sync goes on to the next teammate after this answer. */
export const syncContinues = (code: string) => CONTINUE_CODES.includes(code);

/** What the captain reads about one teammate's sync status. */
export function teamSyncMessage(code: string | null, name: string): string {
  if (!code) return "Not added to your TestMu AI team yet.";
  return TEAM_SYNC_MESSAGES[code]?.(name) ?? "We couldn’t reach TestMu AI. Retry in a minute.";
}

function codeOf(body: unknown): string | null {
  const c = body && typeof body === "object" ? (body as { code?: unknown }).code : null;
  return typeof c === "string" && c.trim() ? c.trim().toUpperCase() : null;
}

function messageOf(body: unknown): string | null {
  const m = body && typeof body === "object" ? (body as { message?: unknown }).message : null;
  return typeof m === "string" ? m.slice(0, 300) : null;
}

function organizationIdOf(body: unknown): number | null {
  const v = Number(body && typeof body === "object" ? (body as { organization_id?: unknown }).organization_id : NaN);
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}
