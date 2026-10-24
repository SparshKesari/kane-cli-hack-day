import { notifyTeam } from "./member-notifications";
import "server-only";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { DEFAULT_TRACK, LEGACY_TRACKS, challenge, trackLabel } from "@/data/hackday";
import { query } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { slugify } from "@/lib/teams";
import { authenticateBearer, getMember, memberActor, randomCode, staffActor, tokenActor, type MemberRow, type Staff } from "./auth";
import { AppError, idempotent, parse, sha256, withAudit, writeAudit, z, zx, type Actor, type Receipt } from "./core";

// Teams as their own lifecycle (SPEC §4). A person exists without a team; a
// team has a captain, a size cap, one-time invites, and a roster that locks at
// the event's team lock time. Every change here runs in one transaction with
// its audit row, so a refused join (TEAM_FULL, expired invite, locked roster)
// leaves nothing behind.
//
// members.team_id is kept in step with team_memberships: the hub and auth read
// the pointer, history lives in the memberships table.

/** Organiser decision (PLAN D1/SPEC §4): teams of up to 4. A team's own max_size can only lower it. */
export const TEAM_SIZE_CAP = 4;
const INVITE_DEFAULT_HOURS = 24;

export type TeamState = "recruiting" | "formed" | "active" | "roster_locked" | "submitted" | "withdrawn";

export type TeamInfo = {
  id: number;
  slug: string;
  name: string;
  track: string;
  is_solo: boolean;
  state: TeamState;
  captain_id: number | null;
  /** min(teams.max_size, TEAM_SIZE_CAP). */
  cap: number;
  max_size: number;
  table_label: string | null;
  summary_public: string | null;
  recruiting_open: boolean;
  roster_locked_at: Date | null;
  team_lock_at: Date;
  /** Roster changes need an organizer: the captain locked it, the team submitted or withdrew, or an organizer locked it. */
  locked: boolean;
  member_count: number;
  seeking_skills: string[];
  repo_url: string | null;
  project_slug: string | null;
};

export type RosterEntry = {
  member_id: number;
  name: string;
  public_code: string | null;
  role: "captain" | "member";
  joined_at: Date;
};

export type InviteRow = {
  id: number;
  created_at: Date;
  expires_at: Date;
  created_by_name: string | null;
  for_member: string | null;
};

// The single definition of "effectively locked", shared by reads and the join transaction. The team
// lock time doesn't lock anything: on event day (2026-10-24) people had to keep moving between teams.
const LOCKED_SQL = `(t.state in ('roster_locked','submitted','withdrawn'))`;

const TEAM_SELECT = `
  select t.id, t.slug, t.name, t.track, t.is_solo, t.state, t.captain_id,
         least(t.max_size, ${TEAM_SIZE_CAP})::int as cap, t.max_size, t.table_label, t.summary_public,
         t.recruiting_open, t.roster_locked_at,
         (select e.team_lock_at from hack_events e where e.id = coalesce(t.event_id, current_event_id())) as team_lock_at,
         ${LOCKED_SQL} as locked,
         (select count(*)::int from team_memberships tm where tm.team_id = t.id and tm.left_at is null) as member_count,
         coalesce((select r.seeking_skills from team_recruiting r where r.team_id = t.id), '{}') as seeking_skills,
         p.repo_url, p.slug as project_slug
    from teams t left join projects p on p.team_id = t.id`;

// ── Who is acting ────────────────────────────────────────────────────────────

export type ActingMember = { member: MemberRow; actor: Actor };

/**
 * The participant behind a request: a CLI/MCP bearer token if one is sent,
 * otherwise the browser's member or team cookie. Throws UNAUTHENTICATED.
 */
export async function actingMember(req?: Request): Promise<ActingMember> {
  if (req?.headers.get("authorization")) {
    const bearer = await authenticateBearer(req);
    if (!bearer) throw new AppError("UNAUTHENTICATED", { userMessage: "Missing or invalid token. Pair this machine again with `kanehack pair`." });
    return { member: bearer.member, actor: tokenActor(bearer) };
  }
  const member = await getMember();
  if (!member) throw new AppError("UNAUTHENTICATED");
  return { member, actor: memberActor(member) };
}

export const receiptOf = (id: string | number, at: Date): Receipt => ({ id: String(id), server_time: at.toISOString() });

// ── Team lock time (T-TEAM-04) ───────────────────────────────────────────────

/**
 * Once the team lock time passes (server clock), stamp roster_locked_at on every open team so
 * it can go on to activation without a captain lock. The roster stays open: state is unchanged.
 * Called lazily from reads and writes here; the cron can call it too.
 */
