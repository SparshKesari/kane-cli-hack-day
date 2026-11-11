import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { onlineQuery } from "./db";

// The organiser view (/admin) is behind one shared password, ONLINE_ADMIN_PASSWORD.
// A signed cookie remembers it for 12 hours. Changing the password signs everyone out.

const COOKIE = "ol_admin";
const HOURS = 12;

function key() {
  const pw = process.env.ONLINE_ADMIN_PASSWORD;
  const secret = process.env.ONLINE_SESSION_SECRET ?? process.env.SESSION_SECRET;
  if (!pw || !secret) return null;
  return `admin:${secret}:${pw}`;
}

const mac = (k: string, body: string) => createHmac("sha256", k).update(body).digest();
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export function adminConfigured() {
  return key() !== null;
}

export async function checkAdminPassword(given: string) {
  const pw = process.env.ONLINE_ADMIN_PASSWORD;
  if (!pw || !key()) return false;
  // Compare digests, so length and content both stay constant-time.
  const ok = same(mac("pw", given), mac("pw", pw));
  if (!ok) await new Promise((r) => setTimeout(r, 800)); // slows guessing
  return ok;
}

export async function setAdminSession() {
  const k = key();
  if (!k) return;
  const body = String(Date.now() + HOURS * 3_600_000);
  (await cookies()).set(COOKIE, `${body}.${mac(k, body).toString("base64url")}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/admin", maxAge: HOURS * 3600 });
}

export async function clearAdminSession() {
  (await cookies()).set(COOKIE, "", { path: "/admin", maxAge: 0 });
}

export async function isAdmin() {
  await connection();
  const k = key();
  const [body, sig] = ((await cookies()).get(COOKIE)?.value ?? "").split(".");
  if (!k || !body || !sig) return false;
  return same(Buffer.from(sig, "base64url"), mac(k, body)) && Number(body) > Date.now();
}

export type AdminTeam = {
  id: number; name: string; slug: string; solo: boolean; hidden: boolean; invite_code: string; created_at: Date;
  captain: string | null; captain_email: string | null; members: string; member_count: number;
  status: string | null; receipt_code: string | null; submitted_at: Date | null; updated_at: Date | null;
  project_name: string | null; one_line_pitch: string | null; project_description: string | null; more_details: string | null;
  agent_used: string | null; repo_url: string | null; video_url: string | null; live_url: string | null;
  hn_url: string | null; x_url: string | null; reddit_url: string | null; linkedin_url: string | null; other_posts: string | null; files: number;
};

export function adminTeams() {
  return onlineQuery<AdminTeam>(
    `select t.id, t.name, t.slug, t.solo, t.hidden, t.invite_code, t.created_at,
            c.name as captain, c.email as captain_email,
            coalesce((select string_agg(p.name || ' <' || p.email || '>', '; ' order by p.id) from online_participants p where p.team_id = t.id), '') as members,
            (select count(*)::int from online_participants p where p.team_id = t.id) as member_count,
            s.status, s.receipt_code, s.submitted_at, s.updated_at, s.project_name, s.one_line_pitch, s.project_description, s.more_details,
            s.agent_used, s.repo_url, s.video_url, s.live_url, s.hn_url, s.x_url, s.reddit_url, s.linkedin_url, s.other_posts,
            (select count(*)::int from online_attachments a where a.team_id = t.id) as files
       from online_teams t
       left join online_participants c on c.id = t.captain_id
       left join online_submissions s on s.team_id = t.id
      order by (s.status = 'submitted') desc nulls last, s.submitted_at, t.id`,
  );
}

export type AdminPerson = { id: number; name: string; email: string; x_url: string | null; linkedin_url: string | null; other_links: string | null; team: string | null; created_at: Date; last_login_at: Date | null };

export function adminPeople() {
  return onlineQuery<AdminPerson>(
    `select p.id, p.name, p.email, p.x_url, p.linkedin_url, p.other_links, t.name as team, p.created_at, p.last_login_at
       from online_participants p left join online_teams t on t.id = p.team_id order by p.id desc`,
  );
}

export function adminEmails() {
  return onlineQuery<{ id: number; to_email: string; kind: string; subject: string; status: string; error: string | null; created_at: Date }>(
    `select id, to_email, kind, subject, status, error, created_at from online_emails order by id desc limit 100`,
  );
}
