import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Eyebrow } from "@/components/ui/Section";
import StatusPill from "@/components/ui/StatusPill";
import { judging } from "@/data/hackday";
import { getStaff, hasRole } from "@/server/auth";
import { AppError } from "@/server/core";
import { ROUNDS, getInspector, getJudgingState, getMyScores, isFinal, isRound, type Inspector, type Round, type ScoreRow } from "@/server/judging";
import { Panel, Pill, StaffGate, Tag, defectPill, label, milestonePill, runPill, when } from "../parts";
import ScoreForm from "./ScoreForm";

export const metadata: Metadata = { title: "Judge · Inspect", robots: { index: false } };

// Proof inspector + rubric for one submission. Left: what the team actually
// submitted and what backs it (receipt, Kane runs, judge-visible evidence,
// milestones, detections). Right: this judge's score for the chosen round.

export default function InspectPage({ params, searchParams }: PageProps<"/judge/[id]">) {
  return (
    <main className="container-page py-10 sm:py-14">
      <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading…</p>}>
        <InspectView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function InspectView({ params, searchParams }: Pick<PageProps<"/judge/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const sp = await searchParams;
  const staff = await getStaff();
  if (!hasRole(staff, "judge", "organizer")) return <StaffGate role="judge" next={`/judge/${id}`} signedIn={!!staff} />;

  const submissionId = Number(id);
  if (!Number.isInteger(submissionId) || submissionId <= 0) notFound();
  let data: Inspector;
  try {
    data = await getInspector(submissionId);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const final = isFinal(data.submission.status);
  const round: Round = isRound(sp.round) ? sp.round : final ? "final" : "mid";
  const [mine, state] = await Promise.all([getMyScores(submissionId, staff!.id), getJudgingState()]);
  const score = mine[round];

  return (
    <div className="space-y-8">
      <div>
        <Link href="/judge" className="inline-flex min-h-11 items-center font-plex text-xs text-lightgray hover:text-lime">
          ← All teams
        </Link>
        <Eyebrow className="mt-2">
          {data.team.table_label ? `Table ${data.team.table_label} · ` : ""}
          {data.project.project_type.replace("_", " ")}
        </Eyebrow>
        <h1 className="mt-3 font-display text-4xl leading-tight font-semibold text-bright sm:text-5xl">
          {data.team.name}
          <span className="text-lime" aria-hidden="true">
            .
          </span>
        </h1>
        <p className="mt-2 font-plex text-sm text-lightgray">
          {data.project.name}
          {data.team.members.length > 0 && ` · ${data.team.members.join(", ")}`}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <ProofColumn data={data} final={final} />

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="Round" className="grid grid-cols-3 gap-px border border-hairline bg-hairline">
            {(Object.keys(ROUNDS) as Round[]).map((r) => {
              const disabled = r === "stage" && !final;
              const active = r === round;
              const cls = `flex min-h-11 items-center justify-center px-2 text-center font-plex text-xs ${
                active ? "bg-lime-deep text-lime" : disabled ? "bg-ink text-lightgray/50" : "bg-ink text-bright hover:text-lime"
              }`;
              return disabled ? (
                <span key={r} className={cls} aria-disabled="true">
                  {ROUNDS[r].label}
                </span>
              ) : (
                <Link key={r} href={`/judge/${submissionId}?round=${r}`} aria-current={active ? "page" : undefined} className={cls}>
                  {ROUNDS[r].label}
                </Link>
              );
            })}
          </nav>
          <p className="font-plex text-xs text-lightgray">{ROUNDS[round].note}</p>

          {staff!.id == null ? (
            <p className="border-l-2 border-warning bg-warning-deep px-4 py-3 font-plex text-sm text-bright">
              Signed in with the admin password. Scores need a named judge account.
            </p>
          ) : score?.frozen ? (
            <CommittedScore score={score} />
          ) : state.locked ? (
            <p className="border-l-2 border-warning bg-warning-deep px-4 py-3 font-plex text-sm text-bright">
              Judging is locked ({when(state.locked.at)}). Scores can no longer change.
            </p>
          ) : (
            <ScoreForm
              key={`${submissionId}-${round}`}
              submissionId={submissionId}
              round={round}
              scored={ROUNDS[round].scored}
              saved={
                score
                  ? {
                      anchors: Object.fromEntries(Object.entries(score.category_scores).map(([k, v]) => [k, v.anchor])),
                      evidence: Object.fromEntries(Object.entries(score.category_scores).map(([k, v]) => [k, v.evidence])),
                      comments: score.comments,
                      uncertainty: score.uncertainty,
                    }
                  : null
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CommittedScore({ score }: { score: ScoreRow }) {
  const scored = ROUNDS[score.round].scored;
  return (
    <div className="space-y-4 border border-hairline p-4">
      <p className="font-plex text-sm text-bright">
        Committed {when(score.committed_at)}. Frozen: this score can&apos;t change.
      </p>
      {scored && (
        <>
          <ul className="divide-y divide-dashed divide-hairline">
            {judging.rubric.map((r) => {
              const c = score.category_scores[r.key];
              return (
                <li key={r.key} className="py-2">
                  <div className="flex items-baseline justify-between gap-3 font-plex text-sm">
                    <span className="text-bright">{r.name}</span>
                    <span className="shrink-0 text-bright">
                      {c?.anchor ?? "—"} · {c?.points ?? "—"}/{r.points}
                    </span>
                  </div>
                  {c?.evidence && <p className="mt-1 font-plex text-xs text-lightgray">{c.evidence}</p>}
                </li>
              );
            })}
          </ul>
          <p className="text-right font-dots text-4xl leading-none font-black text-bright">{score.total !== null ? Number(score.total) : "—"}</p>
        </>
      )}
      {score.comments && <p className="font-plex text-sm whitespace-pre-wrap text-lightgray">{score.comments}</p>}
      {score.uncertainty && (
        <p className="font-plex text-xs whitespace-pre-wrap text-lightgray">
          <span className={label}>Couldn&apos;t verify · </span>
          {score.uncertainty}
        </p>
      )}
    </div>
  );
}

const SNAPSHOT_LABELS: Record<string, string> = {
  repo_url: "Repository",
  commit_sha: "Commit",
  live_url: "Live demo",
  run_command: "Run command",
  demo_url: "Demo",
  video_url: "Video",
  devpost_url: "Devpost",
  project_type: "Project type",
  harness: "Harness architecture",
  harness_architecture: "Harness architecture",
  kane_components: "Kane components",
  evidence_ids: "Evidence ids",
  limitations: "Limitations",
  project_description: "Description",
  showcase_url: "Showcase page",
  linkedin_posts: "LinkedIn posts",
  x_posts: "X posts",
  blog_links: "Blog",
  deck_url: "Deck",
  hn_url: "Hacker News",
};

function value(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ");
  return JSON.stringify(v);
}

const isHttps = (v: unknown): v is string => typeof v === "string" && /^https:\/\/[^\s]+$/.test(v);

function ProofColumn({ data, final }: { data: Inspector; final: boolean }) {
  const s = data.submission;
  const entries = Object.entries(s.snapshot);
  return (
    <div className="space-y-6">
      <Panel
        title="Receipt"
        aside={final ? <Tag strong>{s.status.replace("_", " ")}</Tag> : <StatusPill tone="unverified">Not final · {s.status.replace("_", " ")}</StatusPill>}
      >
        <dl className="grid gap-x-6 gap-y-3 font-plex text-sm sm:grid-cols-2">
          <div>
            <dt className={label}>Receipt</dt>
            <dd className="mt-1 font-dots text-2xl leading-none font-black text-bright">{s.receipt_code ?? "—"}</dd>
          </div>
          <div>
            <dt className={label}>Finalized (server time)</dt>
            <dd className="mt-1 text-bright">{when(s.finalized_at)}</dd>
          </div>
          <div>
            <dt className={label}>Source</dt>
            <dd className="mt-1 text-bright">
              {s.source.replace("_", " ")}
              {s.received_at && <span className="block text-xs text-lightgray">received {when(s.received_at)}</span>}
            </dd>
          </div>
          <div>
            <dt className={label}>Signature</dt>
            <dd className="mt-1 text-bright">{s.signed ? "Signed snapshot" : "Unsigned"}</dd>
          </div>
          {s.snapshot_sha256 && (
            <div className="sm:col-span-2">
              <dt className={label}>Snapshot sha256</dt>
              <dd className="mt-1 font-plex text-xs break-all text-lightgray">{s.snapshot_sha256}</dd>
            </div>
          )}
          {(s.incident_ref || s.exception_ref) && (
            <div className="sm:col-span-2">
              <dt className={label}>Exception / incident</dt>
              <dd className="mt-1 text-bright">{[s.exception_ref, s.incident_ref].filter(Boolean).join(" · ")}</dd>
            </div>
          )}
        </dl>
      </Panel>

      <Panel title={final ? "Submitted snapshot" : "Current draft · not final"}>
        {entries.length ? (
          <dl className="space-y-3 font-plex text-sm">
            {entries.map(([k, v]) => (
              <div key={k}>
                <dt className={label}>{SNAPSHOT_LABELS[k] ?? k.replace(/_/g, " ")}</dt>
                <dd className="mt-1 break-words whitespace-pre-wrap text-bright">
                  {isHttps(v) ? (
                    <a href={v} target="_blank" rel="noreferrer noopener" className="underline decoration-hairline underline-offset-4 hover:text-lime">
                      {v}
                    </a>
                  ) : (
                    value(v)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="font-plex text-sm text-lightgray">Nothing in the {final ? "snapshot" : "draft"} yet.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-dashed border-hairline pt-4">
          {data.project.showcase_state === "public" || data.project.showcase_state === "unlisted" ? (
            <Link href={`/ship/${data.project.slug}`} className="inline-flex min-h-11 items-center border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime">
              Ship page /ship/{data.project.slug} →
            </Link>
          ) : (
            <span className="inline-flex min-h-11 items-center font-plex text-xs text-lightgray">Ship page: {data.project.showcase_state.replace(/_/g, " ")}</span>
          )}
          {isHttps(data.project.repo_url) && (
            <a href={data.project.repo_url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime">
              Repository ↗
            </a>
          )}
          {isHttps(data.project.live_url) && (
            <a href={data.project.live_url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime">
              Live demo ↗
            </a>
          )}
        </div>
      </Panel>

      <Panel title={`Kane runs · ${data.runs.length}`} aside={<span className="font-plex text-[11px] text-lightgray">A failing run is a detection, not a confirmed bug.</span>}>
        {data.runs.length ? (
          <ul className="divide-y divide-dashed divide-hairline">
            {data.runs.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill p={runPill(r)} />
                  <span className="font-plex text-xs text-lightgray">
                    run #{r.id} · {r.source.replace("_", " ")} · exit {r.exit_code ?? "—"} · {when(r.finished_at ?? r.received_at)}
                  </span>
                </div>
                {r.objective && <p className="mt-1 font-plex text-sm text-bright">{r.objective}</p>}
                <p className="mt-1 font-plex text-xs break-all text-lightgray">
                  {r.commit_sha ? `commit ${r.commit_sha.slice(0, 12)}` : "no commit"}
                  {!r.has_terminal_event && " · no terminal event"}
                  {` · ${r.verification_state.replace("_", " ")}`}
                  {summaryLine(r.summary)}
                </p>
                {isHttps(r.report_url) && (
                  <a href={r.report_url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex min-h-11 items-center font-plex text-xs text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                    Run report ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-plex text-sm text-lightgray">No Kane runs reported. Anything claimed about testing is unverified.</p>
        )}
      </Panel>

      <Panel title={`Evidence · ${data.evidence.length}`} aside={<span className="font-plex text-[11px] text-lightgray">Judge-visible only</span>}>
        {data.evidence.length ? (
          <ul className="divide-y divide-dashed divide-hairline">
            {data.evidence.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    {e.verified_at ? <StatusPill tone="verified">Verified</StatusPill> : <StatusPill tone="unverified" />}
                    <span className="font-plex text-sm text-bright">
                      #{e.id} · {e.kind}
                    </span>
                  </span>
                  <span className="mt-1 block font-plex text-xs break-all text-lightgray">
                    sha256 {e.sha256.slice(0, 16)}… · {e.size_bytes != null ? `${Math.ceil(e.size_bytes / 1024)} KB` : "size —"}
                    {e.source_run_id && ` · run #${e.source_run_id}`} · {e.redaction_state}
                  </span>
                </span>
                <a href={`/judge/evidence/${e.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime">
                  Open ↗
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-plex text-sm text-lightgray">No evidence shared with judges.</p>
        )}
      </Panel>

      <Panel title={`Milestones · ${data.milestones.length}`}>
        {data.milestones.length ? (
          <ul className="divide-y divide-dashed divide-hairline">
            {data.milestones.map((m) => (
              <li key={m.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill p={milestonePill(m.confidence)} />
                  <span className="font-plex text-sm text-bright">{m.title}</span>
                </div>
                <p className="mt-1 font-plex text-xs text-lightgray">
                  {m.claim}
                  {m.source_run_id && ` · run #${m.source_run_id}`}
                  {m.evidence_id && ` · evidence #${m.evidence_id}`}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-plex text-sm text-lightgray">No milestones shared with judges.</p>
        )}
      </Panel>

      <Panel title={`Detections · ${data.defects.length}`}>
        {data.defects.length ? (
          <ul className="divide-y divide-dashed divide-hairline">
            {data.defects.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                <Pill p={defectPill(d.status)} />
                <span className="font-plex text-sm text-bright">{d.title}</span>
                <span className="font-plex text-xs text-lightgray">
                  {d.failure_class}
                  {d.source_run_id && ` · run #${d.source_run_id}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-plex text-sm text-lightgray">No detections recorded.</p>
        )}
      </Panel>
    </div>
  );
}

function summaryLine(s: Record<string, unknown>) {
  const n = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : null);
  const parts = [
    n("passed") !== null && `${n("passed")} passed`,
    n("failed") !== null && `${n("failed")} failed`,
    n("blocked") !== null && `${n("blocked")} blocked`,
    n("total") !== null && `${n("total")} total`,
  ].filter(Boolean);
  return parts.length ? ` · ${parts.join(", ")}` : "";
}
