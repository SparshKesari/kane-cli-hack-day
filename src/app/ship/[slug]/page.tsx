import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { FINAL_STATS, teamNumbers } from "@/components/live/final-stats";
import { DEFAULT_TEMPLATE, ShipTemplate } from "@/components/ship-templates";
import StatusPill from "@/components/ui/StatusPill";
import { Eyebrow } from "@/components/ui/Section";
import { event } from "@/data/hackday";
import { isEnabled } from "@/lib/flags";
import { siteUrl } from "@/server/core";
import {
  PROJECT_TYPE_LABEL,
  getPublishedStory,
  getShowcase,
  resolveShipSlug,
  type EvidenceRun,
  type ProjectType,
  type ShowcaseView,
  type SubmissionExtras,
  visualSrc,
} from "@/server/showcase";
import { getPublishedDeck } from "@/server/deck";
import { getFinalStats } from "@/server/final-stats";
import { listMilestones } from "@/server/kane";
import { getShipTemplate, getPublishedStory as getPublicStory } from "@/server/story";
import { kaneComponentLabel, loadDraftForShowcase } from "@/server/submission";
import { onePagerEmbed } from "@/server/team-page";
import Stage, { CopyUrl, type StageVideo } from "./Stage";

// /ship/{slug}: the public showcase, Product × Proof in the site's own theme.
// Every claim comes from the team's submission and the Kane runs it links;
// teal VERIFIED appears only for a passing run from a verified channel, a
// failing run reads as a detection, and anything else is participant
// reported. Only people who consented are named.

export async function generateMetadata({ params }: PageProps<"/ship/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const pub = await getPublishedStory(slug).catch(() => null);
  if (!pub) return { title: "Showcase", robots: { index: false } };
  const s = pub.story;
  return {
    title: `${s.project_name} · Showcase`,
    description: s.one_line_pitch || undefined,
    robots: pub.project.showcase_state === "public" ? undefined : { index: false },
    openGraph: { title: s.project_name, description: s.one_line_pitch || undefined, url: siteUrl(`/ship/${pub.project.slug}`), type: "article" },
    twitter: { card: "summary_large_image", title: s.project_name, description: s.one_line_pitch || undefined },
  };
}

export default function ShipPage({ params }: PageProps<"/ship/[slug]">) {
  return (
    <main>
      <Suspense fallback={<p className="container-page py-24 font-plex text-sm text-lightgray">Loading showcase…</p>}>
        <Ship params={params} />
      </Suspense>
    </main>
  );
}

const eyebrow = "font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray";
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: event.timezone, timeZoneName: "short" });

async function Ship({ params }: { params: PageProps<"/ship/[slug]">["params"] }) {
  const { slug } = await params;
  // Organizer kill switch (T-005 / T-SHIP-04): every public showcase goes offline.
  if (!(await isEnabled("ship_pages"))) return <Offline />;
  const found = await resolveShipSlug(slug);
  if (!found) notFound();
  if ("redirectTo" in found) permanentRedirect(`/ship/${found.redirectTo}`);
  const view = await getShowcase(found.project, loadDraftForShowcase);
  if (!view) notFound();
  // The deck link only shows when /ship/{slug}/deck will actually open: a
  // published (public/unlisted) page always has at least the default deck.
  const live = !view.preview && (view.mode === "public" || view.mode === "unlisted");
  const [deck, template, onePager] = await Promise.all([
    live ? getPublishedDeck(found.project.slug).catch(() => null) : null,
    getShipTemplate(found.project.id),
    onePagerEmbed(found.project, view.viewer.canPreview).catch(() => null),
  ]);
  // The team's chosen layout (T-SHIP-09) over the same public story DTO.
  // Product × Proof keeps this page's own, richer layout.
  if (live && template !== DEFAULT_TEMPLATE) {
    const pub = await getPublicStory(found.project.id).catch(() => null);
    if (pub) {
      return (
        <>
          <ShipTemplate name={template} story={{ ...pub.story, hasDeck: !!deck }} />
          <OnePager embed={onePager} name={pub.story.name} />
          <PublicMilestones projectId={found.project.id} />
          <KaneCliNumbers teamId={found.project.team_id} slug={found.project.slug} />
          <div className="container-page pb-16">
            <SubmittedExtras extras={view.extras} />
          </div>
        </>
      );
    }
  }
  return (
    <>
      <ShipBody view={view} hasDeck={!!deck} onePager={onePager} />
      {live && <PublicMilestones projectId={found.project.id} />}
      {live && <KaneCliNumbers teamId={found.project.team_id} slug={found.project.slug} />}
    </>
  );
}

