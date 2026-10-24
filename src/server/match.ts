import "server-only";
import { query } from "@/lib/db";
import { AppError, parse, withAudit, z, zx, type Receipt } from "./core";
import { notifyMembers, notifyTeam } from "./member-notifications";
import { TEAM_SIZE_CAP, currentTeamOf, listRecruitingTeams, normalizeTags, receiptOf, type ActingMember } from "./teams";
import { trackLabel } from "@/data/hackday";

// Matchmaker (SPEC §4). People opt in to being discoverable; suggestions rank
// complementary skills and shared interests, each with a plain-words reason.
// Nothing is assigned. A request for an intro is just a request: contact
// details (handles, never email or phone) appear in-app only after the other
// side accepts. Aggregates for the TV are counts only.

export const WORK_ROLES = ["frontend", "backend", "agents", "infra-ci", "qa-testing", "mobile", "design", "product", "any"] as const;
export const AVAILABILITY = ["all-day", "morning", "afternoon", "flexible"] as const;

export type Profile = {
  member_id: number;
  discoverable: boolean;
  skills: string[];
  interests: string[];
  preferred_work: string | null;
  availability: string | null;
  learning_goals: string | null;
  bio: string | null;
  updated_at: Date | null;
};

export const profileSchema = z.object({
  discoverable: zx.checkbox.default(false),
  skills: z.union([z.string(), z.array(z.string())]).optional().transform((v) => normalizeTags(v)),
  interests: z.union([z.string(), z.array(z.string())]).optional().transform((v) => normalizeTags(v)),
  preferred_work: z.enum(WORK_ROLES).optional().or(z.literal("").transform(() => undefined)),
  availability: z.enum(AVAILABILITY).optional().or(z.literal("").transform(() => undefined)),
  learning_goals: zx.optText(280),
  bio: zx.optText(280),
  source: z.enum(["web", "mcp"]).default("web"),
});

export async function getProfile(memberId: number): Promise<Profile> {
  const [p] = await query<Profile>(
    `select p.member_id, p.discoverable and coalesce(c.granted, false) as discoverable, p.skills, p.interests,
            p.preferred_work, p.availability, p.learning_goals, p.bio, p.updated_at
       from teammate_profiles p
       left join member_consent_current c on c.member_id = p.member_id and c.category = 'teammate_discovery'
      where p.member_id = $1`,
    [memberId],
  );
  return p ?? { member_id: memberId, discoverable: false, skills: [], interests: [], preferred_work: null, availability: null, learning_goals: null, bio: null, updated_at: null };
}

/**
 * Save the member's own profile. Discoverability is that person's consent
 * (teammate_discovery), appended to member_consents whenever it changes.
 */
export async function upsertProfile(who: ActingMember, input: unknown): Promise<{ profile: Profile; receipt: Receipt }> {
  const data = parse(profileSchema, input);
  const before = await getProfile(who.member.id);
  return withAudit(who.actor, "match.profile", "teammate_profile", async (tx) => {
    const { rows } = await tx.query<{ now: Date }>(
      `insert into teammate_profiles (member_id, discoverable, skills, interests, preferred_work, availability, learning_goals, bio, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (member_id) do update set discoverable = excluded.discoverable, skills = excluded.skills, interests = excluded.interests,
         preferred_work = excluded.preferred_work, availability = excluded.availability, learning_goals = excluded.learning_goals,
         bio = excluded.bio, updated_at = now()
       returning now() as now`,
      [who.member.id, data.discoverable, data.skills, data.interests, data.preferred_work ?? null, data.availability ?? null, data.learning_goals, data.bio],
    );
    if (before.discoverable !== data.discoverable) {
      await tx.query("insert into member_consents (member_id, category, granted, source) values ($1, 'teammate_discovery', $2, $3)", [who.member.id, data.discoverable, data.source]);
    }
    // Kept in step for other readers (passport, judges see skills); the profile row is the source.
    await tx.query("update members set skills = $2, interests = $3 where id = $1", [who.member.id, data.skills, data.interests]);
    const profile: Profile = { member_id: who.member.id, ...data, preferred_work: data.preferred_work ?? null, availability: data.availability ?? null, updated_at: rows[0].now };
    return { result: { profile, receipt: receiptOf(`MP-${who.member.id}`, rows[0].now) }, resourceId: who.member.id, before: { discoverable: before.discoverable }, after: { discoverable: data.discoverable } };
  });
}