export async function syncRosterLocks() {
  const rows = await query<{ id: number; state: string }>(
    `update teams t set roster_locked_at = now()
      where t.state in ('recruiting','formed','active') and t.roster_locked_at is null
        and now() >= (select e.team_lock_at from hack_events e where e.id = coalesce(t.event_id, current_event_id()))
      returning t.id, t.state`,
  ).catch((err) => {
    console.error("[teams] roster lock sync failed", err);
    return [];
  });
  for (const r of rows) {
    await writeAudit({ type: "system", label: "team lock" }, { action: "team.lock_time", resourceType: "team", resourceId: r.id, reason: "Team lock time reached; roster stays open" }).catch(() => {});
  }
  return rows.length;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getTeamInfo(by: { slug: string } | { id: number }): Promise<TeamInfo | null> {
  await syncRosterLocks();
  const [t] = await query<TeamInfo>(`${TEAM_SELECT} where ${"slug" in by ? "t.slug = $1" : "t.id = $1"}`, ["slug" in by ? by.slug : by.id]);
  return t ?? null;
}

export async function getRoster(teamId: number) {
  return query<RosterEntry>(
    `select m.id as member_id, coalesce(m.display_name, m.name) as name, m.public_code, tm.role, tm.joined_at
       from team_memberships tm join members m on m.id = tm.member_id
      where tm.team_id = $1 and tm.left_at is null and m.deleted_at is null
      order by (tm.role = 'captain') desc, tm.joined_at`,
    [teamId],
  );
}

export async function listOpenInvites(teamId: number) {
  return query<InviteRow>(
    `select i.id, i.created_at, i.expires_at, coalesce(c.display_name, c.name) as created_by_name,
            coalesce(t.display_name, t.name) as for_member
       from invitations i
       left join members c on c.id = i.created_by
       left join members t on t.id = i.invited_member_id
      where i.team_id = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      order by i.created_at desc`,
    [teamId],
  );
}

/** The member's current team (via membership history), or null. */
export async function currentTeamOf(memberId: number) {
  const [row] = await query<{ team_id: number; slug: string; name: string; role: "captain" | "member" }>(
    `select tm.team_id, t.slug, t.name, tm.role
       from team_memberships tm join teams t on t.id = tm.team_id
      where tm.member_id = $1 and tm.left_at is null`,
    [memberId],
  );
  return row ?? null;
}

/** MCP team_find: open teams with seats, for someone looking. People come from match.ts suggestions. */
export async function listRecruitingTeams(opts: { excludeTeamId?: number | null; skill?: string | null; limit?: number } = {}) {
  await syncRosterLocks();
  const rows = await query<TeamInfo>(
    `${TEAM_SELECT}
      where t.recruiting_open and not ${LOCKED_SQL} and coalesce(t.state, '') <> 'withdrawn'
        and ($1::bigint is null or t.id <> $1)
        and (select count(*) from team_memberships tm where tm.team_id = t.id and tm.left_at is null) < least(t.max_size, ${TEAM_SIZE_CAP})
      order by t.created_at desc
      limit $2`,
    [opts.excludeTeamId ?? null, opts.limit ?? 50],
  );
  const skill = opts.skill?.trim().toLowerCase();
  return skill ? rows.filter((t) => t.seeking_skills.some((s) => s.toLowerCase().includes(skill))) : rows;
}

/** Every team that hasn't withdrawn, oldest first: the public /teams page. Callers show no member names. */
export async function listTeamDirectory() {
  return query<TeamInfo>(`${TEAM_SELECT} where coalesce(t.state, '') <> 'withdrawn' order by t.created_at`);
}

/** Participants (not staff) with no team; `matching` is those who said yes to teammate matching. */
export async function teamlessCounts() {
  const [r] = await query<{ total: number; matching: number }>(
    `select count(*)::int as total,
            count(*) filter (where m.looking_for_team and exists (select 1 from member_consent_current c
              where c.member_id = m.id and c.category = 'teammate_discovery' and c.granted))::int as matching
       from members m
      where m.team_id is null and m.deleted_at is null and m.role = 'participant'`,
  );
  return r;
}

// ── Create (T-TEAM-02) ───────────────────────────────────────────────────────

export const createTeamSchema = z.object({
  name: zx.text(60),
  /** Optional now (same rubric for every track); teams created without one are Other, and old track names become Other. */
  track: z.string().trim().optional().transform((s) => (!s || LEGACY_TRACKS.includes(s) ? DEFAULT_TRACK : s)).refine((s) => challenge.tracks.includes(s), "Pick a track."),
  /** Optional: lets teammates sign in on a shared device with name + password, as at registration. */
  password: z.string().max(200).optional().transform((s) => (s ? s : null)).refine((s) => s === null || s.length >= 8, "Use at least 8 characters."),
  summary_public: zx.optText(280),
  recruiting_open: zx.checkbox.default(false),
  /** Skills the team wants, shown on its open-seats card. */
  seeking_skills: z.string().max(600).optional().transform((v) => normalizeTags(v)),
  solo: zx.checkbox.default(false),
  idempotency_key: zx.idempotencyKey,
});

export type CreatedTeam = { teamId: number; slug: string; state: TeamState; receipt: Receipt };

/**
 * An existing member (no current team) starts a team and becomes captain.
 * Reserves projects.slug = team slug (the /ship/{slug} page) and seeds the
 * private idea. After the team lock time the new team is stamped (roster_locked_at) so it can
 * activate straight away, and its roster stays open like every other team's.
 */
export async function createTeam(who: ActingMember, input: unknown): Promise<CreatedTeam> {
  const data = parse(createTeamSchema, input);
  const slug = slugify(data.name);
  if (!slug) throw new AppError("VALIDATION_FAILED", { userMessage: "Use letters or numbers in the team name." });
  const passwordHash = await hashPassword(data.password ?? randomBytes(24).toString("base64url"));

  const { result } = await idempotent(data.idempotency_key, `team.create:member:${who.member.id}`, () =>
    withAudit<CreatedTeam>(who.actor, "team.create", "team", async (tx) => {
      const { rows: cur } = await tx.query("select 1 from team_memberships where member_id = $1 and left_at is null for update", [who.member.id]);
      if (cur.length) throw new AppError("CONFLICT", { userMessage: "You're already on a team. Leave it first, then start a new one." });

      const { rows: taken } = await tx.query("select 1 from teams where slug = $1 union all select 1 from projects where slug = $1 union all select 1 from project_slug_redirects where old_slug = $1", [slug]);
      if (taken.length) throw new AppError("CONFLICT", { userMessage: "That team name is taken. Try another." });

      const { rows } = await tx.query<{ id: number; state: TeamState; now: Date }>(
        `insert into teams (slug, name, track, idea, is_solo, password_hash, captain_id, state, max_size, recruiting_open, summary_public, roster_locked_at)
         select $1::text, $2::text, $3::text, '', $4::boolean, $5::text, $6::bigint,
                case when $4::boolean then 'formed' else 'recruiting' end,
                $7::int, $8::boolean and not $4::boolean, $9::text,
                case when now() >= e.team_lock_at then now() end
           from hack_events e where e.id = current_event_id()
         returning id, state, now() as now`,
        [slug, data.name, data.track, data.solo, passwordHash, who.member.id, TEAM_SIZE_CAP, data.recruiting_open, data.summary_public],
      );
      const team = rows[0];
      if (!team) throw new AppError("INTERNAL", { message: "No hack_events row" });
      await tx.query("insert into team_memberships (team_id, member_id, role) values ($1, $2, 'captain')", [team.id, who.member.id]);
      await tx.query("update members set team_id = $2 where id = $1", [who.member.id, team.id]);
      if (data.seeking_skills.length) {
        await tx.query("insert into team_recruiting (team_id, seeking_skills, updated_at) values ($1, $2, now()) on conflict (team_id) do update set seeking_skills = excluded.seeking_skills, updated_at = now()", [team.id, data.seeking_skills]);
      }
      await tx.query("insert into projects (team_id, name, slug) values ($1, $2, $3)", [team.id, data.name, slug]);
      await tx.query("insert into ideas (team_id, title) values ($1, $2) on conflict (team_id) do nothing", [team.id, data.name.slice(0, 120)]);
      await tx.query("update projects p set idea_id = i.id from ideas i where i.team_id = p.team_id and p.team_id = $1", [team.id]);
      await tx.query("insert into activity (team_id, member_id, action) values ($1, $2, 'Team created')", [team.id, who.member.id]);
      const out: CreatedTeam = { teamId: team.id, slug, state: team.state, receipt: receiptOf(`T-${team.id}`, team.now) };
      return { result: out, resourceId: team.id, after: { slug, name: data.name, track: data.track, state: team.state } };
    }),
  );
  return result;
}

// ── Invites (T-TEAM-03) ──────────────────────────────────────────────────────

const normalizeInvite = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, "");
const inviteHash = (code: string) => sha256(`invite:${normalizeInvite(code)}`);

