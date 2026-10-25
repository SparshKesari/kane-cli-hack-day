import "server-only";
import { query } from "@/lib/db";
import { staffActor, type Staff } from "./auth";
import { AppError, withAudit, z } from "./core";
import { FINAL_STATS, type FinalStats, type StatCounts } from "@/components/live/final-stats";

// The event's final Kane CLI numbers, imported once by an organizer from the Kane CLI usage
// page's two files: latest.json (telemetry for every prod org, as rows keyed by org id) and
// emails.json (each org's users). Only participants' orgs count: an org a participant claimed
// into or was synced into (plan claim, team sync), or an org whose users are all participants.
// Emails are matched here and never stored; what is saved in hack_events.settings.final_stats
// is counts, per team and in total.

export { FINAL_STATS, type FinalStatKey, type FinalStats, type StatCounts } from "@/components/live/final-stats";

const zero = (): StatCounts => ({ tests_authored: 0, test_runs: 0, bugs_caught: 0, use_cases: 0, assurance_commands: 0, explorations: 0 });
const add = (a: StatCounts, b: StatCounts) => {
  for (const s of FINAL_STATS) a[s.key] += b[s.key];
  return a;
};

const row = z.array(z.unknown());
const LatestFile = z.object({
  generated: z.string(),
  window: z.object({ from: z.string(), to: z.string() }),
  feat: z.array(row),
  metrics: z.array(row),
  outcomes: z.array(row),
  explore: z.array(row),
});
const EmailsFile = z.object({ emails: z.record(z.string(), z.array(z.tuple([z.string(), z.unknown()]))) });

export type UsageFiles = { latest: z.infer<typeof LatestFile>; emails: z.infer<typeof EmailsFile>["emails"] };

function readFile<T>(text: string, schema: z.ZodType<T>, name: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new AppError("VALIDATION_FAILED", { userMessage: `That isn't the usage page's ${name}. Download it again from the page and retry.` });
  return r.data;
}

export function parseUsageFiles(latestText: string, emailsText: string): UsageFiles {
  return { latest: readFile(latestText, LatestFile, "latest.json"), emails: readFile(emailsText, EmailsFile, "emails.json").emails };
}

const orgOf = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/**
 * Each final stat per org, from the page's rows. feat: [feature, org, plan, type, uses, …];
 * metrics: [group, name, org, count, …]; outcomes: [hour, "result|kind|verdict|code", org, count, …];
 * explore: [org, event, outcome, count, …]. Definitions match the page's own tiles.
 */
export function countsByOrg(latest: UsageFiles["latest"]): Map<string, StatCounts> {
  const out = new Map<string, StatCounts>();
  const at = (org: string) => out.get(org) ?? out.set(org, zero()).get(org)!;
  for (const r of latest.feat) {
    const [feature, org, , , uses] = r;
    if (feature === "agent runs (run / testmd)" || feature === "testrun") at(orgOf(org)).test_runs += num(uses);
    else if (typeof feature === "string" && feature.startsWith("assurance · ")) at(orgOf(org)).assurance_commands += num(uses);
  }
  for (const r of latest.metrics) if (r[0] === "assurance" && r[1] === "design runs · ok") at(orgOf(r[2])).use_cases += num(r[3]);
  for (const r of latest.outcomes) {
    const [kind, what] = String(r[1] ?? "").split("|");
    if (kind === "result" && what === "author") at(orgOf(r[2])).tests_authored += num(r[3]);
    else if (kind === "verdict" && (what === "failed" || what === "broken")) at(orgOf(r[2])).bugs_caught += num(r[3]);
  }
  for (const r of latest.explore) if (r[1] === "exploration_run_start") at(orgOf(r[0])).explorations += num(r[3]);
  return out;
}

export type Participant = { email: string | null; name?: string | null; teamId: number | null; orgs: string[] };

/**
 * Which orgs are participants' and which team each belongs to. An org counts when a participant
 * claimed or was synced into it, or when every user the page lists in it is a participant; an org
 * shared with other people isn't counted, so a company's own usage doesn't land in the totals.
 * A team is the one with the most participants in the org.
 */