// ── Suggestions (T-MATCH-02) ─────────────────────────────────────────────────

export type PersonCard = {
  kind: "person";
  member_id: number;
  name: string;
  skills: string[];
  interests: string[];
  preferred_work: string | null;
  availability: string | null;
  learning_goals: string | null;
  bio: string | null;
  score: number;
  explanation: string;
  intro: IntroState | null;
};

export type TeamCard = {
  kind: "team";
  team_id: number;
  slug: string;
  name: string;
  track: string;
  summary_public: string | null;
  seeking_skills: string[];
  member_skills: string[];
  open_seats: number;
  table_label: string | null;
  score: number;
  explanation: string;
  intro: IntroState | null;
};

type IntroState = "proposed" | "accepted" | "declined" | "withdrawn" | "expired";

export const suggestionFilterSchema = z.object({
  skill: z.string().trim().toLowerCase().max(32).optional().transform((s) => s || null),
  role: z.enum(WORK_ROLES).optional().or(z.literal("").transform(() => undefined)),
  availability: z.enum(AVAILABILITY).optional().or(z.literal("").transform(() => undefined)),
  show: z.enum(["all", "people", "teams"]).default("all"),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});

type Candidate = Omit<Profile, "discoverable" | "updated_at"> & { name: string };

/** Ranked people and teams for this member. Only opted-in people and open, recruiting teams appear. */
export async function suggestions(who: ActingMember, filters: unknown = {}) {
  const f = parse(suggestionFilterSchema, filters);
  const me = await getProfile(who.member.id);
  const myTeam = await currentTeamOf(who.member.id);

  // What my side already has: my skills plus my teammates' (from their profiles), and what we're seeking.
  const teamSkills = new Set(me.skills);
  let seeking: string[] = [];
  if (myTeam) {
    const rows = await query<{ skills: string[]; seeking: string[] | null }>(
      `select coalesce(p.skills, '{}') as skills, (select r.seeking_skills from team_recruiting r where r.team_id = $1) as seeking
         from team_memberships tm left join teammate_profiles p on p.member_id = tm.member_id
        where tm.team_id = $1 and tm.left_at is null`,
      [myTeam.team_id],
    );
    rows.forEach((r) => r.skills.forEach((s) => teamSkills.add(s)));
    seeking = rows[0]?.seeking ?? [];
  }
  const intros = await introStates(who.member.id, myTeam?.team_id ?? null);

  let people: PersonCard[] = [];
  if (f.show !== "teams") {
    const rows = await query<Candidate>(
      `select p.member_id, coalesce(m.display_name, m.name) as name, p.skills, p.interests, p.preferred_work, p.availability, p.learning_goals, p.bio
         from teammate_profiles p
         join members m on m.id = p.member_id and m.deleted_at is null
         join member_consent_current c on c.member_id = p.member_id and c.category = 'teammate_discovery' and c.granted
        where p.discoverable and p.member_id <> $1
          and not exists (select 1 from team_memberships tm where tm.member_id = p.member_id and tm.left_at is null)
        order by p.updated_at desc
        limit 300`,
      [who.member.id],
    );
    people = rows
      .filter((c) => (!f.skill || c.skills.some((s) => s.includes(f.skill!))) && (!f.role || c.preferred_work === f.role) && (!f.availability || c.availability === f.availability || c.availability === "flexible"))
      .map((c) => scorePerson(c, me, teamSkills, seeking, intros.people.get(c.member_id) ?? null));
  }

  let teams: TeamCard[] = [];
  // Someone already on a full or locked team isn't shopping for another; show teams to people without one, or solo.
  if (f.show !== "people") {
    const open = await listRecruitingTeams({ excludeTeamId: myTeam?.team_id ?? null, skill: f.skill, limit: 100 });
    const memberSkills = await teamMemberTags(open.map((t) => t.id));
    teams = open.map((t) =>
      scoreTeam(
        {
          kind: "team",
          team_id: t.id,
          slug: t.slug,
          name: t.name,
          track: trackLabel(t.track),
          summary_public: t.summary_public,
          seeking_skills: t.seeking_skills,
          member_skills: memberSkills.get(t.id)?.skills ?? [],
          open_seats: Math.max(0, t.cap - t.member_count),
          table_label: t.table_label,
          score: 0,
          explanation: "",
          intro: intros.teams.get(t.id) ?? null,
        },
        me,
        memberSkills.get(t.id)?.interests ?? [],
      ),
    );
  }

  const byScore = <T extends { score: number }>(a: T, b: T) => b.score - a.score;
  return {
    me,
    myTeam,
    people: people.sort(byScore).slice(0, f.limit),
    teams: teams.sort(byScore).slice(0, f.limit),
  };
}