export const createInviteSchema = z.object({
  hours: z.coerce.number().int().min(1).max(72).default(INVITE_DEFAULT_HOURS),
  /** Optional: restrict the code to one person by their P-#### badge code. */
  for_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^P-\d{3,6}$/, "Use the P-#### code from their badge.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type CreatedInvite = { inviteId: number; code: string; expiresAt: string; joinPath: string; receipt: Receipt };

/** Any current member may invite while seats remain and the roster is open. The code is shown once. */
export async function createInvite(who: ActingMember, teamId: number, input: unknown): Promise<CreatedInvite> {
  const data = parse(createInviteSchema, input);
  const code = `${randomCode(4)}-${randomCode(4)}`;
  return withAudit(who.actor, "team.invite_create", "invitation", async (tx) => {
    const team = await lockTeam(tx, teamId);
    await assertCurrentMember(tx, teamId, who.member.id);
    if (team.locked) throw new AppError("DEADLINE_PASSED", { userMessage: "The roster is locked. An organizer has to approve changes now." });
    if (team.member_count >= team.cap) throw new AppError("TEAM_FULL", { userMessage: `Your team already has ${team.member_count} of ${team.cap}.` });
    let invitedId: number | null = null;
    if (data.for_code) {
      const { rows } = await tx.query<{ id: number }>("select id from members where public_code = $1 and deleted_at is null", [data.for_code]);
      if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "No participant has that P-code." });
      invitedId = rows[0].id;
    }
    const { rows } = await tx.query<{ id: number; expires_at: Date; now: Date }>(
      `insert into invitations (team_id, invite_hash, invited_member_id, created_by, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(hours => $5)) returning id, expires_at, now() as now`,
      [teamId, inviteHash(code), invitedId, who.member.id, data.hours],
    );
    const inv = rows[0];
    const out: CreatedInvite = {
      inviteId: inv.id,
      code,
      expiresAt: inv.expires_at.toISOString(),
      joinPath: `/team?code=${encodeURIComponent(code)}`,
      receipt: receiptOf(`INV-${inv.id}`, inv.now),
    };
    return { result: out, resourceId: inv.id, after: { team_id: teamId, hours: data.hours, restricted: invitedId !== null } };
  });
}

/** The captain revokes any open invite; whoever created one may revoke their own. */
export async function revokeInvite(who: ActingMember, teamId: number, inviteId: number) {
  return withAudit(who.actor, "team.invite_revoke", "invitation", async (tx) => {
    const team = await lockTeam(tx, teamId);
    await assertCurrentMember(tx, teamId, who.member.id);
    const { rows } = await tx.query<{ id: number; now: Date }>(
      `update invitations set revoked_at = now()
        where id = $1 and team_id = $2 and accepted_at is null and revoked_at is null and (created_by = $3 or $4::boolean)
        returning id, now() as now`,
      [inviteId, teamId, who.member.id, team.captain_id === who.member.id],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "That invite is already used, revoked, or not yours to revoke." });
    return { result: receiptOf(`INV-${inviteId}`, rows[0].now), resourceId: inviteId };
  });
}

