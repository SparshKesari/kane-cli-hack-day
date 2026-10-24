import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db";
import {
  clearAdminSession,
  clearMemberSession,
  clearStaffSession,
  getMemberSession,
  getStaffSession,
  getTeamSession,
  hasAdminCookie,
  setAdminSession,
  setMemberSession,
  setStaffSession,
} from "@/lib/session";
import { AppError, sha256, transaction, writeAudit, type Actor, type StaffRole } from "./core";
import { memberFromPrincipal } from "./testmu";

// Who is asking. Three kinds of identity, checked server-side on every call:
//   member  : a participant (hd_member cookie, or the team cookie after "who are you?")
//   staff   : mentor | photographer | judge | organizer | admin (hd_staff cookie,
//             or the legacy ADMIN_PASSWORD cookie, which counts as admin)
//   bearer  : a CLI/MCP token from pairing (member_tokens, hash lookup)
// Personal and team lifecycles are independent: a member may have no team.

export type Role = "participant" | StaffRole;
export const STAFF_ROLES: StaffRole[] = ["mentor", "photographer", "judge", "organizer", "admin"];

export type MemberRow = {
  id: number;
  team_id: number | null;
  name: string;
  display_name: string | null;
  email: string;
  role: Role;
  public_code: string | null;
  checked_in_at: Date | null;
  activated_at: Date | null;
  deleted_at: Date | null;
};

export type Staff = {
  /** null for the legacy admin-password session. */
  id: number | null;
  name: string;
  email: string | null;
  role: StaffRole;
};

export type TeamRef = { id: number; slug: string; name: string };

export type Viewer = {
  member: MemberRow | null;
  /** The member's current team (members.team_id), if any. */
  team: TeamRef | null;
  staff: Staff | null;
};

const MEMBER_COLS = "id, team_id, name, display_name, email, role, public_code, checked_in_at, activated_at, deleted_at";

export async function getMemberById(id: number) {
  const [m] = await query<MemberRow>(`select ${MEMBER_COLS} from members where id = $1 and deleted_at is null`, [id]);
  return m ?? null;
}

async function getTeamRef(id: number | null) {
  if (!id) return null;
  const [t] = await query<TeamRef>("select id, slug, name from teams where id = $1", [id]);
  return t ?? null;
}

/**
 * The signed-in member, from the member cookie or the team cookie's picked
 * member. This is a *team-level* identity: anyone with the team password can
 * pick any teammate's name. Use it for team-hub reads and team edits only;
 * personal actions (consent, pairing, selfie, GitHub link, finalize) go
 * through requirePersonalMember().
 */
export async function getMember(): Promise<MemberRow | null> {
  const [ms, ts] = await Promise.all([getMemberSession(), getTeamSession()]);
  const id = ms?.memberId ?? ts?.memberId ?? null;
  // No cookie: a CLI/MCP call that sent only its TestMu access key (src/proxy.ts).
  if (!id) return memberFromPrincipal(getMemberById);
  const m = await getMemberById(id);
  // A team-cookie member must still be on that team.
  if (m && !ms && ts && m.team_id !== ts.teamId) return null;
  return m;
}

/** The signed-in staff account (re-checked as active), or the legacy admin. */
export async function getStaff(): Promise<Staff | null> {
  const s = await getStaffSession();
  if (s) {
    const [row] = await query<Staff>("select id, name, email, role from staff_accounts where id = $1 and active", [s.staffId]);
    if (row) return row;
  }
  if (await hasAdminCookie()) return { id: null, name: "Admin", email: null, role: "admin" };
  return null;
}

export async function getViewer(): Promise<Viewer> {
  const [member, staff] = await Promise.all([getMember(), getStaff()]);
  return { member, staff, team: await getTeamRef(member?.team_id ?? null) };
}

/** Throws UNAUTHENTICATED unless a member is signed in. */
export async function requireMember(): Promise<MemberRow> {
  const m = await getMember();
  if (!m) throw new AppError("UNAUTHENTICATED");
  return m;
}

/** The member proven to be *this person* (personal session), or null. */
export async function getPersonalMember(): Promise<MemberRow | null> {
  const ms = await getMemberSession();
  // The TestMu access key is the person's own credential, so it counts as personal.
  if (!ms) return memberFromPrincipal(getMemberById);
  if (!ms.personal) return null;
  return getMemberById(ms.memberId);
}

