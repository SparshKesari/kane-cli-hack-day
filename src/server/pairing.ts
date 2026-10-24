import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { setMemberSession } from "@/lib/session";
import {
  authenticateBearer,
  getMember,
  getMemberById,
  getPersonalMember,
  memberActor,
  newToken,
  randomCode,
  tokenActor,
  tokenHash,
  type BearerAuth,
  type MemberRow,
} from "./auth";
import { AppError, sha256, siteUrl, transaction, withAudit, writeAudit, type Actor } from "./core";

// Personal identity plumbing (T-AUTH-03..06):
//   · device pairing for the kanehack CLI / MCP clients → a hashed bearer token
//   · personal sign-in for members who registered through the team form
//     (email + team password, a personal password, or a one-time code)
//   · GitHub OAuth as an optional identity link (no repo scopes)
//   · resolveCaller(): cookie member or bearer, for /api/v1 routes
// Only hashes of codes and tokens are stored. Every failure on a pairing or
// code fails closed with the same message, so nothing confirms what exists.

// ── Shared ───────────────────────────────────────────────────────────────────

const normalizeCode = (c: string) => c.toUpperCase().replace(/[^0-9A-Z]/g, "");
const codeHash = (c: string) => sha256(normalizeCode(c));
/** "ABCD2345" → "ABCD-2345": what people read and type. */
export const formatCode = (c: string) => normalizeCode(c).replace(/^(.{4})(.{4})$/, "$1-$2");

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new AppError("INTERNAL", { message: "SESSION_SECRET is not set" });
  return s;
}

/** HMAC-signed, expiring blob (GitHub OAuth state, badge tokens). */
export function signValue(purpose: string, payload: string) {
  return createHmac("sha256", secret()).update(`${purpose}:${payload}`).digest("base64url");
}

