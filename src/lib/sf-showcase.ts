import "server-only";
import { cacheLife } from "next/cache";
import { query } from "@/lib/db";
import { visualSrc, type ProjectStory, type ProjectType } from "@/server/showcase";

// The SF Hack Day's projects for /showcase: every submitted project once,
// whether its /ship page is public, unlisted or still off (draft). Only pages an
// organiser hid by moderation are left out. Read-only: nothing here writes, and
// /ship itself is untouched, so a project whose page is off links to its demo
// or repo instead of a /ship page that would 404.

/** What a card shows in its 16:9 frame: a still, or the first frame of an uploaded demo video. */
export type Cover = { kind: "image"; src: string; alt: string } | { kind: "video"; src: string };

export type SfCard = {
  slug: string;
  /** /ship/{slug} when that page is open to visitors; otherwise the project's demo, video or repo. */
  href: string;
  external: boolean;
  name: string;
  pitch: string;
  type: ProjectType;
  teamName: string;
  cover: Cover | null;
  verifiedRuns: number;
  /** The judges' placing (1, 2, 3) for a winner; null for everyone else. Two teams tied for third. */
  rank: number | null;
};

// The judges' results, by project slug. Two teams share third place.
const WINNERS: Record<string, number> = { lighthouse: 1, "1": 2, builder: 3, "kane-you-not": 3 };

const youtubeId = (url: string) => url.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{6,})/)?.[1] ?? null;
const isLoom = (url: string) => /^https:\/\/(www\.)?loom\.com\/(share|embed)\/[\w-]+/.test(url);
const isVideoFile = (url: string) => /^https:\/\/[^\s"'<>]+\.(mp4|webm|mov)(\?[^\s"'<>]*)?$/i.test(url);

/** "owner/repo" from a GitHub link, or null. */
const githubRepo = (url: string) => url.match(/^https:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i)?.[1] ?? null;
const httpsUrl = (u: string | null | undefined) => (u && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

/** Loom publishes each recording's still through oEmbed. Looked up once a day; null when Loom doesn't answer. */
async function loomThumbnail(url: string): Promise<string | null> {
  "use cache";
  cacheLife("days");
  try {
    const res = await fetch(`https://www.loom.com/v1/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const thumb = ((await res.json()) as { thumbnail_url?: unknown }).thumbnail_url;
    return typeof thumb === "string" && /^https:\/\/[^\s"'<>]+$/.test(thumb) ? thumb : null;
  } catch {
    return null;
  }
}

/**
 * The best picture a project has, in order: one of its own approved images
 * (a screenshot or artwork), a still from its demo video (YouTube, Loom), or
 * the uploaded demo video itself, shown paused on an early frame.
 */
async function pickCover(slug: string, projectId: number, story: ProjectStory, videoUrl: string | null, repoUrl: string | null, pageOpen: boolean): Promise<Cover | null> {
  const approved = story.visuals.filter((v) => v.approved);
  for (const v of approved) {
    if (v.kind === "video") continue;
    const src = visualSrc(slug, projectId, v.source);
    // Uploaded screenshots are served through /ship/{slug}/media, which only answers while the page is open.
    if (src?.startsWith("/") && !pageOpen) continue;
    if (src) return { kind: "image", src, alt: v.alt_text ?? "" };
  }
  // The story's video visual is sometimes cut short; the submission keeps the full link.
  const videos = [videoUrl, ...approved.filter((v) => v.kind === "video").map((v) => v.source)].filter((u): u is string => Boolean(u));
  for (const u of videos) {
    const yt = youtubeId(u);
    if (yt) return { kind: "image", src: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, alt: "" };
  }
  for (const u of videos) {
    if (!isLoom(u)) continue;
    const thumb = await loomThumbnail(u);
    if (thumb) return { kind: "image", src: thumb, alt: "" };
  }
  const file = videos.find(isVideoFile);
  if (file) return { kind: "video", src: file };
  // Last resort: the card GitHub draws for the repository.
  const repo = repoUrl ? githubRepo(repoUrl) : null;
  return repo ? { kind: "image", src: `https://opengraph.githubassets.com/1/${repo}`, alt: "" } : null;
}

export async function listSfShowcase(): Promise<SfCard[]> {
  const rows = await query<{
    slug: string;
    name: string;
    project_type: ProjectType;
    team_name: string;
    project_id: number;
    content: ProjectStory;
    video_url: string | null;
    showcase_state: string;
    repo_url: string | null;
    live_url: string | null;
  }>(
    `select p.slug, p.name, p.project_type, t.name as team_name, p.id as project_id, s.content, p.showcase_state, p.repo_url, p.live_url,
            (select sub.draft->>'video_url' from submissions sub where sub.project_id = p.id order by sub.id desc limit 1) as video_url
       from projects p
       join teams t on t.id = p.team_id
       join lateral (
         select * from published_assets a where a.project_id = p.id and a.kind = 'ship_page' order by a.version desc limit 1
       ) a on true
       join project_stories s on s.id = a.source_story_id
      where p.showcase_state in ('public', 'unlisted', 'draft')
      order by (p.showcase_state = 'public') desc, a.published_at desc`,
  );
  const runIds = rows.flatMap((r) => r.content.proof.map((p) => Number(p.run_id)).filter((n) => n > 0));
  const verified = runIds.length
    ? await query<{ project_id: number; n: number }>(
        `select project_id, count(*)::int as n from kane_runs
          where id = any($1::bigint[]) and status = 'passed' and source_verified group by project_id`,
        [runIds],
      )
    : [];
  const vmap = new Map(verified.map((v) => [Number(v.project_id), v.n]));
  const cards = await Promise.all(
    rows.map(async (r): Promise<SfCard | null> => {
      const pageOpen = r.showcase_state !== "draft";
      const links = r.content.links as Record<string, string | undefined>;
      const repo = httpsUrl(links.github) ?? httpsUrl(r.repo_url);
      // A page that is off can't be linked: send people to the demo, the video or the code.
      const href = pageOpen ? `/ship/${r.slug}` : (httpsUrl(links.demo) ?? httpsUrl(r.live_url) ?? httpsUrl(r.video_url) ?? repo);
      if (!href) return null;
      return {
        slug: r.slug,
        href,
        external: !pageOpen,
        name: r.content.project_name || r.name,
        pitch: r.content.one_line_pitch,
        type: r.project_type,
        teamName: r.team_name,
        cover: await pickCover(r.slug, Number(r.project_id), r.content, r.video_url, repo, pageOpen),
        verifiedRuns: vmap.get(Number(r.project_id)) ?? 0,
        rank: WINNERS[r.slug] ?? null,
      };
    }),
  );
  // One card per project: the same repository (or the same name) submitted twice shows once.
  // Winners first, in placing order, so a winner is never the copy that gets dropped.
  const ordered = cards.filter((c): c is SfCard => c !== null);
  ordered.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const seen = new Set<string>();
  return ordered.filter((c) => {
    const keys = [`name:${c.name.trim().toLowerCase()}`, ...(c.external ? [`href:${c.href.replace(/\/+$/, "").toLowerCase()}`] : [])];
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}