function scorePerson(c: Candidate, me: Profile, teamSkills: Set<string>, seeking: string[], intro: IntroState | null): PersonCard {
  const wanted = c.skills.filter((s) => seeking.includes(s));
  const brings = c.skills.filter((s) => !teamSkills.has(s) && !wanted.includes(s));
  const shared = c.interests.filter((i) => me.interests.includes(i));
  const sameTime = !!me.availability && !!c.availability && (me.availability === c.availability || c.availability === "flexible" || me.availability === "flexible");
  const learn = c.learning_goals && me.skills.some((s) => c.learning_goals!.toLowerCase().includes(s));
  const score = wanted.length * 3 + Math.min(brings.length, 4) * 2 + shared.length * 1.5 + (sameTime ? 1 : 0) + (learn ? 1 : 0);
  const why: string[] = [];
  if (wanted.length) why.push(`Has ${list(wanted)}, which your team is looking for`);
  if (brings.length) why.push(`Brings ${list(brings.slice(0, 3))} you don't have yet`);
  if (shared.length) why.push(`Also into ${list(shared.slice(0, 3))}`);
  if (learn) why.push("Wants to learn something you know");
  if (sameTime) why.push(`Available ${c.availability!.replace("-", " ")}`);
  if (!why.length) why.push(me.skills.length ? "Opted in and looking for a team" : "Opted in and looking. Add your skills for better matches");
  return { kind: "person", ...c, score, explanation: why.join(" · "), intro };
}