export function checkSignature(purpose: string, payload: string, mac: string) {
  const expected = Buffer.from(signValue(purpose, payload));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ── Who is calling an /api/v1 route ──────────────────────────────────────────

export type Caller = { member: MemberRow; actor: Actor; via: "cookie" | "bearer"; bearer: BearerAuth | null };

/** A bearer token (CLI/MCP) wins over cookies; otherwise the signed-in browser member. */
export async function resolveCaller(req: Request): Promise<Caller> {
  if (req.headers.get("authorization")) {
    const bearer = await authenticateBearer(req);
    if (!bearer) throw new AppError("UNAUTHENTICATED", { userMessage: "Missing or invalid token. Pair this machine again with `kanehack pair`." });
    return { member: bearer.member, actor: tokenActor(bearer), via: "bearer", bearer };
  }
  const member = await getMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  return { member, actor: memberActor(member), via: "cookie", bearer: null };
}

// ── Device pairing (kanehack pair) ──────────────────────────────────────────

const PAIR_MINUTES = 10;
const BEARER_DAYS = 14;
export const PAIR_POLL_SECONDS = 5;

export type PairingStart = { user_code: string; device_code: string; verification_url: string; expires_at: string; interval: number };

/**
 * Step 1 (CLI, no account): a short user code to show the person and a long
 * device code the CLI keeps secret and polls with.
 */
export async function startPairing(input: { label?: string | null }): Promise<PairingStart> {
  const user = randomCode(8);
  const device = newToken("pairing");
  const [row] = await query<{ id: number; expires_at: Date }>(
    `insert into pairing_requests (user_code_hash, device_code_hash, label, expires_at)
     values ($1, $2, $3, now() + make_interval(mins => $4)) returning id, expires_at`,
    [codeHash(user), tokenHash(device), input.label?.slice(0, 80) ?? null, PAIR_MINUTES],
  );
  await writeAudit({ type: "anonymous", label: input.label ?? "cli" }, { action: "pair.start", resourceType: "pairing_request", resourceId: row.id });
  const code = formatCode(user);
  return {
    user_code: code,
    device_code: device,
    verification_url: siteUrl(`/pair?code=${code}`),
    expires_at: row.expires_at.toISOString(),
    interval: PAIR_POLL_SECONDS,
  };
}

export type PairingView = { id: number; label: string | null; status: string; expires_at: Date; expired: boolean };

/** What the /pair page shows before the person approves. Null for unknown codes. */
export async function describePairing(userCode: string): Promise<PairingView | null> {
  if (normalizeCode(userCode).length !== 8) return null;
  const [row] = await query<PairingView>(
    `select id, label, status, expires_at, (expires_at <= now()) as expired from pairing_requests where user_code_hash = $1`,
    [codeHash(userCode)],
  );
  return row ?? null;
}

/** Step 2 (browser, signed in): bind the pairing to this member, or deny it. */
export async function decidePairing(userCode: string, member: MemberRow, approve: boolean) {
  return withAudit(memberActor(member), approve ? "pair.approve" : "pair.deny", "pairing_request", async (tx) => {
    const { rows } = await tx.query<{ id: number; status: string; expired: boolean }>(
      `select id, status, (expires_at <= now()) as expired from pairing_requests where user_code_hash = $1 for update`,
      [codeHash(userCode)],
    );
    const row = rows[0];
    if (!row || row.expired || row.status !== "pending") throw new AppError("PAIR_EXPIRED");
    await tx.query(
      `update pairing_requests set status = $2, member_id = $3, approved_at = case when $2 = 'approved' then now() end where id = $1`,
      [row.id, approve ? "approved" : "denied", member.id],
    );
    return { result: { id: row.id, status: approve ? "approved" : "denied" }, resourceId: row.id };
  });
}

export type PairingPoll =
  | { status: "pending"; interval: number; expires_at: string }
  | { status: "approved"; token: string; token_id: number; expires_at: string; member: { public_code: string | null; name: string } };

/**
 * Step 3 (CLI poll): pending → keep polling; approved → the bearer token,
 * exactly once. Replays, denials and expiry all fail closed with PAIR_EXPIRED.
 */
export async function exchangePairing(deviceCode: string): Promise<PairingPoll> {
  const out = await transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number; status: string; member_id: number | null; label: string | null; expired: boolean; expires_at: Date }>(
      `select id, status, member_id, label, (expires_at <= now()) as expired, expires_at
         from pairing_requests where device_code_hash = $1 for update`,
      [tokenHash(deviceCode)],
    );
    const row = rows[0];
    if (!row) return { kind: "fail" as const };
    if (row.status === "pending" && !row.expired) {
      await tx.query("update pairing_requests set last_polled_at = now() where id = $1", [row.id]);
      return { kind: "pending" as const, expires_at: row.expires_at };
    }
    if (row.status !== "approved" || row.expired || !row.member_id) {
      if (row.status === "pending") await tx.query("update pairing_requests set status = 'expired' where id = $1", [row.id]);
      return { kind: "fail" as const };
    }
    const token = newToken("bearer");
    const { rows: t } = await tx.query<{ id: number; expires_at: Date }>(
      `insert into member_tokens (member_id, kind, token_hash, label, scopes, expires_at)
       values ($1, 'bearer', $2, $3, $4, now() + make_interval(days => $5)) returning id, expires_at`,
      [row.member_id, tokenHash(token), row.label ?? "kanehack", ["participant"], BEARER_DAYS],
    );
    await tx.query("update pairing_requests set status = 'exchanged', exchanged_at = now(), bearer_token_id = $2 where id = $1", [row.id, t[0].id]);
    await writeAudit({ type: "member", id: row.member_id }, { action: "pair.exchange", resourceType: "member_token", resourceId: t[0].id, payload: { pairing_id: row.id } }, tx);
    return { kind: "ok" as const, token, tokenId: t[0].id, expires_at: t[0].expires_at, memberId: row.member_id };
  });
  if (out.kind === "fail") throw new AppError("PAIR_EXPIRED");
  if (out.kind === "pending") return { status: "pending", interval: PAIR_POLL_SECONDS, expires_at: out.expires_at.toISOString() };
  const m = await getMemberById(out.memberId);
  return {
    status: "approved",
    token: out.token,
    token_id: out.tokenId,
    expires_at: out.expires_at.toISOString(),
    member: { public_code: m?.public_code ?? null, name: m ? shortName(m.display_name ?? m.name) : "" },
  };
}

export type TokenRow = { id: number; label: string | null; created_at: Date; last_used_at: Date | null; expires_at: Date };

export async function listBearerTokens(memberId: number) {
  return query<TokenRow>(
    `select id, label, created_at, last_used_at, expires_at from member_tokens
      where member_id = $1 and kind = 'bearer' and revoked_at is null and expires_at > now() order by created_at desc`,
    [memberId],
  );
}

