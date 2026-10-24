import "server-only";
import { query } from "@/lib/db";
import { INVITE_DONE_CODES, RATE_LIMITED, UNAVAILABLE, inviteResultFrom, syncContinues, type InviteRequest, type InviteResult } from "@/lib/testmu-team";
import { memberActor, type MemberRow } from "./auth";
import { AppError, writeAudit } from "./core";
import { rateLimit } from "./ratelimit";
import { getTeamInfo } from "./teams";

// TestMu AI team sync (docs/api/TESTMU_ACCESS.md). Once the captain's step-2 claim
// succeeds, the same TestMu AI password moves each other current member into the
// captain's TestMu AI org, one call at a time. The password is used in memory for
// these calls only: never stored, logged, audited or put in a URL. A sync failure
// never undoes the claim, step 3 or our roster lock. The captain can retry from /activate.
//
//   TESTMU_TEAM_INVITE_URL   production: this, or the real API. Anywhere else the real API is
//                            never called: a stub answers, unless the URL points at another (mock) host.
//   TESTMU_TEAM_INVITE_STUB  the stub's code (default MEMBER_ADDED). `+testmu-<code>` in a
//                            teammate's email (bob+testmu-team-full@x.io) picks it per teammate.

export const TESTMU_INVITE_DEFAULT_URL = "https://backend.lambdatest.com/api/trials/hack-day/team/invite";
const INVITE_TIMEOUT_MS = 10_000;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 255;
/** Longest Retry-After the sync waits out (once per teammate) before it stops. */
const SYNC_MAX_WAIT_SEC = 20;
const STUB_TAG = /\+testmu-([a-z_-]+)@/i;
const STUB_STATUS: Record<string, number> = {
  INVALID_CREDENTIALS: 401,
  NOT_TEAM_LEAD: 403,
  INELIGIBLE: 403,
  NOT_HACK_DAY_ORG: 403,
  MEMBER_IN_ANOTHER_TEAM: 409,
  ALREADY_INVITED: 409,
  TEAM_FULL: 409,
  RATE_LIMITED: 429,
};
/** Stored before a stub's code, so a preview on the shared database never marks a live teammate done. */
const STUB_PREFIX = "STUB_";

const isProduction = () => process.env.VERCEL_ENV === "production" || process.env.HACKOS_ENV === "production";

/** Where invites go, the same way the step-2 claim picks its target (claimTarget). */
export function inviteTarget(): { kind: "http"; url: string } | { kind: "stub"; code: string } {
  const env = process.env.TESTMU_TEAM_INVITE_URL?.trim();
  if (isProduction()) return { kind: "http", url: env || TESTMU_INVITE_DEFAULT_URL };
  if (env && !/lambdatest\.com|testmuai\.com/i.test(env)) return { kind: "http", url: env };
  return { kind: "stub", code: process.env.TESTMU_TEAM_INVITE_STUB?.trim().toUpperCase() || "MEMBER_ADDED" };
}

/** Each current teammate's TestMu AI team status (the last invite answer), captain excluded. */
export async function teamSyncStatus(teamId: number): Promise<TeamSyncStatus[]> {
  const rows = await query<Omit<TeamSyncStatus, "done">>(
    `select m.id as member_id, coalesce(m.display_name, m.name) as name, s.code, s.message, s.attempted_at
       from team_memberships tm
       join teams t on t.id = tm.team_id
       join members m on m.id = tm.member_id
       left join testmu_team_sync s on s.team_id = tm.team_id and s.member_id = m.id
      where tm.team_id = $1 and tm.left_at is null and m.deleted_at is null and m.id is distinct from t.captain_id
      order by tm.joined_at`,
    [teamId],
  );
  return rows.map((r) => {
    const code = visibleCode(r.code);
    return { ...r, code, done: !!code && INVITE_DONE_CODES.includes(code) };
  });
}

/** After a successful step-2 claim: a captain of a locked team syncs it with the same password. Never throws. */
export async function syncTeamAfterClaim(member: MemberRow, password: string): Promise<void> {
  try {
    const team = await captainsLockedTeam(member);
    if (team) await inviteTeammates(member, team.id, password, "claim");
  } catch (e) {
    console.warn("[testmu] team sync after the claim failed", (e as { code?: string })?.code ?? (e as Error)?.name);
  }
}

/** The captain's "retry team invites": asks for the password again, skips teammates already done. */
export async function retryTeamInvites(member: MemberRow, password: string): Promise<TeamSyncResult> {
  const team = member.team_id ? await getTeamInfo({ id: member.team_id }) : null;
  if (!team) throw new AppError("NOT_FOUND", { userMessage: "Join or create a team first." });
  if (team.captain_id !== member.id) throw new AppError("FORBIDDEN", { userMessage: "Only the team captain can do that." });
  if (!team.locked) throw new AppError("CONFLICT", { userMessage: "Confirm the final team first." });
  const [plan] = await query<{ status: string }>("select status from testmu_plan_claims where member_id = $1", [member.id]);
  if (plan?.status !== "claimed") throw new AppError("CONFLICT", { userMessage: "Activate your TestMu AI plan (step 2) first." });
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new AppError("VALIDATION_FAILED", { userMessage: "Enter your TestMu AI password (8+ characters)." });
  }
  const rl = await rateLimit(`testmu-team-sync:${team.id}`, { limit: 6, windowSec: 300 });
  if (!rl.ok) throw new AppError("RATE_LIMITED", { userMessage: "Too many tries. Wait a few minutes, or ask at the help desk." });
  return inviteTeammates(member, team.id, password, "retry");
}