/**
 * Milestones a teammate approved as Public on the Proof tab (T-KANE-07). Only the
 * claim and its confidence: no proposer or approver names on a public page.
 */
async function PublicMilestones({ projectId }: { projectId: number }) {
  const rows = await listMilestones(projectId, { publicOnly: true }).catch(() => []);
  if (!rows.length) return null;
  return (
    <section id="milestones" className="border-t border-dashed border-hairline py-16 sm:py-20">
      <div className="container-page">
        <p className={eyebrow}>Milestones · approved by the team</p>
        <ul className="mt-6 space-y-5">
          {rows.map((m) => (
            <li key={m.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-3">
                {m.confidence === "verified" ? (
                  <StatusPill tone="verified">Verified</StatusPill>
                ) : (
                  <StatusPill tone="unverified">{m.confidence === "inferred" ? "Inferred" : "Participant reported"}</StatusPill>
                )}
                <span className="font-display text-lg text-bright">{m.title}</span>
              </div>
              {m.claim && m.claim !== m.title && <p className="max-w-2xl font-plex text-sm text-lightgray">{m.claim}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The team's final Kane CLI numbers, once an organizer saves them in /ops/final-stats: usage on
 * the TestMu AI orgs matched to this team. Nothing shows before that, or for a team with no
 * matched org. `slug` is the project's, which is the team's.
 */
async function KaneCliNumbers({ teamId, slug }: { teamId: number; slug: string }) {
  const stats = await getFinalStats();
  const counts = teamNumbers(stats, teamId, slug);
  if (!stats || !counts) return null;
  return (
    <section id="kane-cli" className="scroll-mt-24 border-t border-dashed border-hairline py-16 sm:py-20">
      <div className="container-page">
        <p className={eyebrow}>Kane CLI · on the day</p>
        <dl className="mt-6 grid grid-cols-2 gap-px border border-hairline bg-hairline sm:grid-cols-3 lg:grid-cols-6">
          {FINAL_STATS.map((s) => (
            <div key={s.key} className="bg-ink p-4">
              <dt className={`${eyebrow} min-h-8`}>{s.label}</dt>
              <dd className="mt-2 font-display text-3xl tracking-[-0.03em] text-bright tabular-nums">{counts[s.key].toLocaleString("en-US")}</dd>
              <dd className="mt-1 font-plex text-xs text-lightgray">{s.note}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 font-plex text-xs text-lightgray">Kane CLI usage on the team&apos;s TestMu AI orgs during the event, counted to {dateFmt.format(new Date(stats.window.to))}.</p>
      </div>
    </section>
  );
}

function Offline() {
  return (
    <div className="container-page py-24">
      <div role="status" className="flex flex-wrap items-center gap-3 border border-warning bg-warning-deep px-4 py-3 font-plex text-sm text-bright">
        <StatusPill tone="pending">Offline</StatusPill>
        <span>Ship pages are temporarily offline. Submissions are safe and unaffected.</span>
      </div>
    </div>
  );
}

/** Copyable run command, Devpost and launch posts: the submission fields the story doesn't carry. */
function SubmittedExtras({ extras }: { extras: SubmissionExtras | null }) {
  if (!extras) return null;
  return (
    <div className="space-y-3 border-t border-dashed border-hairline pt-8">
      <p className={eyebrow}>Also submitted</p>
      {extras.run_command && (
        <div>
          <p className="font-plex text-xs text-lightgray">Run it</p>
          <div className="mt-2 flex flex-wrap items-stretch gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto border border-hairline bg-surface px-4 py-3 font-mono text-xs text-bright">
              <code>{extras.run_command}</code>
            </pre>
            <CopyUrl url={extras.run_command} label="Copy command" />
          </div>
        </div>
      )}
      {extras.devpost_url && <ExtLink href={extras.devpost_url}>Devpost page</ExtLink>}
      {extras.social_links.map((u) => (
        <ExtLink key={u} href={u}>
          {postLabel(u)}
        </ExtLink>
      ))}
    </div>
  );
}

const postLabel = (u: string) => {
  const h = hostOf(u);
  if (h === "x.com" || h === "twitter.com") return "Launch post on X";
  if (h === "news.ycombinator.com") return "Hacker News post";
  if (h === "linkedin.com") return "LinkedIn post";
  return `Post · ${h}`;
};

const httpsOnly = (u: string | null | undefined) => (u && /^https:\/\/[^\s]+$/.test(u) ? u : undefined);

/** YouTube / Loom → privacy-friendly embed; a direct video file → <video>; anything else → a link. */
function videoOf(url: string | undefined, title: string): StageVideo | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const yt = host === "youtu.be" ? u.pathname.slice(1) : host.endsWith("youtube.com") ? (u.searchParams.get("v") ?? u.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1]) : null;
    if (yt && /^[\w-]{6,20}$/.test(yt)) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${yt}`, title };
    const loom = host === "loom.com" ? u.pathname.match(/\/share\/([\w]+)/)?.[1] : null;
    if (loom) return { kind: "iframe", src: `https://www.loom.com/embed/${loom}`, title };
    if (/\.(mp4|webm|mov)$/i.test(u.pathname)) return { kind: "file", src: url, title };
    return { kind: "link", src: url, title };
  } catch {
    return null;
  }
}

function RunPill({ r }: { r: EvidenceRun }) {
  if (r.confidence === "verified") return <StatusPill tone="verified">Verified · passed</StatusPill>;
  if (r.confidence === "detected") return <StatusPill tone="suspected">Suspected · {r.status}</StatusPill>;
  return <StatusPill tone="unverified">Participant reported · {r.status}</StatusPill>;
}

function ShipBody({ view, hasDeck, onePager }: { view: ShowcaseView; hasDeck: boolean; onePager: OnePagerEmbed }) {
  const { story: s, project, runs } = view;
  const slug = project.slug;
  const name = s.project_name;
  const shots = s.visuals
    .filter((v) => v.kind === "screenshot" && v.approved)
    .flatMap((v) => {
      const src = visualSrc(slug, project.id, v.source);
      return src ? [{ src, alt: v.alt_text || `${name} screenshot` }] : [];
    });
  const video = videoOf(s.visuals.find((v) => v.kind === "video" && v.approved)?.source, `${name} demo video`);
  const verifiedRuns = runs.filter((r) => r.confidence === "verified");
  const detections = runs.filter((r) => r.confidence === "detected");
  const linkProof = s.proof.filter((p) => !p.run_id);
  const commit = s.proof.find((p) => p.commit_sha)?.commit_sha ?? s.links.repo_commit?.split("/").pop() ?? null;
  const stages = s.harness.stages.length ? s.harness.stages : s.how_it_works.slice(0, 4);
  const typeLabel = PROJECT_TYPE_LABEL[s.creation_type as ProjectType] ?? s.creation_type;
  const url = siteUrl(`/ship/${slug}`);

  const proofPanel = (
    <div className="space-y-5">
      <p className={eyebrow}>Kane · proof view</p>
      {stages.length > 0 && (
        <ol className="flex flex-wrap items-center gap-2 font-plex text-xs" aria-label="Harness flow">
          {stages.map((st, n) => (
            <li key={n} className="flex items-center gap-2">
              <span className="border border-hairline bg-surface-2 px-3 py-2 text-bright">{st}</span>
              {n < stages.length - 1 && <span aria-hidden className="text-lightgray">→</span>}
            </li>
          ))}
        </ol>
      )}
      {runs.length ? (
        <ul className="divide-y divide-dashed divide-hairline border-y border-dashed border-hairline">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 font-plex text-sm">
              <span className="min-w-0 text-bright">{r.objective?.trim() || `Kane run ${r.upstream_execution_id}`}</span>
              <RunPill r={r} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-plex text-sm text-lightgray">No Kane runs were linked to this submission{linkProof.length ? "; the team linked evidence below (participant reported)." : "."}</p>
      )}
      <a href="#evidence" className="inline-flex min-h-11 items-center font-plex text-sm text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
        Full evidence timeline ↓
      </a>
    </div>
  );

  return (
    <article className="pb-16">
      {view.mode !== "public" && <ModeBanner view={view} />}

      {/* Utility bar */}
      <div className="border-b border-hairline">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-4">
          <Eyebrow>
            <Link href="/ship" className="hover:text-bright">
              Showcase
            </Link>{" "}
            / Made at {event.name}
          </Eyebrow>
          <CopyUrl url={url} />
        </div>
      </div>

      {/* Hero: name + media stage */}
      <section className="py-12 sm:py-16">
        <div className="container-page grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
          <div className="min-w-0">
            <p className={eyebrow}>{typeLabel}</p>
            <h1 className="mt-4 font-display text-[clamp(3.25rem,13vw,8.5rem)] leading-[0.85] font-bold tracking-[-0.06em] break-words text-bright">
              {name}
              <span aria-hidden className="ml-[0.04em] inline-block h-[0.16em] w-[0.16em] bg-lime align-baseline" />
            </h1>
            {s.one_line_pitch && <p className="mt-6 max-w-xl font-display text-2xl leading-snug tracking-[-0.02em] text-bright sm:text-3xl">{s.one_line_pitch}</p>}
            {s.what_we_built && <p className="mt-5 max-w-xl font-plex text-sm leading-relaxed text-lightgray">{clip(s.what_we_built, 320)}</p>}
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#proof" className="inline-flex min-h-11 items-center bg-bright px-4 font-plex text-sm text-ink transition-colors hover:bg-lime">
                See the proof →
              </a>
              {hasDeck && (
                <Link href={`/ship/${slug}/deck`} className="inline-flex min-h-11 items-center border border-hairline px-4 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime">
                  HTML deck →
                </Link>
              )}
              {s.links.demo && (
                <a href={s.links.demo} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center border border-hairline px-4 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime">
                  Live demo ↗
                </a>
              )}
            </div>
            <p className="mt-8 font-plex text-xs text-lightgray">
              {s.team.length ? `${s.team.length} ${s.team.length === 1 ? "builder" : "builders"} credited` : "Builders not named on request"}
              {view.finalizedAt && <> · submitted {dateFmt.format(new Date(view.finalizedAt))}</>}
            </p>
          </div>
          <div id="proof" className="min-w-0 scroll-mt-24">
            <Stage shots={shots} video={video} proof={proofPanel} projectName={name} />
          </div>
        </div>
      </section>

      {/* Four columns: product / harness / evidence / repo */}
      <section className="border-y border-hairline">
        <div className="container-page grid sm:grid-cols-2 lg:grid-cols-4">
          <Stat k="Product" v={typeLabel} sub={s.links.demo ? hostOf(s.links.demo) : "Run command in repo"} />
          <Stat k="Harness" v={s.harness.components.length ? `${s.harness.components.length} Kane ${s.harness.components.length === 1 ? "part" : "parts"}` : "—"} sub={s.harness.components.slice(0, 3).map(kaneComponentLabel).join(" · ") || "Not listed"} />
          <Stat
            k="Evidence"
            v={runs.length ? `${runs.length} ${runs.length === 1 ? "run" : "runs"}` : linkProof.length ? `${linkProof.length} ${linkProof.length === 1 ? "link" : "links"}` : "—"}
            sub={runs.length ? `${verifiedRuns.length} verified · ${detections.length} detected` : "Participant reported"}
          />
          <Stat k="Repo" v={commit ? commit.slice(0, 7) : "—"} sub={s.links.github ? s.links.github.replace(/^https:\/\/(www\.)?/, "") : "Not public"} href={httpsOnly(s.links.repo_commit) ?? httpsOnly(s.links.github)} mono />
        </div>
      </section>

      <OnePager embed={onePager} name={name} />

      {/* The creation */}
      {(s.problem || s.what_we_built || s.how_it_works.length > 0) && (
        <section className="py-16 sm:py-20">
          <div className="container-page grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div>
              <p className={eyebrow}>01 / The creation</p>
              <h2 className="mt-3 font-display text-4xl leading-[0.95] tracking-[-0.04em] text-bright sm:text-5xl">What it is, and why.</h2>
              {s.problem && <p className="mt-6 max-w-md font-plex text-sm leading-relaxed text-lightgray">{s.problem}</p>}
            </div>
            <div className="space-y-8">
              {s.what_we_built && <p className="font-plex text-sm leading-relaxed whitespace-pre-line text-bright sm:text-base">{s.what_we_built}</p>}
              {s.how_it_works.length > 0 && (
                <ol className="border-t border-dashed border-hairline">
                  {s.how_it_works.map((step, n) => (
                    <li key={n} className="flex gap-5 border-b border-dashed border-hairline py-4">
                      <span className="w-8 shrink-0 font-dots text-xl text-lightgray">{String(n + 1).padStart(2, "0")}</span>
                      <span className="font-plex text-sm text-bright">{step}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </section>
      )}

      {/* The harness */}
      <section className="border-t border-dashed border-hairline py-16 sm:py-20">
        <div className="container-page grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <p className={eyebrow}>02 / The harness</p>
            <h2 className="mt-3 font-display text-4xl leading-[0.95] tracking-[-0.04em] text-bright sm:text-5xl">How Kane checks it.</h2>
            {s.harness.summary && <p className="mt-6 max-w-md font-plex text-sm leading-relaxed whitespace-pre-line text-lightgray">{s.harness.summary}</p>}
            {s.harness.components.length > 0 && (
              <ul className="mt-6 flex flex-wrap gap-2" aria-label="Kane components used">
                {s.harness.components.map((c) => (
                  <li key={c} className="border border-hairline px-2 py-1 font-plex text-xs text-bright">
                    {kaneComponentLabel(c)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {stages.length > 0 ? (
            <ol className="brackets border border-hairline bg-surface p-5 sm:p-8">
              {stages.map((st, n) => (
                <li key={n} className="flex items-center gap-5 border-b border-dashed border-hairline py-4 last:border-0">
                  <span className="grid h-11 w-11 shrink-0 place-items-center border border-hairline font-dots text-lg text-bright">{String(n + 1).padStart(2, "0")}</span>
                  <span className="font-display text-xl tracking-[-0.02em] text-bright">{st}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="self-center font-plex text-sm text-lightgray">The team didn&apos;t break the harness into stages.</p>
          )}
        </div>
      </section>

      {/* Evidence timeline */}
      <section id="evidence" className="scroll-mt-24 border-t border-dashed border-hairline py-16 sm:py-20">
        <div className="container-page">
          <p className={eyebrow}>03 / Evidence</p>
          <h2 className="mt-3 font-display text-4xl leading-[0.95] tracking-[-0.04em] text-bright sm:text-5xl">What actually ran.</h2>
          <p className="mt-4 max-w-2xl font-plex text-xs leading-relaxed text-lightgray">
            Verified means a passing run reported through a paired, verified channel. A failing run is a detection, not a confirmed bug. Everything else is as the team reported it.
          </p>
          {runs.length > 0 || linkProof.length > 0 ? (
            <ol className="mt-8 border-l border-hairline">
              {runs.map((r) => (
                <li key={r.id} className="relative pb-8 pl-6 last:pb-0">
                  <span aria-hidden className={`absolute top-1.5 -left-[5px] h-[9px] w-[9px] ${r.confidence === "verified" ? "bg-verified" : "border border-lightgray bg-ink"}`} />
                  <div className="flex flex-wrap items-center gap-3">
                    <RunPill r={r} />
                    <span className="font-plex text-xs text-lightgray">{r.at ? dateFmt.format(new Date(r.at)) : "time not reported"}</span>
                  </div>
                  <p className="mt-2 font-plex text-sm text-bright">{r.objective?.trim() || `Kane run ${r.upstream_execution_id}`}</p>
                  <p className="mt-1 font-mono text-xs break-all text-lightgray">
                    {r.source} · {r.upstream_execution_id}
                    {r.exit_code !== null && ` · exit ${r.exit_code}`}
                    {r.commit_sha && ` · ${r.commit_sha.slice(0, 7)}`}
                  </p>
                  {r.report_url?.startsWith("https://") && (
                    <a href={r.report_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center font-plex text-xs text-bright underline underline-offset-4 hover:text-lime">
                      Run report ↗
                    </a>
                  )}
                </li>
              ))}
              {linkProof.map((p) => (
                <li key={p.source} className="relative pb-8 pl-6 last:pb-0">
                  <span aria-hidden className="absolute top-1.5 -left-[5px] h-[9px] w-[9px] border border-lightgray bg-ink" />
                  <StatusPill tone="unverified">Participant reported</StatusPill>
                  {/* Studio proof.source is free text: only an https URL becomes a link. */}
                  {httpsOnly(p.source) ? (
                    <a href={p.source} target="_blank" rel="noopener noreferrer" className="mt-2 block font-mono text-xs break-all text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                      {p.source}
                    </a>
                  ) : (
                    <p className="mt-2 font-mono text-xs break-all text-lightgray">{p.source}</p>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-8 font-plex text-sm text-lightgray">No evidence linked.</p>
          )}
        </div>
      </section>

      {/* Outcome */}
      {(s.impact.length > 0 || s.limitations.length > 0) && (
        <section className="border-t border-dashed border-hairline py-16 sm:py-20">
          <div className="container-page grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className={eyebrow}>04 / Outcome</p>
              <h2 className="mt-3 font-display text-4xl leading-[0.95] tracking-[-0.04em] text-bright sm:text-5xl">What changed.</h2>
              {s.impact.length ? (
                <ul className="mt-8 space-y-6">
                  {s.impact.map((m, n) => (
                    <li key={n} className="border-t border-dashed border-hairline pt-4">
                      {m.measure !== null && m.source ? (
                        <p className="font-dots text-5xl leading-none font-black text-bright">
                          {m.measure}
                          {m.unit && <span className="ml-2 font-plex text-base font-normal text-lightgray">{m.unit}</span>}
                        </p>
                      ) : (
                        <StatusPill tone="unverified">Qualitative</StatusPill>
                      )}
                      <p className="mt-2 font-plex text-sm text-bright">{m.claim}</p>
                      {m.baseline !== null && m.source && (
                        <p className="mt-1 font-plex text-xs text-lightgray">
                          Baseline {m.baseline}
                          {m.unit ? ` ${m.unit}` : ""}
                        </p>
                      )}
                      {m.source && <p className="mt-1 font-plex text-xs break-words text-lightgray">Source: {m.source} (team reported)</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-6 font-plex text-sm text-lightgray">No measured outcomes were claimed.</p>
              )}
            </div>
            {s.limitations.length > 0 && (
              <div>
                <p className={eyebrow}>Known limitations</p>
                <ul className="mt-4 space-y-3 border-t border-dashed border-hairline pt-4">
                  {s.limitations.map((l, n) => (
                    <li key={n} className="flex gap-3 font-plex text-sm text-bright">
                      <span aria-hidden className="text-lightgray">—</span>
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Team and links */}
      <section className="border-t border-dashed border-hairline py-16 sm:py-20">
        <div className="container-page grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end">
          <div>
            <p className={eyebrow}>05 / Ship it forward</p>
            <h2 className="mt-3 font-display text-[clamp(2.5rem,7vw,4.75rem)] leading-[0.95] tracking-[-0.05em] text-bright">
              The code. <span className="font-dots font-black text-lime">The proof.</span>
              <br />
              The story.
            </h2>
            {s.team.length > 0 && (
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2" aria-label="Team">
                {s.team.map((t) => (
                  <li key={t.display_name} className="font-plex text-sm text-bright">
                    {t.display_name}
                    {t.handle && <span className="ml-2 text-xs text-lightgray">{t.handle}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-3">
            {hasDeck && (
              <Link href={`/ship/${slug}/deck`} className="flex min-h-11 items-center justify-between border border-hairline px-4 py-3 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime">
                Present the HTML deck <span aria-hidden>→</span>
              </Link>
            )}
            {httpsOnly(s.links.github) && <ExtLink href={s.links.github!}>Repository</ExtLink>}
            {httpsOnly(s.links.repo_commit) && <ExtLink href={s.links.repo_commit!}>Submitted commit</ExtLink>}
            {httpsOnly(s.links.demo) && <ExtLink href={s.links.demo!}>Live demo</ExtLink>}
            <SubmittedExtras extras={view.extras} />
          </div>
        </div>
      </section>

      <footer className="container-page flex flex-wrap items-end justify-between gap-6 border-t border-hairline pt-6">
        <p className="font-plex text-xs text-lightgray">
          {verifiedRuns.length > 0 ? "Validated with Kane CLI · TestMu AI" : `Made at ${event.name}`}
          {view.storyVersion ? ` · story v${view.storyVersion}` : ""}
        </p>
        <Image src="/logos/testmu-ai.svg" alt="TestMu AI" width={129} height={20} unoptimized className="h-5 w-auto opacity-80" />
      </footer>
    </article>
  );
}

function ModeBanner({ view }: { view: ShowcaseView }) {
  const m = view.mode;
  const text =
    m === "hidden_by_moderation"
      ? "Hidden by organizers. Only your team and organizers can see this page."
      : view.preview
        ? "Draft preview from your saved submission. Nobody else can see this until you finalize."
        : m === "draft"
          ? "Off. Only your team and organizers can see this page. Change it on the Submit tab."
          : "Unlisted. Anyone with the link can see it; it isn't in the gallery.";
  return (
    <div className="border-b border-warning bg-warning-deep">
      <div className="container-page flex flex-wrap items-center gap-3 py-3 font-plex text-xs text-bright">
        {m === "hidden_by_moderation" ? <StatusPill tone="danger">Hidden by moderation</StatusPill> : <StatusPill tone="pending">{view.preview ? "Draft preview" : m}</StatusPill>}
        <span>{text}</span>
      </div>
    </div>
  );
}

function Stat({ k, v, sub, href, mono }: { k: string; v: string; sub: string; href?: string; mono?: boolean }) {
  const body = (
    <>
      <p className={eyebrow}>{k}</p>
      <p className={`mt-3 text-2xl text-bright ${mono ? "font-mono" : "font-display tracking-[-0.03em]"}`}>{v}</p>
      <p className="mt-2 font-plex text-xs break-words text-lightgray">{sub}</p>
    </>
  );
  const cls = "block border-b border-hairline py-6 last:border-b-0 sm:px-5 sm:odd:border-r lg:border-b-0 lg:border-r lg:first:pl-0 lg:last:border-r-0";
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${cls} transition-colors hover:bg-surface`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-between border border-hairline px-4 py-3 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime">
      {children} <span aria-hidden>↗</span>
    </a>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

type OnePagerEmbed = Awaited<ReturnType<typeof onePagerEmbed>>;

/** The team's one-pager in a sandboxed frame (opaque origin, scripts only), with a direct link. */
function OnePager({ embed, name }: { embed: OnePagerEmbed; name: string }) {
  if (!embed) return null;
  return (
    <section id="one-pager" className="border-b border-hairline py-12 sm:py-16">
      <div className="container-page">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={eyebrow}>One-pager · by the team</p>
          <a href={embed.src} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-plex text-sm text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
            Open the one-pager ↗
          </a>
        </div>
        {!embed.public && <p className="mt-2 font-plex text-xs text-lightgray">Only your team and staff see this version. Visitors see it after a teammate publishes the Ship Page.</p>}
        <iframe src={embed.src} title={`${name} one-pager`} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" className="mt-6 block h-[80vh] w-full border border-hairline bg-card" />
      </div>
    </section>
  );
}
