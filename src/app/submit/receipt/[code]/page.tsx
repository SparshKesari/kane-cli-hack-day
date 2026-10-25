import type { Metadata } from "next";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import StatusPill from "@/components/ui/StatusPill";
import { Eyebrow } from "@/components/ui/Section";
import { event } from "@/data/hackday";
import { AppError } from "@/server/core";
import { PROJECT_TYPE_LABEL, type ProjectType } from "@/server/showcase";
import { getReceipt, kaneComponentLabel, type ReceiptView, type SubmissionDraft } from "@/server/submission";
import { PrintButton, VerifyButton } from "./Verify";

// An immutable receipt: what was frozen, when (server time), its hash and
// signature. Visible to the team, judges and organizers; anyone else gets 404.
// Prints ink-on-paper for the binder.

export const metadata: Metadata = { title: "Submission receipt", robots: { index: false } };

export default function ReceiptPage({ params }: PageProps<"/submit/receipt/[code]">) {
  return (
    <main className="py-12 sm:py-16">
      <div className="container-page max-w-4xl">
        <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading receipt…</p>}>
          <Receipt params={params} />
        </Suspense>
      </div>
    </main>
  );
}

const when = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: event.timezone, timeZoneName: "short" });
const fmt = (d: string | Date | null | undefined) => (d ? when.format(new Date(d)) : "—");

type Snapshot = {
  source?: string;
  team?: { name?: string; slug?: string };
  submitted_by?: { name?: string; public_code?: string | null };
  locks_at?: string;
  recorded_at?: string;
  received_after_lock?: boolean;
  submitter?: string;
  officer?: { name?: string };
  evidence?: { run_id: number; status: string; source: string; source_verified: boolean; upstream_execution_id: string; commit_sha: string | null }[];
  prize?: { shipped_minimum?: boolean; progress_done?: string[] };
  pins?: { story_version?: number | null; deck_version?: number | null };
  preflight?: { uncertain?: string[]; github?: string | null };
  submission?: Partial<SubmissionDraft> & { artifact_hash?: string | null; harness?: string; caveats?: string | null; evidence_refs?: string | string[] | null };
};

/** A manual backup receipt (recovery.ts insertManualReceipt) is frozen flat, not under `submission`. */
type ManualSnapshot = {
  project?: { name?: string };
  repo_url?: string | null;
  commit_sha?: string | null;
  artifact_sha256?: string | null;
  live_url?: string | null;
  harness?: string | null;
  evidence?: string | null;
  caveats?: string | null;
  lock_at?: string;
};

/** The manual snapshot read as the fields an online receipt shows. */
function manualDraft(m: ManualSnapshot): NonNullable<Snapshot["submission"]> {
  return {
    project_name: m.project?.name,
    repo_url: m.repo_url ?? undefined,
    commit_sha: m.commit_sha ?? undefined,
    artifact_hash: m.artifact_sha256,
    demo_url: m.live_url ?? undefined,
    harness: m.harness ?? undefined,
    caveats: m.caveats,
    evidence_refs: m.evidence ? [m.evidence] : undefined,
  };
}