export type InvitePreview = {
  team: Pick<TeamInfo, "id" | "slug" | "name" | "track" | "member_count" | "cap" | "locked" | "summary_public">;
  expiresAt: Date;
  restricted: boolean;
  forYou: boolean;
};

/** What a code points at, without using it. Expired / used / revoked codes all read the same. */
export async function previewInvite(code: string, viewer: MemberRow | null): Promise<InvitePreview | null> {
  if (!normalizeInvite(code)) return null;
  const [inv] = await query<{ team_id: number; expires_at: Date; invited_member_id: number | null }>(
    `select team_id, expires_at, invited_member_id from invitations
      where invite_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now()`,
    [inviteHash(code)],
  );
  if (!inv) return null;
  const team = await getTeamInfo({ id: inv.team_id });
  if (!team) return null;
  return {
    team: { id: team.id, slug: team.slug, name: team.name, track: trackLabel(team.track), member_count: team.member_count, cap: team.cap, locked: team.locked, summary_public: team.summary_public },
    expiresAt: inv.expires_at,
    restricted: inv.invited_member_id !== null,
    forYou: inv.invited_member_id === null || inv.invited_member_id === viewer?.id,
  };
}

export const joinSchema = z.object({
  code: z.string().trim().min(4).max(40),
  /** Joining is never implicit: the person (or their agent, after asking them) confirms. */
  confirm: zx.checkbox.refine((v) => v, "Confirm that you want to join this team."),
  idempotency_key: zx.idempotencyKey,
});

export type JoinResult = { teamId: number; slug: string; name: string; leftTeam: string | null; receipt: Receipt };

/**
 * Accept a one-time invite. One transaction: lock the invite and the team
 * row, check the roster is open and below the cap, close the member's
 * previous membership, open the new one, burn the invite. Any failure rolls
 * all of it back, so there is never a half-joined member.
 */
export async function joinTeam(who: ActingMember, input: unknown): Promise<JoinResult> {
  const data = parse(joinSchema, input);
  await syncRosterLocks();
  const { result } = await idempotent(data.idempotency_key, `team.join:member:${who.member.id}`, () =>
    withAudit<JoinResult>(who.actor, "team.join", "team", async (tx) => {
      const { rows: invs } = await tx.query<{ id: number; team_id: number; invited_member_id: number | null; invited_email_hash: string | null }>(
        `select id, team_id, invited_member_id, invited_email_hash from invitations
          where invite_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now()
          for update`,
        [inviteHash(data.code)],
      );
      const inv = invs[0];
      if (!inv) throw new AppError("NOT_FOUND", { userMessage: "That invite code has expired, was already used, or was revoked. Ask the team for a new one." });
      if (inv.invited_member_id !== null && inv.invited_member_id !== who.member.id) throw new AppError("FORBIDDEN", { userMessage: "That invite was made for someone else." });

      const team = await lockTeam(tx, inv.team_id);
      if (team.locked) throw new AppError("DEADLINE_PASSED", { userMessage: "This team's roster is locked. An organizer has to approve changes now." });
      if (team.member_count >= team.cap) throw new AppError("TEAM_FULL", { userMessage: `${team.name} already has ${team.member_count} of ${team.cap}.` });

      const left = await leaveCurrentTeam(tx, who.member.id, team.id, "switched team");
      await tx.query("insert into team_memberships (team_id, member_id, role) values ($1, $2, 'member')", [team.id, who.member.id]);
      await tx.query("update members set team_id = $2 where id = $1", [who.member.id, team.id]);
      const { rows: done } = await tx.query<{ now: Date }>("update invitations set accepted_at = now(), accepted_by = $2 where id = $1 returning now() as now", [inv.id, who.member.id]);
      // A solo registration that takes a teammate is a team now; two people make it formed.
      await tx.query(
        `update teams set is_solo = false,
                state = case when state = 'recruiting' then 'formed' else state end,
                recruiting_open = recruiting_open and $2::boolean
          where id = $1`,
        [team.id, team.member_count + 1 < team.cap],
      );
      await tx.query("insert into activity (team_id, member_id, action) values ($1, $2, 'Joined the team')", [team.id, who.member.id]);
      const out: JoinResult = { teamId: team.id, slug: team.slug, name: team.name, leftTeam: left, receipt: receiptOf(`T-${team.id}`, done[0].now) };
      return { result: out, resourceId: team.id, payload: { invite_id: inv.id, left_team: left } };
    }),
  );
  return result;
}

// ── Leaving and captain controls (T-TEAM-05) ─────────────────────────────────

/** Leave your team before the roster locks. A captain with teammates hands over first. */
export async function leaveTeam(who: ActingMember) {
  return withAudit(who.actor, "team.leave", "team_membership", async (tx) => {
    const { rows } = await tx.query<{ team_id: number }>("select team_id from team_memberships where member_id = $1 and left_at is null for update", [who.member.id]);
    if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "You're not on a team." });
    const team = await lockTeam(tx, rows[0].team_id);
    if (team.locked) throw new AppError("DEADLINE_PASSED", { userMessage: "The roster is locked. Ask an organizer to change it." });
    await leaveCurrentTeam(tx, who.member.id, null, "left");
    const now = await txNow(tx);
    return { result: receiptOf(`T-${team.id}`, now), resourceId: team.id };
  });
}