function scoreTeam(t: TeamCard, me: Profile, teamInterests: string[]): TeamCard {
  const wanted = me.skills.filter((s) => t.seeking_skills.includes(s));
  const brings = me.skills.filter((s) => !t.member_skills.includes(s) && !wanted.includes(s));
  const shared = me.interests.filter((i) => teamInterests.includes(i));
  const score = wanted.length * 3 + Math.min(brings.length, 4) * 1.5 + shared.length * 1.5 + Math.min(t.open_seats, 3) * 0.25;
  const why: string[] = [];
  if (wanted.length) why.push(`Looking for ${list(wanted)}, which you have`);
  if (brings.length) why.push(`You'd add ${list(brings.slice(0, 3))}`);
  if (shared.length) why.push(`Shares your interest in ${list(shared.slice(0, 3))}`);
  why.push(`${t.open_seats} open ${t.open_seats === 1 ? "seat" : "seats"}`);
  return { ...t, score, explanation: why.join(" · ") };
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

async function teamMemberTags(teamIds: number[]) {
  const out = new Map<number, { skills: string[]; interests: string[] }>();
  if (!teamIds.length) return out;
  const rows = await query<{ team_id: number; skills: string[]; interests: string[] }>(
    `select tm.team_id,
            coalesce(array_agg(distinct s) filter (where s is not null), '{}') as skills,
            coalesce(array_agg(distinct i) filter (where i is not null), '{}') as interests
       from team_memberships tm
       left join teammate_profiles p on p.member_id = tm.member_id
       left join lateral unnest(p.skills) s on true
       left join lateral unnest(p.interests) i on true
      where tm.team_id = any($1::bigint[]) and tm.left_at is null
      group by tm.team_id`,
    [teamIds],
  );
  rows.forEach((r) => out.set(r.team_id, { skills: r.skills, interests: r.interests }));
  return out;
}

// ── Introductions (T-MATCH-03) ───────────────────────────────────────────────

async function introStates(memberId: number, teamId: number | null) {
  const rows = await query<{ target_member_id: number | null; target_team_id: number | null; status: IntroState }>(
    `select distinct on (coalesce(target_member_id, 0), coalesce(target_team_id, 0)) target_member_id, target_team_id, status
       from teammate_introductions where requester_id = $1
      order by coalesce(target_member_id, 0), coalesce(target_team_id, 0), created_at desc`,
    [memberId],
  );
  const people = new Map<number, IntroState>();
  const teams = new Map<number, IntroState>();
  for (const r of rows) {
    if (r.target_member_id) people.set(r.target_member_id, r.status);
    else if (r.target_team_id && r.target_team_id !== teamId) teams.set(r.target_team_id, r.status);
  }
  return { people, teams };
}

export const introRequestSchema = z
  .object({
    target_member_id: zx.id.optional(),
    target_team_id: zx.id.optional(),
    /** "collaborate" comes from the Idea Radar: a team with an opted-in idea, not necessarily recruiting. */
    kind: z.enum(["intro", "collaborate"]).default("intro"),
    message: zx.optText(280),
  })
  .refine((v) => !!v.target_member_id !== !!v.target_team_id, "Pick one person or one team.");

const MAX_OPEN_REQUESTS = 15;

export async function requestIntro(who: ActingMember, input: unknown): Promise<Receipt> {
  const data = parse(introRequestSchema, input);
  const myTeam = await currentTeamOf(who.member.id);
  if (data.target_member_id === who.member.id || (data.target_team_id && data.target_team_id === myTeam?.team_id)) {
    throw new AppError("VALIDATION_FAILED", { userMessage: "That's you." });
  }
  return withAudit(who.actor, "match.intro_request", "teammate_introduction", async (tx) => {
    const { rows: open } = await tx.query<{ n: number }>("select count(*)::int as n from teammate_introductions where requester_id = $1 and status = 'proposed'", [who.member.id]);
    if (open[0].n >= MAX_OPEN_REQUESTS) throw new AppError("RATE_LIMITED", { userMessage: `You have ${open[0].n} open requests. Wait for answers or withdraw some.` });

    if (data.target_member_id) {
      const { rows } = await tx.query(
        `select 1 from teammate_profiles p join member_consent_current c on c.member_id = p.member_id and c.category = 'teammate_discovery' and c.granted
          where p.member_id = $1 and p.discoverable`,
        [data.target_member_id],
      );
      if (!rows[0]) throw new AppError("PRIVACY_RESTRICTED", { userMessage: "That person isn't taking intro requests." });
    } else if (data.kind === "collaborate") {
      const { rows } = await tx.query("select 1 from ideas where team_id = $1 and discovery_opt_in and public_summary is not null", [data.target_team_id]);
      if (!rows[0]) throw new AppError("PRIVACY_RESTRICTED", { userMessage: "That team hasn't shared its idea." });
    } else {
      const { rows } = await tx.query("select 1 from teams where id = $1 and recruiting_open and state not in ('roster_locked','submitted','withdrawn')", [data.target_team_id]);
      if (!rows[0]) throw new AppError("CONFLICT", { userMessage: "That team isn't recruiting right now." });
    }
    const message = data.kind === "collaborate" ? `[Collaboration] ${data.message ?? ""}`.trim() : data.message;
    const { rows } = await tx.query<{ id: number; now: Date }>(
      `insert into teammate_introductions (requester_id, target_member_id, target_team_id, message)
       values ($1, $2, $3, $4) returning id, now() as now`,
      [who.member.id, data.target_member_id ?? null, data.target_team_id ?? null, message],
    );
    const from = who.member.display_name ?? who.member.name;
    const note = data.message?.trim() ? `“${data.message.trim()}”` : "";
    if (data.target_member_id) {
      await notifyMembers(tx, [data.target_member_id], { kind: "intro_request", title: `${from} wants to team up with you`, body: note, href: "/match" });
    } else if (data.target_team_id) {
      await notifyTeam(
        tx,
        data.target_team_id,
        data.kind === "collaborate"
          ? { kind: "collab_request", title: `${from} wants to collaborate with your team`, body: note, href: "/team" }
          : { kind: "join_request", title: `${from} asked to join your team`, body: note || "Accept from your Team page and they join straight away.", href: "/team" },
        who.member.id,
      );
    }
    return { result: receiptOf(`IN-${rows[0].id}`, rows[0].now), resourceId: rows[0].id, payload: { kind: data.kind } };
  });
}

/**
 * A team member invites someone from the matchmaking pool to their team. The
 * person sees "<team> invites you" on /match; accepting puts them on the team
 * (flow.answerIntro) if a seat is still free.
 */
export async function inviteToTeam(who: ActingMember, targetMemberId: number, message: string | null): Promise<Receipt> {
  const myTeam = await currentTeamOf(who.member.id);
  if (!myTeam) throw new AppError("CONFLICT", { userMessage: "Create or join a team first." });
  if (targetMemberId === who.member.id) throw new AppError("VALIDATION_FAILED", { userMessage: "That's you." });
  const text = message?.trim().slice(0, 280) || null;
  return withAudit(who.actor, "match.team_invite", "teammate_introduction", async (tx) => {
    const { rows: team } = await tx.query<{ ok: boolean; name: string }>(
      `select t.name, (t.state not in ('roster_locked','submitted','withdrawn') and t.roster_locked_at is null
               and (select count(*) from team_memberships tm where tm.team_id = t.id and tm.left_at is null) < least(t.max_size, ${TEAM_SIZE_CAP})) as ok
         from teams t where t.id = $1`,
      [myTeam.team_id],
    );
    if (!team[0]?.ok) throw new AppError("CONFLICT", { userMessage: "Your team is full or its roster is locked." });
    const { rows: target } = await tx.query(
      `select 1 from members m
         join teammate_profiles p on p.member_id = m.id and p.discoverable
         join member_consent_current c on c.member_id = m.id and c.category = 'teammate_discovery' and c.granted
        where m.id = $1 and m.looking_for_team and m.deleted_at is null
          and not exists (select 1 from team_memberships tm where tm.member_id = m.id and tm.left_at is null)`,
      [targetMemberId],
    );
    if (!target[0]) throw new AppError("CONFLICT", { userMessage: "They’ve found a team or left matchmaking." });
    const { rows: open } = await tx.query<{ n: number }>("select count(*)::int as n from teammate_introductions where requester_id = $1 and status = 'proposed'", [who.member.id]);
    if (open[0].n >= MAX_OPEN_REQUESTS) throw new AppError("RATE_LIMITED", { userMessage: `You have ${open[0].n} invites waiting. Wait for answers or withdraw some.` });
    const { rows } = await tx.query<{ id: number; now: Date }>(
      `insert into teammate_introductions (requester_id, target_member_id, from_team_id, message)
       values ($1, $2, $3, $4) returning id, now() as now`,
      [who.member.id, targetMemberId, myTeam.team_id, text],
    );
    await notifyMembers(tx, [targetMemberId], {
      kind: "team_invite",
      title: `${team[0].name} invited you to join their team`,
      body: text ? `“${text}” · from ${who.member.display_name ?? who.member.name}` : `From ${who.member.display_name ?? who.member.name}. Accept on your matchmaking page.`,
      href: "/match",
    });
    return { result: receiptOf(`IN-${rows[0].id}`, rows[0].now), resourceId: rows[0].id, payload: { team_id: myTeam.team_id } };
  });
}

/** The person asked (or any current member of the team asked) accepts or declines. */
export async function respondIntro(who: ActingMember, introId: number, accept: boolean): Promise<Receipt> {
  const myTeam = await currentTeamOf(who.member.id);
  return withAudit(who.actor, accept ? "match.intro_accept" : "match.intro_decline", "teammate_introduction", async (tx) => {
    const { rows } = await tx.query<{ id: number; now: Date }>(
      `update teammate_introductions set status = $2, responded_at = now()
        where id = $1 and status = 'proposed' and (target_member_id = $3 or (target_team_id is not null and target_team_id = $4))
        returning id, now() as now`,
      [introId, accept ? "accepted" : "declined", who.member.id, myTeam?.team_id ?? null],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "That request is gone or already answered." });
    const { rows: info } = await tx.query<{ requester_id: number; target_team: string | null; from_team: string | null }>(
      `select i.requester_id, tt.name as target_team, ft.name as from_team from teammate_introductions i
         left join teams tt on tt.id = i.target_team_id left join teams ft on ft.id = i.from_team_id where i.id = $1`,
      [introId],
    );
    const me = who.member.display_name ?? who.member.name;
    const i = info[0];
    if (i) {
      const n = i.from_team
        ? accept
          ? { kind: "invite_accepted", title: `${me} accepted your invite and joined ${i.from_team}`, href: "/team" }
          : { kind: "invite_declined", title: `${me} declined the invite to ${i.from_team}`, href: "/team" }
        : i.target_team
          ? accept
            ? { kind: "join_accepted", title: `You’re in! ${i.target_team} accepted your request`, body: "Next: activate your tools.", href: "/activate" }
            : { kind: "join_declined", title: `${i.target_team} said no this time`, body: "Other teams still have open seats.", href: "/match" }
          : accept
            ? { kind: "intro_accepted", title: `${me} said yes to teaming up`, body: "Find each other; one of you creates the team and invites the other.", href: "/match" }
            : { kind: "intro_declined", title: `${me} passed on teaming up`, href: "/match" };
      await notifyMembers(tx, [i.requester_id], n);
    }
    return { result: receiptOf(`IN-${introId}`, rows[0].now), resourceId: introId };
  });
}