/** Whether a captain should stay on /activate: their team has teammates not in the TestMu AI team yet. */
export async function teamInvitesPending(member: MemberRow): Promise<boolean> {
  const team = await captainsLockedTeam(member);
  return !!team && (await teamSyncStatus(team.id)).some((s) => !s.done);
}

async function captainsLockedTeam(member: MemberRow) {
  const team = member.team_id ? await getTeamInfo({ id: member.team_id }) : null;
  return team && team.captain_id === member.id && team.locked ? team : null;
}

/** One invite per teammate not done yet, in join order, stopping on an answer about the captain or TestMu AI. */
async function inviteTeammates(member: MemberRow, teamId: number, password: string, trigger: "claim" | "retry"): Promise<TeamSyncResult> {
  const pending = (await teamSyncStatus(teamId)).filter((s) => !s.done);
  if (!pending.length) return { attempted: 0, stopped: null };
  const [lead] = await query<{ email: string }>("select email from members where id = $1", [member.id]);
  const emails = new Map(
    (await query<{ id: number; email: string }>("select id, email from members where id = any($1::bigint[])", [pending.map((p) => p.member_id)])).map((r) => [r.id, r.email]),
  );
  const results: { member_id: number; code: string }[] = [];
  const stub = inviteTarget().kind === "stub";
  let stopped: string | null = null;
  for (const p of pending) {
    const r = await inviteHonouringRetry({ email: lead.email, password, member_email: emails.get(p.member_id) ?? "" });
    await query(
      `insert into testmu_team_sync (team_id, member_id, code, message, organization_id, attempted_at) values ($1, $2, $3, $4, $5, now())
       on conflict (team_id, member_id) do update set code = $3, message = $4, organization_id = coalesce($5, testmu_team_sync.organization_id), attempted_at = now()`,
      [teamId, p.member_id, stub ? `${STUB_PREFIX}${r.code}` : r.code, r.message, r.organizationId],
    );
    results.push({ member_id: p.member_id, code: r.code });
    if (!syncContinues(r.code)) {
      stopped = r.code;
      break;
    }
  }
  await writeAudit(memberActor(member), { action: "testmu.team_sync", resourceType: "team", resourceId: teamId, payload: { trigger, target: inviteTarget().kind, results, stopped } });
  return { attempted: results.length, stopped };
}

/** One invite call. A 429 with a short Retry-After is waited out and tried once more. */
async function inviteHonouringRetry(req: InviteRequest): Promise<InviteResult> {
  const first = await callInvite(req);
  const wait = first.code === RATE_LIMITED ? first.retryAfter : null;
  if (!wait || wait > SYNC_MAX_WAIT_SEC) return first;
  await new Promise((r) => setTimeout(r, wait * 1000));
  return callInvite(req);
}

async function callInvite(req: InviteRequest): Promise<InviteResult> {
  const t = inviteTarget();
  if (t.kind === "stub") return stubInvite(req, t.code);
  try {
    const res = await fetch(t.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: req.email.trim().toLowerCase(), password: req.password, member_email: req.member_email.trim().toLowerCase() }),
      signal: AbortSignal.timeout(INVITE_TIMEOUT_MS),
      // A redirect means a wrong URL or a proxy page, never the API's answer.
      redirect: "error",
      cache: "no-store",
    });
    return inviteResultFrom(res.status, await res.json().catch(() => null), res.headers.get("retry-after"));
  } catch {
    return { code: UNAVAILABLE, done: false, message: null, organizationId: null, retryAfter: null };
  }
}

/** The invite API's answers as the contract shapes them, run through the same mapping. */
function stubInvite(req: InviteRequest, fallback: string): InviteResult {
  const code = STUB_TAG.exec(req.member_email)?.[1]?.toUpperCase().replace(/-/g, "_") ?? fallback;
  const body = code === RATE_LIMITED ? { message: "Too Many Attempts." } : { code, message: `${code} (stub)`, member_email: req.member_email, organization_id: 7_000_000 };
  return inviteResultFrom(STUB_STATUS[code] ?? 200, body, code === RATE_LIMITED ? "30" : null);
}

/** A stub's answer reads as itself outside production and as not tried yet in production. */
function visibleCode(code: string | null) {
  if (!code?.startsWith(STUB_PREFIX)) return code;
  return isProduction() ? null : code.slice(STUB_PREFIX.length);
}

export type TeamSyncStatus = { member_id: number; name: string; code: string | null; message: string | null; attempted_at: Date | null; done: boolean };

export type TeamSyncResult = { attempted: number; stopped: string | null };