export const captainSettingsSchema = z.object({
  recruiting_open: zx.checkbox.default(false),
  summary_public: zx.optText(280),
  table_label: zx.optText(24),
  repo_url: zx.httpsUrl.optional().or(z.literal("").transform(() => undefined)),
  seeking_skills: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => normalizeTags(v)),
});

/**
 * Captain only: "this is our final team". Locks the roster (no joins, leaves or
 * invites; an organizer can reopen it), stops recruiting and revokes open invites.
 * Done once, on the way to activation. Already locked → no-op.
 */
export async function confirmFinalTeam(who: ActingMember, teamId: number) {
  return withAudit(who.actor, "team.roster_lock_confirmed", "team", async (tx) => {
    const team = await lockTeam(tx, teamId);
    assertCaptain(team, who.member.id);
    if (!team.locked) {
      await tx.query("update teams set state = 'roster_locked', roster_locked_at = now(), recruiting_open = false where id = $1", [teamId]);
      await tx.query("update invitations set revoked_at = now() where team_id = $1 and revoked_at is null and accepted_at is null", [teamId]);
      await notifyTeam(tx, teamId, { kind: "team_locked", title: `${team.name} is locked in`, body: "Your captain confirmed the final team. On to activation.", href: "/activate" }, who.member.id);
    }
    const now = await txNow(tx);
    return { result: receiptOf(`T-${teamId}`, now), resourceId: teamId, before: { state: team.state }, reason: "Captain confirmed the final team" };
  });
}

/** Captain only: recruiting switch, public summary, table, repo, skills wanted. Never anyone's consent. */
export async function updateTeamSettings(who: ActingMember, teamId: number, input: unknown) {
  const data = parse(captainSettingsSchema, input);
  return withAudit(who.actor, "team.settings", "team", async (tx) => {
    const team = await lockTeam(tx, teamId);
    assertCaptain(team, who.member.id);
    await tx.query(
      `update teams set recruiting_open = $2::boolean and not $5::boolean, summary_public = coalesce($3::text, summary_public), table_label = coalesce($4::text, table_label) where id = $1`,
      [teamId, data.recruiting_open, data.summary_public, data.table_label, team.locked],
    );
    await tx.query(
      `insert into team_recruiting (team_id, seeking_skills, updated_at) values ($1, $2, now())
       on conflict (team_id) do update set seeking_skills = excluded.seeking_skills, updated_at = now()`,
      [teamId, data.seeking_skills],
    );
    // Repo assignment: projects is the submission area's table; this only fills the link the
    // team already owns, and only until a submission exists. TODO(manager): route via submission service.
    if (data.repo_url !== undefined) {
      await tx.query(
        `update projects set repo_url = $2, updated_at = now()
          where team_id = $1 and not exists (select 1 from submissions s where s.team_id = $1 and s.status in ('finalized','locked'))`,
        [teamId, data.repo_url],
      );
    }
    const now = await txNow(tx);
    return {
      result: receiptOf(`T-${teamId}`, now),
      resourceId: teamId,
      before: { recruiting_open: team.recruiting_open, summary_public: team.summary_public, table_label: team.table_label },
      after: data,
    };
  });
}

/** Captain only, before the lock. A captain can't remove themselves (leave or hand over instead). */
export async function removeMember(who: ActingMember, teamId: number, memberId: number) {
  return withAudit(who.actor, "team.remove_member", "team_membership", async (tx) => {
    const team = await lockTeam(tx, teamId);
    assertCaptain(team, who.member.id);
    if (team.locked) throw new AppError("DEADLINE_PASSED", { userMessage: "The roster is locked. Ask an organizer to change it." });
    if (memberId === who.member.id) throw new AppError("VALIDATION_FAILED", { userMessage: "Hand the captaincy over or leave the team instead." });
    const n = await closeMembership(tx, teamId, memberId, "removed by captain");
    if (!n) throw new AppError("NOT_FOUND", { userMessage: "That person isn't on your team." });
    await tx.query("insert into activity (team_id, member_id, action) values ($1, $2, 'Removed a teammate')", [teamId, who.member.id]);
    const now = await txNow(tx);
    return { result: receiptOf(`T-${teamId}`, now), resourceId: teamId, payload: { member_id: memberId } };
  });
}

/** Captain hands over to a current teammate. Allowed after the lock (it doesn't change the roster). */
export async function transferCaptain(who: ActingMember, teamId: number, memberId: number) {
  return withAudit(who.actor, "team.transfer_captain", "team", async (tx) => {
    const team = await lockTeam(tx, teamId);
    assertCaptain(team, who.member.id);
    await setCaptain(tx, teamId, memberId);
    const now = await txNow(tx);
    return { result: receiptOf(`T-${teamId}`, now), resourceId: teamId, before: { captain_id: team.captain_id }, after: { captain_id: memberId } };
  });
}

/** Captain moves the team forward: recruiting → formed → active. The lock and submission states are set elsewhere. */
export async function advanceTeamState(who: ActingMember, teamId: number, to: "formed" | "active") {
  return withAudit(who.actor, "team.state", "team", async (tx) => {
    const team = await lockTeam(tx, teamId);
    assertCaptain(team, who.member.id);
    const order: TeamState[] = ["recruiting", "formed", "active"];
    if (!order.includes(team.state) || order.indexOf(to) <= order.indexOf(team.state)) {
      throw new AppError("CONFLICT", { userMessage: `The team is ${team.state.replace("_", " ")}; it can't move to ${to}.` });
    }
    await tx.query("update teams set state = $2::text, recruiting_open = recruiting_open and $2::text <> 'active' where id = $1", [teamId, to]);
    const now = await txNow(tx);
    return { result: receiptOf(`T-${teamId}`, now), resourceId: teamId, before: { state: team.state }, after: { state: to } };
  });
}

