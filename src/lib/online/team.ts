import "server-only";
import { randomInt } from "node:crypto";
import { onlineEvent } from "@/data/online";
import { slugify } from "@/lib/slug";
import { onlineQuery } from "./db";
import { getOnlineSession } from "./session";

export const MAX_TEAM = 4;

export type Me = { id: number; name: string; email: string; teamId: number | null };
export type Team = { id: number; name: string; slug: string; inviteCode: string; solo: boolean; captainId: number | null; hidden: boolean };
export type Member = { id: number; name: string; email: string; x_url: string | null; linkedin_url: string | null };

/** The signed-in participant, or null. */
export async function getMe(): Promise<Me | null> {
  const pid = await getOnlineSession();
  if (pid === null) return null;
  const [row] = await onlineQuery<{ id: number; name: string; email: string; team_id: number | null }>(
    `select id, name, email, team_id from online_participants where id = $1`,
    [pid],
  );
  return row ? { id: row.id, name: row.name, email: row.email, teamId: row.team_id } : null;
}

const TEAM_COLS = `id, name, slug, invite_code as "inviteCode", solo, captain_id as "captainId", hidden`;

export async function getTeam(id: number) {
  const [t] = await onlineQuery<Team>(`select ${TEAM_COLS} from online_teams where id = $1`, [id]);
  return t ?? null;
}

export async function getTeamBySlug(slug: string) {
  const [t] = await onlineQuery<Team>(`select ${TEAM_COLS} from online_teams where slug = $1`, [slug]);
  return t ?? null;
}

/** Members, captain first. Emails are for the team and organisers only: never render them publicly. */
export function getMembers(teamId: number) {
  return onlineQuery<Member>(
    `select p.id, p.name, p.email, p.x_url, p.linkedin_url from online_participants p join online_teams t on t.id = p.team_id
      where p.team_id = $1 order by (p.id = t.captain_id) desc, p.id`,
    [teamId],
  );
}

/**
 * The roster (who is on the team, its name and address) freezes once the team
 * submits, or at the deadline. Until then the captain can change it freely.
 */
export async function rosterLocked(teamId: number) {
  if (new Date() >= new Date(onlineEvent.submissionDeadline)) return "The deadline has passed, so teams can't change any more.";
  const [s] = await onlineQuery(`select 1 from online_submissions where team_id = $1 and status = 'submitted'`, [teamId]);
  return s ? "This team has submitted, so its roster is locked." : null;
}

// No 0/O/1/I, so a code read aloud or typed from a screenshot still works.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => `KANE-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

async function freeSlug(name: string, exceptTeamId = 0) {
  const base = slugify(name) || "team";
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [taken] = await onlineQuery(`select 1 from online_teams where slug = $1 and id <> $2`, [slug, exceptTeamId]);
    if (!taken) return slug;
  }
  return `${base}-${randomInt(1e6)}`;
}

/**
 * Creates a team with this person as captain. A solo builder gets a team of
 * one named after them: no name to invent, and their code still works if a
 * teammate turns up later.
 */
export async function createTeam(me: Me, name: string | null): Promise<Team> {
  const solo = name === null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const [t] = await onlineQuery<Team>(
      `insert into online_teams (name, slug, invite_code, solo, captain_id) values ($1, $2, $3, $4, $5)
       on conflict do nothing returning ${TEAM_COLS}`,
      [name ?? me.name, await freeSlug(name ?? me.name), newCode(), solo, me.id],
    );
    if (t) {
      await onlineQuery(`update online_participants set team_id = $1 where id = $2`, [t.id, me.id]);
      return t;
    }
  }
  throw new Error("Could not reserve a page address for that name");
}

/** Joins by the captain's code. A solo captain's team becomes a real team when someone joins. */
export async function joinTeam(me: Me, code: string): Promise<{ error: string } | { team: Team }> {
  const [t] = await onlineQuery<Team>(`select ${TEAM_COLS} from online_teams where invite_code = $1`, [code.trim().toUpperCase()]);
  if (!t) return { error: "That code doesn't match a team. Check it with your team captain." };
  const locked = await rosterLocked(t.id);
  if (locked) return { error: locked };
  // The count and the join in one statement, so two people can't both take the last seat.
  const joined = await onlineQuery(
    `update online_participants set team_id = $1
      where id = $2 and (select count(*) from online_participants where team_id = $1) < $3 returning id`,
    [t.id, me.id, MAX_TEAM],
  );
  if (!joined.length) return { error: `That team is full (${MAX_TEAM} people max).` };
  if (t.solo) await onlineQuery(`update online_teams set solo = false where id = $1`, [t.id]);
  return { team: { ...t, solo: false } };
}

/** Captain only: a new name, and with it a new page address. */
export async function renameTeam(me: Me, name: string): Promise<string | null> {
  const team = me.teamId === null ? null : await getTeam(me.teamId);
  if (!team || team.captainId !== me.id) return "Only the team captain can rename the team.";
  const locked = await rosterLocked(team.id);
  if (locked) return locked;
  await onlineQuery(`update online_teams set name = $1, slug = $2 where id = $3`, [name, await freeSlug(name, team.id), team.id]);
  return null;
}

/** Captain only: take someone off the team. */
export async function removeMember(me: Me, memberId: number): Promise<string | null> {
  const team = me.teamId === null ? null : await getTeam(me.teamId);
  if (!team || team.captainId !== me.id) return "Only the team captain can remove people.";
  if (memberId === me.id) return "To leave your own team, use Leave team.";
  const locked = await rosterLocked(team.id);
  if (locked) return locked;
  await onlineQuery(`update online_participants set team_id = null where id = $1 and team_id = $2`, [memberId, team.id]);
  await settle(team.id);
  return null;
}

/** Anyone: leave. The next member becomes captain; an empty team is deleted. */
export async function leaveTeam(me: Me): Promise<string | null> {
  if (me.teamId === null) return null;
  const locked = await rosterLocked(me.teamId);
  if (locked) return locked;
  await onlineQuery(`update online_participants set team_id = null where id = $1`, [me.id]);
  await settle(me.teamId);
  return null;
}

/** After someone goes: pick a captain if needed, mark a team of one as solo, drop an empty team. */
async function settle(teamId: number) {
  const left = await onlineQuery<{ id: number }>(`select id from online_participants where team_id = $1 order by id`, [teamId]);
  if (!left.length) {
    await onlineQuery(`delete from online_teams where id = $1`, [teamId]);
    return;
  }
  await onlineQuery(
    `update online_teams set captain_id = case when captain_id = any($2::bigint[]) then captain_id else $3 end, solo = $4 where id = $1`,
    [teamId, left.map((m) => m.id), left[0].id, left.length === 1],
  );
}