export const PERSONAL_SIGN_IN =
  "This is a personal step, so sign in as yourself at /passport/login with your password or a one-time code from the desk.";

/**
 * Personal actions (consents, pairing approval, selfie, GitHub link,
 * finalize): the person must have proven who they are. A team-password
 * session, where anyone can pick any teammate's name, is not enough.
 */
export async function requirePersonalMember(): Promise<MemberRow> {
  const m = await getPersonalMember();
  if (m) return m;
  throw new AppError("UNAUTHENTICATED", { userMessage: PERSONAL_SIGN_IN });
}

/** Re-issue the member cookie for `memberId`, keeping it personal only if it already was for that person. */
export async function rememberMember(memberId: number) {
  const ms = await getMemberSession();
  await setMemberSession({ memberId, personal: !!(ms?.personal && ms.memberId === memberId) });
}

/**
 * A member of the team at `slug` (team cookie or member cookie), or, with
 * `allowStaff`, organizer/admin staff for read-only views (member = null).
 * Never lets staff act *as* a member.
 */
export async function requireTeamMember(slug: string, opts: { allowStaff?: boolean } = {}): Promise<{ team: TeamRef; member: MemberRow | null; staff: Staff | null }> {
  const [t] = await query<TeamRef>("select id, slug, name from teams where slug = $1", [slug]);
  if (!t) throw new AppError("NOT_FOUND");
  const member = await getMember();
  if (member && member.team_id === t.id) return { team: t, member, staff: null };
  if (opts.allowStaff) {
    const staff = await getStaff();
    if (staff && (staff.role === "organizer" || staff.role === "admin")) return { team: t, member: null, staff };
  }
  throw new AppError(member ? "FORBIDDEN" : "UNAUTHENTICATED");
}

/** Staff with one of `roles`. Admin passes every check. */
export async function requireRole(...roles: StaffRole[]): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) throw new AppError("UNAUTHENTICATED", { userMessage: "Staff sign-in required." });
  if (staff.role !== "admin" && !roles.includes(staff.role)) throw new AppError("FORBIDDEN");
  return staff;
}

export const hasRole = (staff: Staff | null, ...roles: StaffRole[]) => !!staff && (staff.role === "admin" || roles.includes(staff.role));

// ── Actors for audit ─────────────────────────────────────────────────────────

export const memberActor = (m: Pick<MemberRow, "id" | "name" | "team_id">): Actor => ({ type: "member", id: m.id, label: m.name, teamId: m.team_id });
export const staffActor = (s: Staff): Actor => ({ type: "staff", id: s.id, label: `${s.name} (${s.role})`, role: s.role });
export const tokenActor = (t: BearerAuth): Actor => ({ type: "token", id: t.tokenId, memberId: t.member.id, label: t.member.name, teamId: t.member.team_id });

// ── Staff accounts and login ─────────────────────────────────────────────────

const LOGIN_CODE_MINUTES = 60 * 24 * 3;
// No 0/O/1/I/L, so a code read aloud or off paper survives.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function randomCode(length: number) {
  let s = "";
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** Create or update a staff account (organizer action; also used by scripts/seed-staff.mjs logic). */
export async function upsertStaff(input: { email: string; name: string; role: StaffRole; active?: boolean }, actor: Actor) {
  return transaction(async (tx) => {
    const { rows } = await tx.query<{ id: number }>(
      `insert into staff_accounts (email, name, role, active, created_by)
       values (lower($1), $2, $3, $4, $5)
       on conflict ((lower(email))) do update set name = excluded.name, role = excluded.role, active = excluded.active
       returning id`,
      [input.email.trim(), input.name.trim(), input.role, input.active ?? true, actor.type === "staff" ? actor.id : null],
    );
    await writeAudit(actor, { action: "staff.upsert", resourceType: "staff_account", resourceId: rows[0].id, after: { ...input, email: sha256(input.email.toLowerCase()) } }, tx);
    return rows[0].id;
  });
}