// ── Organizer override (T-TEAM-04) ───────────────────────────────────────────

export const overrideSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_member"), member_code: z.string().trim().toUpperCase().regex(/^P-\d{3,6}$/), reason: zx.text(500).pipe(z.string().min(10, "Give a reason (10+ characters).")) }),
  z.object({ action: z.literal("remove_member"), member_id: zx.id, reason: zx.text(500).pipe(z.string().min(10, "Give a reason (10+ characters).")) }),
  z.object({ action: z.literal("set_captain"), member_id: zx.id, reason: zx.text(500).pipe(z.string().min(10, "Give a reason (10+ characters).")) }),
  z.object({ action: z.literal("reopen_roster"), reason: zx.text(500).pipe(z.string().min(10, "Give a reason (10+ characters).")) }),
  z.object({ action: z.literal("lock_roster"), reason: zx.text(500).pipe(z.string().min(10, "Give a reason (10+ characters).")) }),
  z.object({ action: z.literal("set_max_size"), max_size: z.coerce.number().int().min(1).max(TEAM_SIZE_CAP), reason: zx.text(500).pipe(z.string().min(10, "Give a reason (10+ characters).")) }),
]);

/**
 * Organizer-approved roster change, allowed after the lock. Writes an audit
 * event with the reason; membership rows record approved_by. The size cap
 * still holds (raise max_size explicitly first if policy allows).
 */
export async function organizerOverride(staff: Staff, teamId: number, input: unknown) {
  if (staff.role !== "organizer" && staff.role !== "admin") throw new AppError("FORBIDDEN");
  const data = parse(overrideSchema, input);
  return withAudit(staffActor(staff), `team.override.${data.action}`, "team", async (tx) => {
    const team = await lockTeam(tx, teamId);
    switch (data.action) {
      case "add_member": {
        const { rows } = await tx.query<{ id: number }>("select id from members where public_code = $1 and deleted_at is null", [data.member_code]);
        const memberId = rows[0]?.id;
        if (!memberId) throw new AppError("NOT_FOUND", { userMessage: "No participant has that P-code." });
        if (team.member_count >= team.cap) throw new AppError("TEAM_FULL");
        await leaveCurrentTeam(tx, memberId, team.id, "moved by organizer", staff.id);
        await tx.query("insert into team_memberships (team_id, member_id, role, approved_by) values ($1, $2, 'member', $3)", [teamId, memberId, staff.id]);
        await tx.query("update members set team_id = $2 where id = $1", [memberId, teamId]);
        await tx.query("update teams set is_solo = false where id = $1", [teamId]);
        break;
      }
      case "remove_member": {
        if (!(await closeMembership(tx, teamId, data.member_id, "removed by organizer", staff.id))) throw new AppError("NOT_FOUND");
        break;
      }
      case "set_captain":
        await setCaptain(tx, teamId, data.member_id);
        break;
      case "reopen_roster":
        // roster_locked_at stays set, so the automatic lock doesn't close it again.
        await tx.query(
          "update teams set state = case when state = 'roster_locked' then 'active' else state end, roster_locked_at = coalesce(roster_locked_at, now()) where id = $1",
          [teamId],
        );
        break;
      case "lock_roster":
        await tx.query("update teams set state = 'roster_locked', roster_locked_at = now() where id = $1 and state in ('recruiting','formed','active')", [teamId]);
        break;
      case "set_max_size":
        if (data.max_size < team.member_count) throw new AppError("CONFLICT", { userMessage: `The team already has ${team.member_count}.` });
        await tx.query("update teams set max_size = $2 where id = $1", [teamId, data.max_size]);
        break;
    }
    const now = await txNow(tx);
    return {
      result: receiptOf(`T-${teamId}`, now),
      resourceId: teamId,
      reason: data.reason,
      before: { state: team.state, captain_id: team.captain_id, member_count: team.member_count, max_size: team.max_size },
      payload: { ...data, reason: undefined },
    };
  });
}

// ── Matchmaking (event-day flow) ─────────────────────────────────────────────

/**
 * Add a teamless member to a team after a team member accepted their "ask to
 * join" request. Same rules as an invite: roster open, below the cap, and the
 * member isn't on a team already (it never moves anyone off a team).
 */
export async function admitToTeam(actor: Actor, teamId: number, memberId: number, via: string) {
  return withAudit(actor, "team.admit", "team", async (tx) => {
    const team = await lockTeam(tx, teamId);
    if (team.locked) throw new AppError("DEADLINE_PASSED", { userMessage: "This team's roster is locked. An organizer has to approve changes now." });
    if (team.member_count >= team.cap) throw new AppError("TEAM_FULL", { userMessage: `${team.name} already has ${team.member_count} of ${team.cap}.` });
    const { rows: cur } = await tx.query("select 1 from team_memberships where member_id = $1 and left_at is null for update", [memberId]);
    if (cur[0]) throw new AppError("CONFLICT", { userMessage: "They're already on a team." });
    await tx.query("insert into team_memberships (team_id, member_id, role) values ($1, $2, 'member')", [teamId, memberId]);
    await tx.query("update members set team_id = $2 where id = $1", [memberId, teamId]);
    await tx.query(
      `update teams set is_solo = false, state = case when state = 'recruiting' then 'formed' else state end,
              recruiting_open = recruiting_open and $2::boolean where id = $1`,
      [teamId, team.member_count + 1 < team.cap],
    );
    await tx.query("insert into activity (team_id, member_id, action) values ($1, $2, 'Joined the team')", [teamId, memberId]);
    const now = await txNow(tx);
    return { result: { teamId, slug: team.slug, receipt: receiptOf(`T-${teamId}`, now) }, resourceId: teamId, payload: { member_id: memberId, via } };
  });
}

