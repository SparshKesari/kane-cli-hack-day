import "server-only";
import { randomInt } from "node:crypto";
import { onlineEvent } from "@/data/online";
import { onlineQuery } from "./db";
import { checkPosts, normalizeUrl } from "./links";

// A team's submission: the project, the demo, the agent, and the launch posts.
// Stored in the online database only.

const LIMITS = {
  project_name: 80,
  one_line_pitch: 170,
  project_description: 1500,
  more_details: 4000,
  repo_url: 300,
  video_url: 300,
  live_url: 300,
  agent_used: 80,
  hn_url: 1500,
  x_url: 1500,
  reddit_url: 1500,
  linkedin_url: 1500,
  other_posts: 1500,
} as const;

export const FIELDS = Object.keys(LIMITS) as (keyof typeof LIMITS)[];
export type Draft = Record<(typeof FIELDS)[number], string | null>;

export type Submission = Draft & {
  status: "draft" | "submitted";
  submitted_at: Date | null;
  updated_at: Date;
  version: number;
  receipt_code: string | null;
  /** Who saved it last. */
  editor: string | null;
};

export const emptyDraft = (): Draft => Object.fromEntries(FIELDS.map((k) => [k, null])) as Draft;

export function isLocked(now = new Date()) {
  return now >= new Date(onlineEvent.submissionDeadline);
}

export async function getSubmission(teamId: number) {
  const [row] = await onlineQuery<Submission>(
    `select ${FIELDS.map((f) => `s.${f}`).join(", ")}, s.status, s.submitted_at, s.updated_at, s.version, s.receipt_code, p.name as editor
       from online_submissions s left join online_participants p on p.id = s.participant_id where s.team_id = $1`,
    [teamId],
  );
  return row ?? null;
}

/** What was typed, trimmed and cut to length. Check it with formatIssues() before cleaning. */
export function rawFromForm(form: FormData): Record<string, string> {
  return Object.fromEntries(FIELDS.map((k) => [k, String(form.get(k) ?? "").trim().slice(0, LIMITS[k])]));
}

/** Links get https:// and one spelling; post fields become ", "-joined lists. Call after formatIssues() is empty. */
export function cleanDraft(raw: Record<string, string>): Draft {
  const d = Object.fromEntries(FIELDS.map((k) => [k, raw[k] || null])) as Draft;
  for (const k of ["repo_url", "video_url", "live_url"] as const) d[k] = d[k] ? normalizeUrl(d[k]) : null;
  return { ...d, ...checkPosts(raw).clean } as Draft;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newReceipt = () => `KH-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

export type SaveResult =
  | { conflict: true; by: string | null; at: Date }
  | { conflict: false; submitted: boolean; receipt: string | null; version: number; at: Date };

/**
 * Saves the team's draft; with `submit`, also marks it submitted.
 * `baseVersion` is the version the form was loaded with: if a teammate saved
 * in between, nothing is written and the caller is told who and when.
 */
export async function saveSubmission(teamId: number, participantId: number, d: Draft, submit: boolean, baseVersion: number): Promise<SaveResult> {
  const cols = FIELDS.join(", ");
  const params = FIELDS.map((_, i) => `$${i + 3}`).join(", ");
  const sets = FIELDS.map((k) => `${k} = excluded.${k}`).join(", ");
  const n = FIELDS.length;
  const [s, base, receipt] = [`$${n + 3}`, `$${n + 4}`, `$${n + 5}`];
  // Once submitted it stays submitted; later saves just update the answers.
  const rows = await onlineQuery<{ status: string; version: number; receipt_code: string | null; updated_at: Date }>(
    `insert into online_submissions as s (team_id, participant_id, ${cols}, status, submitted_at, version, receipt_code)
     values ($1, $2, ${params}, case when ${s} then 'submitted' else 'draft' end, case when ${s} then now() end, 1, case when ${s} then ${receipt} end)
     on conflict (team_id) do update set ${sets}, participant_id = excluded.participant_id,
            status = case when ${s} or s.status = 'submitted' then 'submitted' else 'draft' end,
            submitted_at = case when ${s} and s.submitted_at is null then now() else s.submitted_at end,
            receipt_code = coalesce(s.receipt_code, case when ${s} then ${receipt} end),
            version = s.version + 1,
            updated_at = now()
      where s.version = ${base}
     returning status, version, receipt_code, updated_at`,
    [teamId, participantId, ...FIELDS.map((k) => d[k]), submit, baseVersion, newReceipt()],
  );
  if (!rows.length) {
    const now = await getSubmission(teamId);
    return { conflict: true, by: now?.editor ?? null, at: now?.updated_at ?? new Date() };
  }
  const r = rows[0];
  return { conflict: false, submitted: r.status === "submitted", receipt: r.receipt_code, version: r.version, at: r.updated_at };
}

/** The deadline's time zone first, then Pacific: "19 Nov 2026, 11:42 PM IST (10:12 AM PT)". */
export function formatWhen(d: Date) {
  const f = (timeZone: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone, hour12: true, ...opts }).format(d).replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
  return `${f("Asia/Kolkata", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })} IST (${f("America/Los_Angeles", { hour: "numeric", minute: "2-digit" })} PT)`;
}
