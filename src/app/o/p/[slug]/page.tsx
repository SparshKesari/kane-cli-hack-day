import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatBytes } from "@/lib/online/attachment-rules";
import { listAttachments } from "@/lib/online/attachments";
import { PLATFORMS, PLATFORM_FIELDS, splitLinks } from "@/lib/online/links";
import { getSubmission } from "@/lib/online/submission";
import { getMe, getMembers, getTeamBySlug } from "@/lib/online/team";
import TeamTabs from "../../TeamTabs";
import Icon, { iconFor } from "../../Icons";
import ShareBar from "./ShareBar";

// A team's public showcase: name and links, the demo as the centrepiece, a
// facts strip, then the story (left) and repo, team, posts and sharing (right). It shows the
// project once it's submitted; before that, just who is building. Emails are
// never shown.

const linkCls = "text-bright underline decoration-hairline underline-offset-4 hover:text-lime";

export async function generateMetadata({ params }: PageProps<"/o/p/[slug]">): Promise<Metadata> {
  const team = await getTeamBySlug((await params).slug);
  if (!team) return { title: "Project" };
  const sub = await getSubmission(team.id);
  const live = sub?.status === "submitted" ? sub : null;
  const title = live?.project_name ?? team.name;
  const description = live?.one_line_pitch ?? "";
  // Until the project is submitted (or while an organiser has it hidden) the page is for the team only.
  if (!live || team.hidden) return { title: "Project", robots: { index: false, follow: false } };
  return { title, description, openGraph: { title, description, type: "article" }, twitter: { card: "summary_large_image", title, description, images: [`/o/p/${team.slug}/opengraph-image`] } };
}

export default function ProjectPage({ params }: PageProps<"/o/p/[slug]">) {
  return (
    <Suspense fallback={<section className="container-page py-16 font-plex text-sm text-lightgray">Loading…</section>}>
      <Body params={params} />
    </Suspense>
  );
}

function youtubeId(url: string) {
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{6,})/);
  return m?.[1] ?? null;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** "owner/repo" from a GitHub URL. */
const repoName = (url: string) => url.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$|\/$/g, "").split("/").slice(0, 2).join("/") || "GitHub";

