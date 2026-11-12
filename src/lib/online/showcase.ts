import "server-only";
import { onlineQuery } from "./db";

// The public gallery at /showcase: every submitted project an organiser hasn't
// hidden. Read-only, and the same rule as /o/p/{slug}: drafts and hidden teams
// never appear. No emails, no member names beyond the team's own name.

export type ShowcaseCard = {
  slug: string;
  name: string;
  pitch: string | null;
  teamName: string;
  solo: boolean;
  members: number;
  agent: string | null;
  /** A YouTube still for the demo video, when the link is a YouTube one. */
  cover: string | null;
  hasLive: boolean;
  hasRepo: boolean;
  submittedAt: Date | null;
};

const youtubeId = (url: string) => url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{6,})/)?.[1] ?? null;

export async function listShowcase(): Promise<ShowcaseCard[]> {
  const rows = await onlineQuery<{
    slug: string;
    team_name: string;
    solo: boolean;
    members: number;
    project_name: string | null;
    one_line_pitch: string | null;
    agent_used: string | null;
    video_url: string | null;
    live_url: string | null;
    repo_url: string | null;
    submitted_at: Date | null;
  }>(
    `select t.slug, t.name as team_name, t.solo,
            (select count(*)::int from online_participants p where p.team_id = t.id) as members,
            s.project_name, s.one_line_pitch, s.agent_used, s.video_url, s.live_url, s.repo_url, s.submitted_at
       from online_submissions s
       join online_teams t on t.id = s.team_id
      where s.status = 'submitted' and not t.hidden
      order by s.submitted_at desc nulls last, t.id desc`,
  );
  return rows.map((r) => {
    const yt = r.video_url ? youtubeId(r.video_url) : null;
    return {
      slug: r.slug,
      name: r.project_name ?? r.team_name,
      pitch: r.one_line_pitch,
      teamName: r.team_name,
      solo: r.solo,
      members: r.members,
      agent: r.agent_used,
      cover: yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null,
      hasLive: Boolean(r.live_url),
      hasRepo: Boolean(r.repo_url),
      submittedAt: r.submitted_at,
    };
  });
}