export const formTeamSchema = z.object({
  member_ids: z
    .union([zx.id, z.array(zx.id)])
    .transform((v) => [...new Set(Array.isArray(v) ? v : [v])])
    .refine((v) => v.length >= 2 && v.length <= TEAM_SIZE_CAP, `Pick 2 to ${TEAM_SIZE_CAP} people.`),
  name: zx.text(60),
  track: z.string().trim().transform((s) => (LEGACY_TRACKS.includes(s) ? DEFAULT_TRACK : s)).refine((s) => challenge.tracks.includes(s), "Pick a track."),
  reason: zx.optText(500),
  idempotency_key: zx.idempotencyKey,
});

/**
 * Organizer forms a team from people still in the matchmaking pool (at the
 * cut-off). The first person picked is captain. Everyone must be teamless;
 * the pool trigger takes them out of the pool. Audited with the names' ids.
 */
export async function formTeamFromPool(staff: Staff, input: unknown) {
  if (staff.role !== "organizer" && staff.role !== "admin") throw new AppError("FORBIDDEN");
  const data = parse(formTeamSchema, input);
  const slug = slugify(data.name);
  if (!slug) throw new AppError("VALIDATION_FAILED", { userMessage: "Use letters or numbers in the team name." });
  const passwordHash = await hashPassword(randomBytes(24).toString("base64url"));
  const { result } = await idempotent(data.idempotency_key, `team.form_from_pool:staff:${staff.id ?? "admin"}`, () =>
    withAudit(staffActor(staff), "team.form_from_pool", "team", async (tx) => {
      const { rows: people } = await tx.query<{ id: number; name: string }>(
        "select id, name from members where id = any($1::bigint[]) and deleted_at is null order by array_position($1::bigint[], id) for update",
        [data.member_ids],
      );
      if (people.length !== data.member_ids.length) throw new AppError("NOT_FOUND", { userMessage: "One of those people no longer exists." });
      const { rows: busy } = await tx.query<{ name: string }>(
        "select m.name from team_memberships tm join members m on m.id = tm.member_id where tm.member_id = any($1::bigint[]) and tm.left_at is null",
        [data.member_ids],
      );
      if (busy.length) throw new AppError("CONFLICT", { userMessage: `Already on a team: ${busy.map((b) => b.name).join(", ")}. Reload the pool.` });
      const { rows: taken } = await tx.query("select 1 from teams where slug = $1 union all select 1 from projects where slug = $1 union all select 1 from project_slug_redirects where old_slug = $1", [slug]);
      if (taken.length) throw new AppError("CONFLICT", { userMessage: "That team name is taken. Try another." });
      const captain = people[0].id;
      const { rows } = await tx.query<{ id: number; now: Date }>(
        `insert into teams (slug, name, track, idea, is_solo, password_hash, captain_id, state, max_size, recruiting_open)
         values ($1, $2, $3, '', false, $4, $5, 'formed', $6, false) returning id, now() as now`,
        [slug, data.name, data.track, passwordHash, captain, TEAM_SIZE_CAP],
      );
      const team = rows[0];
      for (const p of people) {
        await tx.query("insert into team_memberships (team_id, member_id, role, approved_by) values ($1, $2, $3, $4)", [team.id, p.id, p.id === captain ? "captain" : "member", staff.id]);
        await tx.query("update members set team_id = $2 where id = $1", [p.id, team.id]);
      }
      await tx.query("insert into projects (team_id, name, slug) values ($1, $2, $3)", [team.id, data.name, slug]);
      await tx.query("insert into ideas (team_id, title) values ($1, $2) on conflict (team_id) do nothing", [team.id, data.name.slice(0, 120)]);
      await tx.query("update projects p set idea_id = i.id from ideas i where i.team_id = p.team_id and p.team_id = $1", [team.id]);
      await tx.query("insert into activity (team_id, action) values ($1, 'Team formed by an organizer from the matchmaking pool')", [team.id]);
      return {
        result: { teamId: team.id, slug, name: data.name, members: people.map((p) => p.name), receipt: receiptOf(`T-${team.id}`, team.now) },
        resourceId: team.id,
        reason: data.reason,
        after: { slug, name: data.name, track: data.track, member_ids: data.member_ids, captain_id: captain },
      };
    }),
  );
  return result;
}

// ── Internals ────────────────────────────────────────────────────────────────

type LockedTeam = Pick<TeamInfo, "id" | "slug" | "name" | "state" | "captain_id" | "cap" | "max_size" | "member_count" | "locked" | "recruiting_open" | "summary_public" | "table_label">;