async function Body({ params }: Pick<PageProps<"/o/p/[slug]">, "params">) {
  const team = await getTeamBySlug((await params).slug);
  if (!team) notFound();
  const [members, sub, me, files] = await Promise.all([getMembers(team.id), getSubmission(team.id), getMe(), listAttachments(team.id)]);
  // Only this team sees the switch back to its submission.
  const mine = me?.teamId === team.id;
  // Private until submitted, and whenever an organiser hides it: member names stay off the open web.
  if (!mine && (sub?.status !== "submitted" || team.hidden)) notFound();
  const live = sub?.status === "submitted" ? sub : null;
  const name = live?.project_name ?? team.name;
  const video = live?.video_url ? youtubeId(live.video_url) : null;
  // Every post link: the platform fields hold comma-separated lists.
  const posts: [string, string][] = live
    ? [
        ...PLATFORM_FIELDS.flatMap((f) => {
          const links = splitLinks(live[f]);
          return links.map((u, i): [string, string] => [links.length > 1 ? `${PLATFORMS[f].label} ${i + 1}` : PLATFORMS[f].label, u]);
        }),
        ...splitLinks(live.other_posts).map((u): [string, string] => [host(u), u]),
      ]
    : [];

  return (
    <>
      {/* Header band */}
      <header className="relative isolate overflow-hidden border-b border-dashed border-hairline">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(#3a3a3a_1px,transparent_1.5px)] [background-size:10px_10px] [mask-image:radial-gradient(ellipse_at_top_left,black_10%,transparent_65%)]"
        />
        <div className="container-page py-14 sm:py-20">
          {mine && (
            <div className="mb-8 flex flex-wrap items-center gap-4">
              <TeamTabs slug={team.slug} current="showcase" />
              <span className="font-plex text-sm text-lightgray">Only your team sees this switch. Everyone else sees the page below.</span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 font-pixel text-xs uppercase tracking-[0.15em]">
            <span className="text-lightgray">KaneCLI Online Hackathon</span>
            <span className={`border px-2 py-0.5 ${live ? "border-lime text-lime" : "border-hairline text-lightgray"}`}>{live ? "Submitted" : "Building"}</span>
            {live?.agent_used && <span className="border border-hairline px-2 py-0.5 text-bright">{live.agent_used}</span>}
            <span className="border border-hairline px-2 py-0.5 text-bright">{team.solo ? "Solo" : `Team of ${members.length}`}</span>
          </div>
          <h1 className="mt-5 font-dots text-5xl leading-[0.95] font-black tracking-[-0.01em] break-words text-bright sm:text-7xl">{name}</h1>
          <p className="mt-5 max-w-2xl font-display text-xl leading-snug text-lightgray sm:text-2xl">
            {live?.one_line_pitch ?? "Building now. This page goes live when the project is submitted."}
          </p>
          {!team.solo && (
            <p className="mt-4 font-plex text-sm text-lightgray">
              by <span className="text-bright">{team.name}</span>
            </p>
          )}
          {live && (
            <div className="mt-8 flex flex-wrap gap-3 font-plex text-sm">
              {live.live_url && (
                <a href={live.live_url} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center gap-2 bg-lime px-6 text-ink transition-colors hover:bg-bright">
                  Try it live ↗
                </a>
              )}
              {live.repo_url && (
                <a href={live.repo_url} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center gap-3 bg-bright px-6 text-ink transition-colors hover:bg-lime">
                  <Icon name="github" className="h-5 w-5" />
                  {repoName(live.repo_url)}
                </a>
              )}
            </div>
          )}
        </div>
      </header>

      {video && (
        <div className="container-page pt-14">
          <div className="brackets mx-auto max-w-5xl p-2 sm:p-3">
            <div className="aspect-video bg-surface">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${video}`}
                title={`${name} demo video`}
                allow="accelerometer; encrypted-media; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      )}

      {live && (
        <div className="container-page pt-10">
          <dl className="grid gap-px border border-dashed border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Built with" value={live.agent_used ?? "An AI agent"} />
            <Stat label="Tested with" value="Kane CLI" lime />
            <Stat label={team.solo ? "Built by" : "Team"} value={team.solo ? (members[0]?.name ?? team.name) : `${team.name} · ${members.length}`} />
            <Stat label="Shipped" value={live.submitted_at ? live.submitted_at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "In time"} />
          </dl>
        </div>
      )}

      <div className="container-page grid gap-12 py-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        {/* The story */}
        <div className="min-w-0">
          {!video && live?.video_url && (
            <a href={live.video_url} target="_blank" rel="noreferrer" className={`font-plex text-sm ${linkCls}`}>
              Watch the demo video ↗
            </a>
          )}

          {live ? (
            <>
              <Block title="What it is" first>
                <p className="whitespace-pre-line text-base leading-relaxed text-bright">{live.project_description}</p>
              </Block>
              {live.more_details && (
                <Block title="More about it">
                  <p className="whitespace-pre-line">{live.more_details}</p>
                </Block>
              )}
              {files.length > 0 && (
                <Block title="Wireframes, decks and diagrams">
                  <ul className="grid gap-px border border-dashed border-hairline bg-hairline sm:grid-cols-2">
                    {files.map((f) => (
                      <li key={f.id} className="bg-ink">
                        <a href={`/o/files/${f.id}`} target="_blank" rel="noreferrer" className="group flex items-center gap-3 p-4 hover:bg-surface">
                          <span className="grid h-10 w-10 shrink-0 place-items-center border border-hairline font-pixel text-xs uppercase text-bright group-hover:border-lime group-hover:text-lime">
                            {f.filename.split(".").pop()?.slice(0, 4)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-bright group-hover:text-lime">{f.filename}</span>
                            <span className="text-xs">{formatBytes(f.size_bytes)}</span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
            </>
          ) : (
            <div className="brackets p-8">
              <p className="font-dots text-4xl leading-none font-black text-lime">Work in progress</p>
              <p className="mt-4 font-plex text-sm leading-relaxed text-lightgray">
                {team.solo ? "This builder is" : "This team is"} heads-down until the deadline. The demo, the code and the story land here once they submit.
              </p>
            </div>
          )}
        </div>

        {/* The facts */}
        <aside className="space-y-8 lg:sticky lg:top-24 lg:self-start">
          {live?.repo_url && (
            <a href={live.repo_url} target="_blank" rel="noreferrer" className="group brackets flex items-center gap-4 p-5 transition-colors hover:bg-surface">
              <Icon name="github" className="h-10 w-10 text-bright transition-colors group-hover:text-lime" />
              <span className="min-w-0">
                <span className="block font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">Source code</span>
                <span className="block truncate font-display text-lg text-bright">{repoName(live.repo_url)}</span>
                <span className="font-plex text-sm text-lightgray group-hover:text-lime">View on GitHub ↗</span>
              </span>
            </a>
          )}

          <Fact title={team.solo ? "Built by" : "The team"}>
            <ul className="space-y-3">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3">
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center border border-hairline font-pixel text-xs text-bright">
                    {m.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-plex text-sm text-bright">{m.name}</span>
                    {(m.x_url || m.linkedin_url) && (
                      <span className="mt-1 flex gap-3">
                        {m.x_url && (
                          <a href={m.x_url} target="_blank" rel="noreferrer" aria-label={`${m.name} on X`} className="text-lightgray hover:text-lime">
                            <Icon name="x" className="h-3.5 w-3.5" />
                          </a>
                        )}
                        {m.linkedin_url && (
                          <a href={m.linkedin_url} target="_blank" rel="noreferrer" aria-label={`${m.name} on LinkedIn`} className="text-lightgray hover:text-lime">
                            <Icon name="linkedin" className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Fact>

          {posts.length > 0 && (
            <Fact title="Launch posts">
              <ul className="space-y-2 font-plex text-sm">
                {posts.map(([label, href]) => (
                  <li key={href}>
                    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 text-bright hover:text-lime">
                      <Icon name={iconFor(href)} />
                      {label} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </Fact>
          )}

          <Fact title="Share this project">
            <ShareBar text={live ? `${name}: ${live.one_line_pitch ?? ""} Tested with @kane_cli. #KaneCLIHackathon` : `${name} is building for the KaneCLI Online Hackathon. #KaneCLIHackathon`} />
          </Fact>
        </aside>
      </div>

      <div className="border-t border-dashed border-hairline">
        <div className="container-page flex flex-wrap items-center justify-between gap-4 py-8 font-plex text-sm text-lightgray">
          <p>Built in a week for the KaneCLI Online Hackathon.</p>
          <Link href="/" className={linkCls}>
            See the hackathon →
          </Link>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, lime }: { label: string; value: string; lime?: boolean }) {
  return (
    <div className={`p-5 ${lime ? "bg-lime text-ink" : "bg-ink"}`}>
      <dt className={`font-pixel text-xs uppercase tracking-[0.15em] ${lime ? "" : "text-lightgray"}`}>{label}</dt>
      <dd className={`mt-2 truncate font-display text-xl ${lime ? "" : "text-bright"}`}>{value}</dd>
    </div>
  );
}

function Block({ title, children, first }: { title: string; children: React.ReactNode; first?: boolean }) {
  return (
    <section className={first ? "" : "mt-10 border-t border-dashed border-hairline pt-6"}>
      <h2 className="font-pixel text-xs uppercase tracking-[0.18em] text-lightgray">{title}</h2>
      <div className="mt-4 font-plex text-sm leading-relaxed text-lightgray">{children}</div>
    </section>
  );
}

function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-dashed border-hairline pt-5">
      <h2 className="mb-4 font-pixel text-xs uppercase tracking-[0.18em] text-lightgray">{title}</h2>
      {children}
    </section>
  );
}