export async function withdrawIntro(who: ActingMember, introId: number): Promise<Receipt> {
  return withAudit(who.actor, "match.intro_withdraw", "teammate_introduction", async (tx) => {
    const { rows } = await tx.query<{ now: Date }>(
      "update teammate_introductions set status = 'withdrawn', responded_at = now() where id = $1 and requester_id = $2 and status = 'proposed' returning now() as now",
      [introId, who.member.id],
    );
    if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "That request is gone or already answered." });
    return { result: receiptOf(`IN-${introId}`, rows[0].now), resourceId: introId };
  });
}

/** Revealed only after acceptance, and only in-app: handles people chose to give us. Never email or phone. */
export type Contact = { name: string; team: string | null; table: string | null; github: string | null; linkedin: string | null; x: string | null };

export type IntroRow = {
  id: number;
  direction: "incoming" | "outgoing";
  status: IntroState;
  message: string | null;
  created_at: Date;
  /** Who it's from (incoming) or to (outgoing). */
  other: string;
  via_team: string | null;
  /** Set when a team member invited this person to their team. */
  from_team: string | null;
  contact: Contact | null;
};

export async function listIntros(memberId: number): Promise<IntroRow[]> {
  const myTeam = await currentTeamOf(memberId);
  const rows = await query<{
    id: number;
    requester_id: number;
    target_member_id: number | null;
    target_team_id: number | null;
    status: IntroState;
    message: string | null;
    created_at: Date;
    requester_name: string;
    target_name: string | null;
    target_team: string | null;
    from_team: string | null;
  }>(
    `select i.id, i.requester_id, i.target_member_id, i.target_team_id, i.status, i.message, i.created_at, ft.name as from_team,
            coalesce(r.display_name, r.name) as requester_name,
            coalesce(tm.display_name, tm.name) as target_name, tt.name as target_team
       from teammate_introductions i
       join members r on r.id = i.requester_id
       left join members tm on tm.id = i.target_member_id
       left join teams tt on tt.id = i.target_team_id
       left join teams ft on ft.id = i.from_team_id
      where i.requester_id = $1 or i.target_member_id = $1 or (i.target_team_id is not null and i.target_team_id = $2)
      order by i.created_at desc
      limit 100`,
    [memberId, myTeam?.team_id ?? null],
  );
  const out: IntroRow[] = [];
  for (const r of rows) {
    const outgoing = r.requester_id === memberId;
    let contact: Contact | null = null;
    if (r.status === "accepted") {
      // Outgoing: show the person I asked, or the captain of the team I asked. Incoming: the requester.
      const otherId = outgoing ? (r.target_member_id ?? (await captainOf(r.target_team_id))) : r.requester_id;
      contact = otherId ? await contactOf(otherId) : null;
    }
    out.push({
      id: r.id,
      direction: outgoing ? "outgoing" : "incoming",
      status: r.status,
      message: r.message,
      created_at: r.created_at,
      other: outgoing ? (r.target_name ?? r.target_team ?? "—") : r.requester_name,
      via_team: !outgoing && r.target_team_id ? r.target_team : null,
      from_team: r.from_team,
      contact,
    });
  }
  return out;
}