export function matchOrgs(participants: Participant[], emailsByOrg: UsageFiles["emails"]) {
  const voters = new Map<string, Set<number>>();
  const vote = (org: string, i: number) => (voters.get(org) ?? voters.set(org, new Set()).get(org)!).add(i);
  participants.forEach((p, i) => p.orgs.map(orgOf).filter(Boolean).forEach((org) => vote(org, i)));
  const byId = new Set(voters.keys());

  const index = new Map<string, number>();
  participants.forEach((p, i) => p.email && index.set(p.email.trim().toLowerCase(), i));
  let byEmail = 0;
  const shared = new Map<string, number[]>();
  for (const [org, users] of Object.entries(emailsByOrg)) {
    const found = users.map(([email]) => index.get(email.trim().toLowerCase()));
    const matched = found.filter((i): i is number => i !== undefined);
    if (!matched.length) continue;
    if (!byId.has(org) && matched.length < found.length) {
      shared.set(org, matched);
      continue;
    }
    if (!byId.has(org)) byEmail++;
    matched.forEach((i) => vote(org, i));
  }

  /** The team with the most participants among `who`, and how many teams are in it. */
  const teamOf = (who: Iterable<number>) => {
    const tally = new Map<number, number>();
    for (const i of who) {
      const t = participants[i].teamId;
      if (t != null) tally.set(t, (tally.get(t) ?? 0) + 1);
    }
    const best = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    return { teamId: best ? best[0] : null, teams: tally.size };
  };
  const orgTeam = new Map<string, number | null>();
  let conflicts = 0;
  const counted = new Set<number>();
  for (const [org, who] of voters) {
    who.forEach((i) => counted.add(i));
    const t = teamOf(who);
    if (t.teams > 1) conflicts++;
    orgTeam.set(org, t.teamId);
  }
  /** Every org with a participant in it, counted or not, for organizers to look over. */
  const orgs = [
    ...[...voters].map(([org, who]) => ({ org, via: byId.has(org) ? ("testmu" as const) : ("email" as const), who: [...who], teamId: orgTeam.get(org) ?? null, counted: true })),
    ...[...shared].map(([org, who]) => ({ org, via: "email" as const, who, teamId: teamOf(who).teamId, counted: false })),
  ];
  return { orgTeam, orgs, byOrgId: byId.size, byEmail, sharedSkipped: shared.size, conflicts, participantsMatched: counted.size };
}

export function buildFinalStats(files: UsageFiles, participants: Participant[], teams: Map<number, { slug: string; name: string }>): FinalStats {
  const counts = countsByOrg(files.latest);
  const m = matchOrgs(participants, files.emails);
  const totals = zero();
  const perTeam = new Map<number, { orgs: number; counts: StatCounts }>();
  for (const [org, teamId] of m.orgTeam) {
    const c = counts.get(org) ?? zero();
    add(totals, c);
    if (teamId == null || !teams.has(teamId)) continue;
    const t = perTeam.get(teamId) ?? perTeam.set(teamId, { orgs: 0, counts: zero() }).get(teamId)!;
    t.orgs++;
    add(t.counts, c);
  }
  const team = (id: number | null) => (id != null && teams.has(id) ? teams.get(id)! : null);
  const orgs = m.orgs
    .map((o) => ({
      org: o.org,
      team: team(o.teamId),
      via: o.via,
      participants: o.who.map((i) => participants[i].name?.trim() || "(no name)").sort(),
      users: files.emails[o.org]?.length ?? null,
      counted: o.counted,
      counts: counts.get(o.org) ?? zero(),
    }))
    .sort((a, b) => Number(b.counted) - Number(a.counted) || b.counts.test_runs - a.counts.test_runs || a.org.localeCompare(b.org));
  return {
    data_generated: files.latest.generated,
    window: { from: files.latest.window.from, to: files.latest.window.to },
    totals,
    teams: [...perTeam]
      .map(([id, t]) => ({ id, ...teams.get(id)!, orgs: t.orgs, counts: t.counts }))
      .sort((a, b) => b.counts.test_runs - a.counts.test_runs || a.slug.localeCompare(b.slug)),
    orgs,
    matched: {
      orgs: m.orgTeam.size,
      by_org_id: m.byOrgId,
      by_email: m.byEmail,
      shared_skipped: m.sharedSkipped,
      team_conflicts: m.conflicts,
      participants: participants.length,
      participants_matched: m.participantsMatched,
    },
  };
}