/** A fresh one-time login code for a staff account. The code is returned once and only its hash is stored. */
export async function issueStaffLoginCode(staffId: number, actor: Actor) {
  const code = `${randomCode(4)}-${randomCode(4)}`;
  await transaction(async (tx) => {
    await tx.query("update staff_login_codes set used_at = now() where staff_id = $1 and used_at is null", [staffId]);
    await tx.query(
      `insert into staff_login_codes (staff_id, code_hash, expires_at) values ($1, $2, now() + make_interval(mins => $3))`,
      [staffId, sha256(normalizeCode(code)), LOGIN_CODE_MINUTES],
    );
    await writeAudit(actor, { action: "staff.issue_code", resourceType: "staff_account", resourceId: staffId }, tx);
  });
  return code;
}

const normalizeCode = (c: string) => c.toUpperCase().replace(/[^0-9A-Z]/g, "");

/** Email + one-time code → staff session. Same error either way so it doesn't confirm accounts. */
export async function staffLoginWithCode(email: string, code: string): Promise<Staff> {
  const staff = await transaction(async (tx) => {
    const { rows } = await tx.query<Staff & { id: number; code_id: number }>(
      `select s.id, s.name, s.email, s.role, c.id as code_id
         from staff_accounts s join staff_login_codes c on c.staff_id = s.id
        where lower(s.email) = lower($1) and s.active and c.code_hash = $2 and c.used_at is null and c.expires_at > now()
        for update of c`,
      [email.trim(), sha256(normalizeCode(code))],
    );
    const row = rows[0];
    if (!row) return null;
    await tx.query("update staff_login_codes set used_at = now() where id = $1", [row.code_id]);
    await tx.query("update staff_accounts set last_login_at = now() where id = $1", [row.id]);
    await writeAudit({ type: "staff", id: row.id, label: row.name, role: row.role }, { action: "staff.login", resourceType: "staff_account", resourceId: row.id }, tx);
    return { id: row.id, name: row.name, email: row.email, role: row.role } satisfies Staff;
  });
  if (!staff) throw new AppError("UNAUTHENTICATED", { userMessage: "That email and code don't match, or the code was already used." });
  await setStaffSession(staff.id!, staff.role);
  return staff;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** The legacy ADMIN_PASSWORD login, kept as the break-glass admin path. */
export async function adminPasswordLogin(password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new AppError("FORBIDDEN", { userMessage: "ADMIN_PASSWORD is not configured." });
  if (!timingSafeEqual(digest(password), digest(expected))) throw new AppError("UNAUTHENTICATED", { userMessage: "Wrong password." });
  await setAdminSession();
  await writeAudit({ type: "staff", id: null, label: "Admin (password)", role: "admin" }, { action: "staff.login_password", resourceType: "staff_account", resourceId: "admin" });
}

export async function staffLogout() {
  await Promise.all([clearStaffSession(), clearAdminSession()]);
}

export async function memberLogout() {
  await clearMemberSession();
}

// ── Bearer tokens (CLI / MCP) ────────────────────────────────────────────────

export type BearerAuth = { tokenId: number; scopes: string[]; member: MemberRow };

export const tokenHash = (token: string) => sha256(token.trim());

/** A new random token with a recognisable prefix ("khk_" bearer, "khp_" pairing). Store only tokenHash(token). */
export function newToken(kind: "bearer" | "pairing" | "badge" | "phone_handoff") {
  const prefix = { bearer: "khk_", pairing: "khp_", badge: "khb_", phone_handoff: "khh_" }[kind];
  return prefix + randomBytes(24).toString("base64url");
}

/**
 * Resolve `Authorization: Bearer <token>` against member_tokens (kind 'bearer',
 * not revoked, not expired). Returns null when absent or invalid; callers turn
 * that into 401. Updates last_used_at.
 */
export async function authenticateBearer(req: Request): Promise<BearerAuth | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return null;
  const [row] = await query<{ id: number; member_id: number; scopes: string[] }>(
    `update member_tokens set last_used_at = now()
      where token_hash = $1 and kind = 'bearer' and revoked_at is null and expires_at > now()
      returning id, member_id, scopes`,
    [tokenHash(m[1])],
  );
  if (!row) return null;
  const member = await getMemberById(row.member_id);
  return member ? { tokenId: row.id, scopes: row.scopes, member } : null;
}

/** Like authenticateBearer but throws UNAUTHENTICATED. */
export async function requireBearer(req: Request): Promise<BearerAuth> {
  const auth = await authenticateBearer(req);
  if (!auth) throw new AppError("UNAUTHENTICATED", { userMessage: "Missing or invalid token. Pair this machine again with `kanehack pair`." });
  return auth;
}