export async function revokeBearerToken(member: MemberRow, tokenId: number) {
  return withAudit(memberActor(member), "token.revoke", "member_token", async (tx) => {
    const { rowCount } = await tx.query("update member_tokens set revoked_at = now() where id = $1 and member_id = $2 and kind = 'bearer' and revoked_at is null", [
      tokenId,
      member.id,
    ]);
    if (!rowCount) throw new AppError("NOT_FOUND");
    return { result: { id: tokenId }, resourceId: tokenId };
  });
}

// ── Personal sign-in ─────────────────────────────────────────────────────────

/** "Ada Lovelace" → "Ada L." (the default public name). */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

const SIGN_IN_FAILED = "That email and password or code don’t match.";
// A real scrypt hash of a random string, so a missing account costs the same time.
let dummyHash: Promise<string> | null = null;

/**
 * Email + the team password (or a personal password, if set). Members who
 * registered through the team form can now sign in on their own.
 */
export async function memberLoginWithPassword(email: string, password: string) {
  const row = await verifyMemberPassword(email, password);
  await setMemberSession({ memberId: row.id, personal: true });
  await writeAudit(memberActor(row), { action: "member.login_password", resourceType: "member", resourceId: row.id });
  return row.id;
}

/**
 * The member whose own password (set on /register) this is, or UNAUTHENTICATED.
 * Event-day flow: there is no shared team password any more, so this is always personal.
 */
export async function verifyMemberPassword(email: string, password: string) {
  const [row] = await query<{ id: number; name: string; team_id: number | null; password_hash: string | null }>(
    "select m.id, m.name, m.team_id, m.password_hash from members m where lower(m.email) = lower($1) and m.deleted_at is null",
    [email.trim()],
  );
  dummyHash ??= hashPassword(randomBytes(12).toString("hex"));
  let ok = false;
  if (row?.password_hash) ok = await verifyPassword(password, row.password_hash);
  else await verifyPassword(password, await dummyHash);
  if (!row || !ok) throw new AppError("UNAUTHENTICATED", { userMessage: SIGN_IN_FAILED });
  return row;
}

/**
 * A bearer token for a member who just proved who they are from the CLI (kanehack register /
 * signin with their password), the same token pairing hands out, without the browser step.
 */
export async function issueBearerToken(memberId: number, label: string | null, how: "register" | "password") {
  const token = newToken("bearer");
  return transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number; expires_at: Date }>(
      `insert into member_tokens (member_id, kind, token_hash, label, scopes, expires_at)
       values ($1, 'bearer', $2, $3, $4, now() + make_interval(days => $5)) returning id, expires_at`,
      [memberId, tokenHash(token), (label ?? "kanehack").slice(0, 80), ["participant"], BEARER_DAYS],
    );
    await writeAudit({ type: "member", id: memberId }, { action: `token.issue_${how}`, resourceType: "member_token", resourceId: rows[0].id }, tx);
    return { token, token_id: rows[0].id, expires_at: rows[0].expires_at.toISOString() };
  });
}

/** Email + a one-time code from the desk (or from your own signed-in device). */
export async function memberLoginWithCode(email: string, code: string) {
  const memberId = await transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number; name: string; team_id: number | null; code_id: number }>(
      `select m.id, m.name, m.team_id, c.id as code_id
         from member_login_codes c join members m on m.id = c.member_id
        where lower(m.email) = lower($1) and m.deleted_at is null and c.code_hash = $2 and c.used_at is null and c.expires_at > now()
        for update of c`,
      [email.trim(), codeHash(code)],
    );
    const row = rows[0];
    if (!row) return null;
    await tx.query("update member_login_codes set used_at = now() where id = $1", [row.code_id]);
    await writeAudit(memberActor(row), { action: "member.login_code", resourceType: "member", resourceId: row.id }, tx);
    return row.id;
  });
  if (!memberId) throw new AppError("UNAUTHENTICATED", { userMessage: SIGN_IN_FAILED });
  await setMemberSession({ memberId, personal: true });
  return memberId;
}

const LOGIN_CODE_HOURS = 24;

/**
 * A fresh one-time sign-in code for `memberId`, returned once (only its hash
 * is kept). Staff issue it at the desk; a member can issue one for themselves
 * to sign in on another device. Older unused codes are retired.
 * Exported for admissions-ops (/ops/checkin).
 */
