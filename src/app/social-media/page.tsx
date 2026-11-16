import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { engagementFor, hasEngagement } from "@/lib/social-engagement";
import { EVENT_LABEL, listOnlinePosts, listSfPosts, type TrackedPost } from "@/lib/social-tracker";
import OnlineShell from "../o/Shell";
import TrackerView, { type Row } from "./TrackerView";

// /social-media: every social, blog and video link teams entered in their
// submission, across the SF Hack Day and the online hackathon. Read on every
// request, so a link shows up the moment a team saves it; nothing is cached
// and nothing is written. The two events live in separate databases, so each
// list loads, and fails, on its own.

export const metadata: Metadata = { title: { absolute: "Social media tracker · KaneCLI hackathons" }, robots: { index: false, follow: false } };

export default function SocialMediaPage() {
  return (
    <OnlineShell>
      <header className="relative isolate overflow-hidden border-b border-dashed border-hairline">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(#3a3a3a_1px,transparent_1.5px)] [background-size:10px_10px] [mask-image:radial-gradient(ellipse_at_top_left,black_10%,transparent_65%)]"
        />
        <div className="container-page py-10 sm:py-14">
          <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">KaneCLI hackathons</p>
          <h1 className="mt-4 font-dots text-4xl leading-[0.95] font-black tracking-[-0.01em] text-bright sm:text-6xl">
            Social Media Tracker<span className="text-lime">.</span>
          </h1>
          <p className="mt-4 max-w-2xl font-display text-lg leading-snug text-lightgray sm:text-xl">
            The X, LinkedIn, Hacker News, Reddit, blog and video links teams put in their submission, with likes, comments and views, for Hack Day SF and the online hackathon.
          </p>
        </div>
      </header>
      <Suspense fallback={<p className="container-page py-14 font-plex text-sm text-lightgray">Loading posts and their numbers…</p>}>
        <Tracker />
      </Suspense>
    </OnlineShell>
  );
}

type Loaded = { posts: TrackedPost[]; problem: string | null };

async function load(name: string, connected: boolean, fn: () => Promise<TrackedPost[]>): Promise<Loaded> {
  if (!connected) return { posts: [], problem: `${name}: database not connected on this machine, so its posts are missing.` };
  try {
    return { posts: await fn(), problem: null };
  } catch (e) {
    console.error(`social-media: ${name} failed to load`, e);
    return { posts: [], problem: `${name}: couldn't load right now, so its posts are missing.` };
  }
}

async function Tracker() {
  await connection(); // live: the posts are read on every request
  const [sf, online] = await Promise.all([
    load(EVENT_LABEL.sf, Boolean(process.env.DATABASE_URL), listSfPosts),
    load(EVENT_LABEL.online, Boolean(process.env.ONLINE_DATABASE_URL), listOnlinePosts),
  ]);
  const posts = [...online.posts, ...sf.posts];
  // Likes, comments and views, kept for an hour per post (see social-engagement.ts).
  const engagement = await engagementFor(posts);
  const rows: Row[] = posts.map((p) => {
    const e = engagement.get(p.url);
    return {
      event: p.event,
      team: p.team,
      project: p.project,
      projectHref: p.projectHref,
      platform: p.platform,
      url: p.url,
      savedAt: p.savedAt ? new Date(p.savedAt).toISOString() : null,
      likes: e?.likes ?? null,
      comments: e?.comments ?? null,
      views: e?.views ?? null,
      countable: hasEngagement(p.platform, p.url),
      official: e?.official ?? null,
    };
  });
  const readAt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", timeZoneName: "short" }).format(new Date());
  const problems = [sf.problem, online.problem].filter((p): p is string => Boolean(p));

  return (
    <>
      {problems.length > 0 && (
        <div className="container-page pt-8">
          {problems.map((p) => (
            <p key={p} role="status" className="mb-2 border border-danger px-4 py-3 font-plex text-sm text-danger">
              {p}
            </p>
          ))}
        </div>
      )}
      <TrackerView rows={rows} readAt={readAt} />
    </>
  );
}