/** select … for update on the team row, so size and lock checks hold until commit. */
async function lockTeam(tx: PoolClient, teamId: number): Promise<LockedTeam> {
  const { rows } = await tx.query<{ id: number }>("select id from teams where id = $1 for update", [teamId]);
  if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "Team not found." });
  const { rows: info } = await tx.query<LockedTeam>(
    `select t.id, t.slug, t.name, t.state, t.captain_id, least(t.max_size, ${TEAM_SIZE_CAP})::int as cap, t.max_size,
            t.recruiting_open, t.summary_public, t.table_label, ${LOCKED_SQL} as locked,
            (select count(*)::int from team_memberships tm where tm.team_id = t.id and tm.left_at is null) as member_count
       from teams t where t.id = $1`,
    [teamId],
  );
  return info[0];
}

async function assertCurrentMember(tx: PoolClient, teamId: number, memberId: number) {
  const { rows } = await tx.query("select 1 from team_memberships where team_id = $1 and member_id = $2 and left_at is null", [teamId, memberId]);
  if (!rows[0]) throw new AppError("FORBIDDEN", { userMessage: "You're not on this team." });
}

function assertCaptain(team: LockedTeam, memberId: number) {
  if (team.captain_id !== memberId) throw new AppError("FORBIDDEN", { userMessage: "Only the team captain can do that." });
}

async function setCaptain(tx: PoolClient, teamId: number, memberId: number) {
  const { rows } = await tx.query("select 1 from team_memberships where team_id = $1 and member_id = $2 and left_at is null", [teamId, memberId]);
  if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "That person isn't on the team." });
  await tx.query("update team_memberships set role = case when member_id = $2 then 'captain' else 'member' end where team_id = $1 and left_at is null", [teamId, memberId]);
  await tx.query("update teams set captain_id = $2 where id = $1", [teamId, memberId]);
}

/** Close one membership and clear the pointer. Returns rows closed (0 or 1). */
async function closeMembership(tx: PoolClient, teamId: number, memberId: number, reason: string, staffId: number | null = null) {
  const { rowCount } = await tx.query(
    "update team_memberships set left_at = now(), left_reason = $3, approved_by = coalesce($4, approved_by) where team_id = $1 and member_id = $2 and left_at is null",
    [teamId, memberId, reason, staffId],
  );
  if (rowCount) {
    await tx.query("update members set team_id = null where id = $1 and team_id = $2", [memberId, teamId]);
    await afterDeparture(tx, teamId, memberId);
  }
  return rowCount ?? 0;
}

/**
 * Close the member's current membership (if any, and if it isn't `exceptTeamId`).
 * Refuses when that team is locked, or when they captain a team that still has people.
 * Returns the old team's name.
 */
async function leaveCurrentTeam(tx: PoolClient, memberId: number, exceptTeamId: number | null, reason: string, staffId: number | null = null) {
  const { rows } = await tx.query<{ team_id: number; role: string }>("select team_id, role from team_memberships where member_id = $1 and left_at is null for update", [memberId]);
  const cur = rows[0];
  if (!cur) return null;
  if (cur.team_id === exceptTeamId) throw new AppError("CONFLICT", { userMessage: "You're already on this team." });
  const old = await lockTeam(tx, cur.team_id);
  if (old.locked && staffId === null) throw new AppError("DEADLINE_PASSED", { userMessage: `Your current team (${old.name}) is locked. An organizer has to move you.` });
  if (cur.role === "captain" && old.member_count > 1 && staffId === null) {
    throw new AppError("CONFLICT", { userMessage: `You captain ${old.name}. Hand the captaincy to a teammate before you leave.` });
  }
  await closeMembership(tx, cur.team_id, memberId, reason, staffId);
  return old.name;
}

/** After someone leaves: hand the captaincy on, or retire an empty team (its slug stays reserved). */
async function afterDeparture(tx: PoolClient, teamId: number, memberId: number) {
  const { rows } = await tx.query<{ member_id: number }>(
    "select member_id from team_memberships where team_id = $1 and left_at is null order by joined_at limit 1",
    [teamId],
  );
  if (!rows[0]) {
    await tx.query("update teams set state = 'withdrawn', recruiting_open = false, captain_id = null where id = $1 and state not in ('submitted')", [teamId]);
    return;
  }
  await tx.query(
    `update teams set captain_id = $2 where id = $1 and (captain_id is null or captain_id = $3)`,
    [teamId, rows[0].member_id, memberId],
  );
  await tx.query("update team_memberships set role = 'captain' where team_id = $1 and member_id = (select captain_id from teams where id = $1) and left_at is null", [teamId]);
}

async function txNow(tx: PoolClient) {
  const { rows } = await tx.query<{ now: Date }>("select now() as now");
  return rows[0].now;
}

/** "React, ci , Agents" or ["react","CI"] → ["react","ci","agents"] (deduped, max 12, 32 chars each). */
export function normalizeTags(v: string | string[] | undefined | null): string[] {
  const list = (Array.isArray(v) ? v : (v ?? "").split(/[,\n]/)).map((s) => s.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60)).filter(Boolean);
  return [...new Set(list)].slice(0, 12);
}

/** What anyone signed in may read about a team that isn't theirs. */
export function publicTeamInfo(t: TeamInfo): PublicTeamInfo {
  return { id: t.id, slug: t.slug, name: t.name, track: trackLabel(t.track), member_count: t.member_count, cap: t.cap, locked: t.locked, recruiting_open: t.recruiting_open, summary_public: t.summary_public };
}

export type PublicTeamInfo = Pick<TeamInfo, "id" | "slug" | "name" | "track" | "member_count" | "cap" | "locked" | "recruiting_open" | "summary_public">;