// ── Database ────────────────────────────────────────────────────────────────

const SYNCED = ["MEMBER_ADDED", "MEMBER_INVITED", "ALREADY_IN_TEAM"];

/** This event's participants with their current team and the TestMu AI orgs we know they are in. */
async function loadParticipants() {
  const rows = await query<{ email: string | null; member_name: string | null; team_id: number | null; slug: string | null; team_name: string | null; claim_org: string | null; sync_org: string | null }>(
    `select lower(m.email) as email, coalesce(nullif(m.display_name, ''), m.name) as member_name, t.id as team_id, t.slug, t.name as team_name,
            p.response->>'organization_id' as claim_org, s.organization_id::text as sync_org
       from members m
       left join team_memberships tm on tm.member_id = m.id and tm.left_at is null
       left join teams t on t.id = tm.team_id
       left join testmu_plan_claims p on p.member_id = m.id and p.status = 'claimed'
       left join testmu_team_sync s on s.member_id = m.id and s.team_id = t.id and s.code = any($1::text[])
      where m.event_id = current_event_id() and m.deleted_at is null and m.role = 'participant'`,
    [SYNCED],
  );
  const teams = new Map<number, { slug: string; name: string }>();
  const participants: Participant[] = rows.map((r) => {
    const teamId = r.team_id == null ? null : Number(r.team_id);
    if (teamId != null && r.slug) teams.set(teamId, { slug: r.slug, name: r.team_name ?? r.slug });
    return { email: r.email, name: r.member_name, teamId, orgs: [r.sync_org, r.claim_org].filter((o): o is string => !!o) };
  });
  return { participants, teams };
}

/** Check the two files against this event's participants; with `save`, store the result as the final numbers (audited). */
export async function importFinalStats(latestText: string, emailsText: string, opts: { save: boolean; reason: string }, staff: Staff) {
  const files = parseUsageFiles(latestText, emailsText);
  const { participants, teams } = await loadParticipants();
  const stats = buildFinalStats(files, participants, teams);
  if (!opts.save) return { stats, receipt: null };
  return withAudit(staffActor(staff), "final_stats.import", "hack_event", async (tx) => {
    const { rows } = await tx.query<{ id: number; now: Date }>("select id, now() as now from hack_events where id = current_event_id() for update");
    if (!rows[0]) throw new AppError("NOT_FOUND", { userMessage: "No event row. Run the migrations first." });
    const saved: FinalStats = { ...stats, imported_at: rows[0].now.toISOString() };
    await tx.query("update hack_events set settings = settings || jsonb_build_object('final_stats', $2::jsonb), updated_at = now() where id = $1", [rows[0].id, JSON.stringify(saved)]);
    return {
      result: { stats: saved, receipt: { id: `FINAL-${rows[0].id}-${rows[0].now.getTime()}`, server_time: rows[0].now.toISOString() } },
      resourceId: rows[0].id,
      reason: opts.reason,
      after: { totals: saved.totals, matched: saved.matched, data_generated: saved.data_generated },
      payload: { teams: saved.teams.length },
    };
  });
}

/** The saved final numbers for this event, or null before the import. */
export async function getFinalStats(): Promise<FinalStats | null> {
  try {
    const [r] = await query<{ s: FinalStats | null }>("select settings->'final_stats' as s from hack_events where id = current_event_id()");
    // Saves from before the org list have no `orgs`.
    return r?.s ? { ...r.s, orgs: r.s.orgs ?? [] } : null;
  } catch (err) {
    console.error("[final-stats] read failed", err);
    return null;
  }
}