async function captainOf(teamId: number | null) {
  if (!teamId) return null;
  const [t] = await query<{ captain_id: number | null }>("select captain_id from teams where id = $1", [teamId]);
  return t?.captain_id ?? null;
}

async function contactOf(memberId: number): Promise<Contact | null> {
  const [c] = await query<Contact>(
    `select coalesce(m.display_name, m.name) as name, t.name as team, t.table_label as table,
            m.github_handle as github, m.linkedin, m.x_handle as x
       from members m left join teams t on t.id = m.team_id
      where m.id = $1 and m.deleted_at is null`,
    [memberId],
  );
  return c ?? null;
}

// ── Aggregates for the TV / live (T-MATCH-04) ────────────────────────────────

export type MatchAggregates = {
  /** Opted-in people with no current team. */
  looking: number;
  /** Free seats across open, recruiting, unlocked teams. */
  open_seats: number;
  recruiting_teams: number;
  as_of: Date;
};

/** Counts only: no names, no contact, no idea text. Live (area live) renders these with a FreshnessStamp. */
export async function matchAggregates(): Promise<MatchAggregates> {
  const [row] = await query<MatchAggregates>(
    `select
       (select count(*)::int from teammate_profiles p
          join members m on m.id = p.member_id and m.deleted_at is null
          join member_consent_current c on c.member_id = p.member_id and c.category = 'teammate_discovery' and c.granted
         where p.discoverable and not exists (select 1 from team_memberships tm where tm.member_id = p.member_id and tm.left_at is null)) as looking,
       coalesce((select sum(greatest(0, least(t.max_size, ${TEAM_SIZE_CAP}) - (select count(*) from team_memberships tm where tm.team_id = t.id and tm.left_at is null)))::int
          from teams t join hack_events e on e.id = coalesce(t.event_id, current_event_id())
         where t.recruiting_open and t.state in ('recruiting','formed','active') and (t.roster_locked_at is not null or now() < e.team_lock_at)), 0) as open_seats,
       (select count(*)::int from teams t join hack_events e on e.id = coalesce(t.event_id, current_event_id())
         where t.recruiting_open and t.state in ('recruiting','formed','active') and (t.roster_locked_at is not null or now() < e.team_lock_at)) as recruiting_teams,
       now() as as_of`,
  );
  return row;
}