async function Receipt({ params }: { params: PageProps<"/submit/receipt/[code]">["params"] }) {
  const { code } = await params;
  let r: ReceiptView;
  try {
    r = await getReceipt(code);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "UNAUTHENTICATED" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  if (r.limited) {
    return (
      <article className="print-paper space-y-6">
        <header className="border-b border-dashed border-hairline pb-8">
          <Eyebrow>Official submission receipt</Eyebrow>
          <h1 className="mt-4 font-dots text-6xl leading-none font-black text-bright sm:text-7xl">{r.code}</h1>
          <p className="mt-4 font-display text-2xl text-bright">{r.team.name}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="border border-bright px-2 py-0.5 font-pixel text-[10px] uppercase tracking-[0.2em] text-bright">{r.status}</span>
            {r.signature ? <StatusPill tone="verified">Verified · signed</StatusPill> : <StatusPill tone="unverified">Unsigned</StatusPill>}
          </div>
        </header>
        <Block title="Timing (server clock)">
          <Row k="Finalized" v={fmt(r.finalizedAt)} />
        </Block>
        <p className="font-plex text-sm text-lightgray">
          Your submission is in. To see what was submitted, sign in as a member of this team on{" "}
          <Link href={`/t/${r.team.slug}/submit`} className="text-bright underline underline-offset-4 hover:text-lime">
            your Submit tab
          </Link>
          , then open this receipt again.
        </p>
      </article>
    );
  }
  const manual = r.source === "manual_offline";
  const raw = r.snapshot as Snapshot & ManualSnapshot;
  // Manual receipts keep evidence as staff-typed text and the lock as lock_at.
  const s: Snapshot = manual ? { ...raw, evidence: undefined, locks_at: raw.locks_at ?? raw.lock_at } : raw;
  const d = manual ? manualDraft(raw) : (s.submission ?? {});
  const refs = Array.isArray(d.evidence_refs) ? d.evidence_refs : d.evidence_refs ? [d.evidence_refs] : [];

  return (
    <article className="print-paper space-y-10">
      <header className="border-b border-dashed border-hairline pb-8">
        <Eyebrow>Official submission receipt{manual ? " · manual backup" : ""}</Eyebrow>
        <h1 className="mt-4 font-dots text-6xl leading-none font-black text-bright sm:text-7xl">{r.code}</h1>
        <p className="mt-4 font-display text-2xl text-bright">{r.team.name}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="border border-bright px-2 py-0.5 font-pixel text-[10px] uppercase tracking-[0.2em] text-bright">{r.status}</span>
          {r.signature ? <StatusPill tone="verified">Verified · signed</StatusPill> : <StatusPill tone="unverified">Unsigned</StatusPill>}
          {manual && s.received_after_lock && <StatusPill tone="pending">Received after lock · escalate</StatusPill>}
        </div>
      </header>

      <Block title="Timing (server clock)">
        <Row k={manual ? "Recorded by staff" : "Finalized"} v={fmt(r.finalizedAt)} />
        {manual && <Row k="Actually received" v={fmt(r.receivedAt)} />}
        <Row k="Official lock" v={fmt(s.locks_at)} />
        {!manual && s.submitted_by && <Row k="Confirmed by" v={`${s.submitted_by.name ?? "—"}${s.submitted_by.public_code ? ` (${s.submitted_by.public_code})` : ""}`} />}
        {manual && (
          <>
            <Row k="Submitted by" v={s.submitter ?? "—"} />
            <Row k="Officer" v={r.officer ?? s.officer?.name ?? "—"} />
            <Row k="Witness" v={r.witness ?? "—"} />
            <Row k="Incident" v={r.incidentRef ?? "—"} />
          </>
        )}
      </Block>

      <Block title="What was submitted">
        <Row k="Project" v={d.project_name ?? "—"} />
        <Row k="Type" v={d.project_type ? (PROJECT_TYPE_LABEL[d.project_type as ProjectType] ?? d.project_type) : "—"} />
        {d.one_line_pitch && <Row k="Pitch" v={d.one_line_pitch} />}
        {d.project_description && <Row k="Description" v={d.project_description} />}
        <Row k="Repository" v={d.repo_url ?? "—"} mono />
        {d.commit_sha && <Row k="Commit SHA" v={d.commit_sha} mono />}
        {d.artifact_hash && <Row k="Archive SHA-256" v={d.artifact_hash} mono />}
        {d.demo_url && <Row k="Live demo" v={d.demo_url} mono />}
        {d.run_command && <Row k="Run command" v={d.run_command} mono />}
        {(d.harness_summary ?? d.harness) && <Row k="Harness" v={(d.harness_summary ?? d.harness)!} />}
        {d.showcase_url && <Row k="Showcase page" v={d.showcase_url} mono />}
        {d.linkedin_posts?.length ? <Row k="LinkedIn" v={d.linkedin_posts.join(", ")} mono /> : null}
        {d.x_posts?.length ? <Row k="X" v={d.x_posts.join(", ")} mono /> : null}
        {d.blog_links?.length ? <Row k="Blog" v={d.blog_links.join(", ")} mono /> : null}
        {d.deck_url && <Row k="Deck" v={d.deck_url} mono />}
        {d.hn_url && <Row k="Hacker News" v={d.hn_url} mono />}
        {d.kane_components?.length ? <Row k="Kane components" v={d.kane_components.map(kaneComponentLabel).join(", ")} /> : null}
        {d.limitations?.length ? <Row k="Limitations" v={d.limitations.join(" · ")} /> : null}
        {d.caveats && <Row k="Caveats" v={d.caveats} />}
        {d.video_url && <Row k="Demo video" v={d.video_url} mono />}
        {d.screenshots?.length ? <Row k="Screenshots" v={`${d.screenshots.length} attached`} /> : null}
        {d.devpost_url && <Row k="Devpost" v={d.devpost_url} mono />}
      </Block>

      <Block title="Evidence">
        {s.evidence?.length ? (
          <ul className="space-y-2">
            {s.evidence.map((e) => (
              <li key={e.run_id} className="flex flex-wrap items-center gap-2 font-plex text-sm text-bright">
                {e.status === "passed" && e.source_verified ? (
                  <StatusPill tone="verified">Verified pass</StatusPill>
                ) : e.status === "failed" || e.status === "errored" || e.status === "blocked" ? (
                  <StatusPill tone="suspected">Suspected · {e.status}</StatusPill>
                ) : (
                  <StatusPill tone="unverified">Reported · {e.status}</StatusPill>
                )}
                <span className="font-mono text-xs">
                  run {e.run_id} · {e.source} · {e.upstream_execution_id}
                  {e.commit_sha ? ` · ${e.commit_sha.slice(0, 7)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {refs.length ? (
          <ul className="mt-2 space-y-1">
            {refs.map((u) => (
              <li key={u} className="font-mono text-xs break-all text-lightgray">
                {u} <span className="font-plex">(participant reported)</span>
              </li>
            ))}
          </ul>
        ) : null}
        {!s.evidence?.length && !refs.length && <p className="font-plex text-sm text-lightgray">No evidence references.</p>}
        {s.preflight?.uncertain?.length ? <p className="mt-3 font-plex text-xs text-lightgray">Uncertain at finalize: {s.preflight.uncertain.join(", ")}.</p> : null}
      </Block>

      {!manual && (
        <Block title="Prize eligibility (separate from the submission)">
          <Row k="Shipped minimum" v={s.prize?.shipped_minimum ? "Met at finalize" : "Not met at finalize"} />
          <Row k="Checklist items done" v={s.prize?.progress_done?.join(", ") || "—"} />
          <Row k="Pinned showcase story" v={s.pins?.story_version ? `version ${s.pins.story_version}` : "—"} />
          <Row k="Pinned deck" v={s.pins?.deck_version ? `version ${s.pins.deck_version}` : "none approved at finalize"} />
        </Block>
      )}

      <Block title="Integrity">
        <Row k="Snapshot SHA-256" v={r.snapshotSha256} mono />
        <Row k="Signature" v={r.signature ?? "unsigned"} mono />
        <div className="no-print flex flex-wrap gap-3 pt-2">
          <VerifyButton code={r.code} />
        </div>
      </Block>

      <footer className="no-print flex flex-wrap gap-3 border-t border-dashed border-hairline pt-6">
        <a href={`/submit/receipt/${r.code}/json`} className="inline-flex min-h-11 items-center bg-bright px-4 font-plex text-sm text-ink hover:bg-lime">
          Download JSON
        </a>
        <PrintButton />
        <Link href={`/ship/${r.projectSlug}`} className="inline-flex min-h-11 items-center px-2 font-plex text-sm text-lightgray hover:text-bright">
          Showcase page →
        </Link>
      </footer>
      {manual && (
        <p className="font-plex text-xs text-lightgray">
          This receipt confirms receipt at the time recorded above. It does not yet prove reconciliation to the online submission system. Keep your copy and unchanged artifacts.
        </p>
      )}
    </article>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="print-avoid-break">
      <h2 className="mb-3 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <dl className="grid gap-1 font-plex text-sm sm:grid-cols-[13rem_minmax(0,1fr)]">
      <dt className="text-lightgray">{k}</dt>
      <dd className={`min-w-0 break-words text-bright ${mono ? "font-mono text-xs leading-6 break-all" : ""}`}>{v}</dd>
    </dl>
  );
}