export async function issueMemberLoginCode(memberId: number, actor: Actor) {
  const code = randomCode(8);
  await transaction(async (tx) => {
    await tx.query("update member_login_codes set used_at = now() where member_id = $1 and used_at is null", [memberId]);
    await tx.query(
      `insert into member_login_codes (member_id, code_hash, issued_by_staff, issued_by_member, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
      [memberId, codeHash(code), actor.type === "staff" ? actor.id : null, actor.type === "member" ? actor.id : null, LOGIN_CODE_HOURS],
    );
    await writeAudit(actor, { action: "member.issue_login_code", resourceType: "member", resourceId: memberId }, tx);
  });
  return formatCode(code);
}

/** Set (or change) a personal password, so sign-in no longer needs the team password. */
export async function setMemberPassword(member: MemberRow, password: string) {
  if (password.length < 8) throw new AppError("VALIDATION_FAILED", { userMessage: "Use at least 8 characters." });
  const hash = await hashPassword(password);
  return withAudit(memberActor(member), "member.set_password", "member", async (tx) => {
    await tx.query("update members set password_hash = $2 where id = $1", [member.id, hash]);
    return { result: { id: member.id }, resourceId: member.id };
  });
}

// ── GitHub OAuth (optional identity link) ────────────────────────────────────

const GH_COOKIE = "hd_gh_state";
export const githubEnabled = () => !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
const githubCallback = () => siteUrl("/api/v1/auth/github/callback");

/** The GitHub authorize URL for the signed-in member. No scopes: public profile only, never repo content. */
export async function githubAuthorizeUrl(member: MemberRow, next: "/passport" | "/activate" = "/passport") {
  if (!githubEnabled()) throw new AppError("FEATURE_DISABLED", { userMessage: "GitHub linking isn’t configured yet." });
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${member.id}.${nonce}.${Date.now() + 10 * 60_000}`;
  const state = `${payload}.${signValue("gh", payload)}`;
  (await cookies()).set(GH_COOKIE, `${nonce}|${next}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID!);
  u.searchParams.set("redirect_uri", githubCallback());
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "true");
  return u.toString();
}

/** Callback: check state, exchange the code, read /user, link it. The access token is never stored. */
export async function completeGithubLink(code: string, state: string) {
  if (!githubEnabled()) throw new AppError("FEATURE_DISABLED");
  const [memberId, nonce, exp, mac] = state.split(".");
  const payload = `${memberId}.${nonce}.${exp}`;
  const jar = await cookies();
  const [cookieNonce, back] = (jar.get(GH_COOKIE)?.value ?? "").split("|");
  jar.delete(GH_COOKIE);
  const next = back === "/activate" ? "/activate" : "/passport";
  // exp is a client-side state expiry for the redirect round trip, not an event deadline.
  if (!mac || !checkSignature("gh", payload, mac) || cookieNonce !== nonce || Number(exp) < Date.now()) {
    throw new AppError("UNAUTHENTICATED", { userMessage: "That GitHub sign-in expired. Start again from your passport." });
  }
  const member = await getPersonalMember();
  if (!member || member.id !== Number(memberId)) throw new AppError("UNAUTHENTICATED");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code, redirect_uri: githubCallback() }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const tok = (await tokenRes?.json().catch(() => null)) as { access_token?: string } | null;
  if (!tok?.access_token) throw new AppError("DOWNSTREAM_DEGRADED", { userMessage: "GitHub didn’t confirm the sign-in. Try again in a minute." });
  const userRes = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${tok.access_token}`, accept: "application/vnd.github+json", "user-agent": "kane-hack-os" },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const gh = (await userRes?.json().catch(() => null)) as { id?: number; login?: string } | null;
  if (!gh?.id || !gh.login) throw new AppError("DOWNSTREAM_DEGRADED", { userMessage: "GitHub didn’t return a profile. Try again in a minute." });

  return withAudit(memberActor(member), "identity.link_github", "member_identity", async (tx) => {
    const { rows } = await tx.query<{ id: number; member_id: number }>(
      `insert into member_identities (member_id, provider, subject, handle, verified_at)
       values ($1, 'github', $2, $3, now())
       on conflict (provider, subject) do update set handle = excluded.handle, verified_at = now()
         where member_identities.member_id = excluded.member_id
       returning id, member_id`,
      [member.id, String(gh.id), gh.login],
    );
    if (!rows[0]) throw new AppError("CONFLICT", { userMessage: "That GitHub account is already linked to someone else." });
    await tx.query("update members set github_handle = $2 where id = $1", [member.id, gh.login]);
    return { result: { handle: gh.login!, next }, resourceId: rows[0].id, after: { provider: "github", handle: gh.login } };
  });
}
