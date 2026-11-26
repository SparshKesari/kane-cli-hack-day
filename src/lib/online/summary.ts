import "server-only";
import { loadSnapshots } from "@/lib/social-snapshots";
import { listOnlinePosts, PLATFORM_LABEL, PLATFORMS, type Platform } from "@/lib/social-tracker";
import { onlineQuery } from "./db";

// The numbers behind /admin/summary: one screen of where the online hackathon
// stands. Read-only. Engagement is the saved reading from the scheduled read
// (see social-snapshots.ts), so it is as fresh as that job's last run.

export type Summary = Awaited<ReturnType<typeof onlineSummary>>;

/** The agents people name, folded to the few that recur; a submission naming two counts for both. */
const AGENTS: [string, RegExp][] = [
  ["Claude Code", /claude/i],
  ["Codex", /codex/i],
  ["Cursor", /cursor/i],
  ["Muse", /muse/i],
];

export async function onlineSummary() {
  const [counts, days, agents, posts, saved] = await Promise.all([
    onlineQuery<{ people: number; on_team: number; teams: number; started: number; submitted: number; builders: number; emails_sent: number; emails_opened: number }>(
      `select (select count(*)::int from online_participants) as people,
              (select count(*)::int from online_participants where team_id is not null) as on_team,
              (select count(*)::int from online_teams where not hidden) as teams,
              (select count(*)::int from online_submissions s join online_teams t on t.id = s.team_id where not t.hidden) as started,
              (select count(*)::int from online_submissions s join online_teams t on t.id = s.team_id where not t.hidden and s.status = 'submitted') as submitted,
              (select count(*)::int from online_participants p join online_submissions s on s.team_id = p.team_id and s.status = 'submitted') as builders,
              (select count(*)::int from online_emails where status = 'sent') as emails_sent,
              (select count(*)::int from online_emails where status = 'sent' and opened_at is not null) as emails_opened`,
    ),
    // One row per day of the event so far, in India time (the event's clock).
    onlineQuery<{ day: string; registered: number; submitted: number }>(
      `select to_char(d, 'YYYY-MM-DD') as day,
              (select count(*)::int from online_participants p where (p.created_at at time zone 'Asia/Kolkata')::date = d::date) as registered,
              (select count(*)::int from online_submissions s where s.status = 'submitted' and (s.submitted_at at time zone 'Asia/Kolkata')::date = d::date) as submitted
         from generate_series(
                (select min((created_at at time zone 'Asia/Kolkata')::date) from online_participants)::timestamp,
                (now() at time zone 'Asia/Kolkata')::date::timestamp, interval '1 day') d
        order by d`,
    ),
    onlineQuery<{ agent_used: string | null }>(`select s.agent_used from online_submissions s join online_teams t on t.id = s.team_id where not t.hidden and s.status = 'submitted'`),
    listOnlinePosts(),
    loadSnapshots().catch(() => new Map() as Awaited<ReturnType<typeof loadSnapshots>>),
  ]);

  const channel = new Map<Platform, { posts: number; teams: Set<string>; likes: number; comments: number; views: number; read: number }>();
  const project = new Map<string, { project: string; href: string | null; posts: number; engagement: number }>();
  let latest = 0;
  for (const p of posts) {
    const e = saved.get(p.url);
    const c = channel.get(p.platform) ?? { posts: 0, teams: new Set(), likes: 0, comments: 0, views: 0, read: 0 };
    const t = project.get(p.team) ?? { project: p.project, href: p.projectHref, posts: 0, engagement: 0 };
    c.posts++;
    c.teams.add(p.team);
    t.posts++;
    if (e) {
      c.read++;
      c.likes += e.likes ?? 0;
      c.comments += e.comments ?? 0;
      c.views += e.views ?? 0;
      t.engagement += (e.likes ?? 0) + (e.comments ?? 0) + (e.reposts ?? 0);
      latest = Math.max(latest, e.readAt.getTime());
    }
    channel.set(p.platform, c);
    project.set(p.team, t);
  }
  const channels = PLATFORMS.flatMap((k) => {
    const c = channel.get(k);
    return c ? [{ key: k, label: PLATFORM_LABEL[k], posts: c.posts, projects: c.teams.size, likes: c.likes, comments: c.comments, views: c.views, read: c.read }] : [];
  }).sort((a, b) => b.posts - a.posts);

  const builtWith = new Map<string, number>();
  for (const { agent_used } of agents) {
    const named = AGENTS.filter(([, re]) => re.test(agent_used ?? "")).map(([name]) => name);
    for (const name of named.length > 0 ? named : ["Other"]) builtWith.set(name, (builtWith.get(name) ?? 0) + 1);
  }

  return {
    ...counts[0],
    days,
    channels,
    posts: posts.length,
    projectsPosting: project.size,
    likes: channels.reduce((n, c) => n + c.likes, 0),
    comments: channels.reduce((n, c) => n + c.comments, 0),
    views: channels.reduce((n, c) => n + c.views, 0),
    postsRead: channels.reduce((n, c) => n + c.read, 0),
    engagementReadAt: latest ? new Date(latest) : null,
    topProjects: [...project.values()].sort((a, b) => b.engagement - a.engagement || b.posts - a.posts).slice(0, 5),
    builtWith: [...builtWith].map(([name, n]) => ({ name, n })).sort((a, b) => (a.name === "Other" ? 1 : b.name === "Other" ? -1 : b.n - a.n)),
  };
}
