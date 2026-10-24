import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import FreshnessStamp from "@/components/ui/FreshnessStamp";
import PageHeader from "@/components/ui/PageHeader";
import StatusPill from "@/components/ui/StatusPill";
import { judging } from "@/data/hackday";
import { getStaff, hasRole } from "@/server/auth";
import { serverNow } from "@/server/core";
import { AWARD_OPTIONS, DEMO_SLOTS, LOCK_PHRASE, getAggregate, getDemoQueue, getJudgingState, isFinal } from "@/server/judging";
import { AdminLogin } from "../parts";
import { removeAwardAction } from "./actions";
import { AwardForm, DemoQueueForm, LockForm, ReopenForm } from "./parts";

export const metadata: Metadata = { title: "Judging", robots: { index: false } };

// Organizer view of judging: aggregate of committed scores, the demo queue,
// the judge lock and awards (only after the lock), plus CSV export.

export default function OpsJudgingPage() {
  return (
    <main>
      <PageHeader eyebrow="Ops · Judging" dim="Committed scores," bright="Human decisions." />
      <section className="py-12 sm:py-16">
        <div className="container-page">
          <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading…</p>}>
            <JudgingView />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

const label = "mb-3 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray";
const fmt = (n: number | null) => (n === null ? "—" : String(n));

async function JudgingView() {
  const staff = await getStaff();
  if (!hasRole(staff, "organizer")) return staff ? <p className="font-plex text-sm text-lightgray">Organizers only.</p> : <AdminLogin next="/ops/judging" />;

  const [{ rows }, state, demo, now] = await Promise.all([getAggregate(), getJudgingState(), getDemoQueue(), serverNow()]);
  const drafts = rows.reduce((n, r) => n + r.drafts, 0);
  const finals = rows.filter((r) => isFinal(r.status));
  const options = finals.map((r) => ({ id: r.submission_id, label: `${r.team_name} · ${r.receipt_code ?? "no receipt"}` }));
  const byId = new Map(rows.map((r) => [r.submission_id, r]));

  return (
    <div className="space-y-14">
      <div className="flex flex-wrap items-center gap-3">
        {state.locked ? <StatusPill tone="pending">Locked</StatusPill> : <StatusPill tone="accent">Open</StatusPill>}
        <p className="font-plex text-sm text-lightgray">
          {state.locked ? `Locked by ${state.locked.by}.` : "Judges can save and commit scores."} {drafts} uncommitted draft{drafts === 1 ? "" : "s"}.
        </p>
        <FreshnessStamp asOf={now} now={now} source="judge_scores" />
        <span className="ml-auto flex flex-wrap gap-2">
          <a href="/ops/judging/export?type=summary" className="inline-flex min-h-11 items-center border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime">
            Summary CSV
          </a>
          <a href="/ops/judging/export?type=scores" className="inline-flex min-h-11 items-center border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime">
            All scores CSV
          </a>
          <Link href="/judge/scorecard" className="inline-flex min-h-11 items-center border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime">
            Paper scorecard
          </Link>
        </span>
      </div>

      <section aria-labelledby="agg-h">
        <h2 id="agg-h" className={label}>
          Aggregate · committed final-round means
        </h2>
        <div className="overflow-x-auto border border-hairline">
          <table className="w-full min-w-[960px] text-left font-plex text-sm">
            <thead className="border-b border-hairline bg-surface font-pixel text-[10px] uppercase tracking-[0.15em] text-lightgray">
              <tr>
                <th className="px-3 py-3 font-normal">#</th>
                <th className="px-3 py-3 font-normal">Team</th>
                <th className="px-3 py-3 font-normal">Final (judges)</th>
                {judging.rubric.map((r) => (
                  <th key={r.key} className="px-3 py-3 font-normal" title={r.name}>
                    {r.label} /{r.points}
                  </th>
                ))}
                <th className="px-3 py-3 font-normal">Stage (judges)</th>
                <th className="px-3 py-3 font-normal">Mid notes</th>
                <th className="px-3 py-3 font-normal">Drafts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.submission_id} className="border-b border-dashed border-hairline last:border-0">
                  <td className="px-3 py-3 font-dots text-xl font-black text-bright">{r.rank ?? "—"}</td>
                  <td className="px-3 py-3">
                    <Link href={`/judge/${r.submission_id}`} className="text-bright hover:text-lime">
                      {r.team_name}
                    </Link>
                    <span className="block text-xs text-lightgray">
                      {r.receipt_code ?? "no receipt"} · {isFinal(r.status) ? r.status : `not final (${r.status})`}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-bright">
                    {fmt(r.final.mean)} <span className="text-xs text-lightgray">({r.final.judges})</span>
                  </td>
                  {judging.rubric.map((c) => (
                    <td key={c.key} className="px-3 py-3 text-lightgray">
                      {fmt(r.final.categories[c.key] ?? null)}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-bright">
                    {fmt(r.stage.mean)} <span className="text-xs text-lightgray">({r.stage.judges})</span>
                  </td>
                  <td className="px-3 py-3 text-lightgray">{r.midFeedback}</td>
                  <td className="px-3 py-3 text-lightgray">{r.drafts}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6 + judging.rubric.length} className="px-3 py-8 text-center text-lightgray">
                    No submissions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 font-plex text-xs text-lightgray">Only committed scores count. Ties break on Kane usage, then completion. Unknown values show —, never 0.</p>
      </section>

      <section aria-labelledby="demo-h">
        <h2 id="demo-h" className={label}>
          Demo queue · top {DEMO_SLOTS} {demo.confirmed ? `· confirmed by ${demo.by}` : "· suggested, not confirmed"}
        </h2>
        {options.length ? (
          <DemoQueueForm options={options} suggested={demo.items.map((i) => i.submission_id)} slots={DEMO_SLOTS} />
        ) : (
          <p className="font-plex text-sm text-lightgray">No finalized submissions yet.</p>
        )}
      </section>

      <section aria-labelledby="lock-h">
        <h2 id="lock-h" className={label}>
          Judge lock
        </h2>
        {state.locked ? <ReopenForm /> : <LockForm phrase={LOCK_PHRASE} drafts={drafts} />}
      </section>

      <section aria-labelledby="awards-h">
        <h2 id="awards-h" className={label}>
          Awards
        </h2>
        {state.awards.length > 0 && (
          <ul className="mb-6 border-t border-dashed border-hairline">
            {state.awards.map((a) => (
              <li key={`${a.award}-${a.submission_id}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-hairline py-3 font-plex text-sm">
                <span>
                  <span className="text-bright">{a.award}</span> · {byId.get(a.submission_id)?.team_name ?? `submission ${a.submission_id}`}
                  <span className="block text-xs text-lightgray">recorded by {a.by}</span>
                </span>
                <form action={removeAwardAction.bind(null, a.award, a.submission_id)}>
                  <button type="submit" className="min-h-11 px-2 font-plex text-xs text-lightgray hover:text-danger">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {state.locked ? (
          options.length ? (
            <AwardForm awards={AWARD_OPTIONS} options={options} />
          ) : (
            <p className="font-plex text-sm text-lightgray">No finalized submissions to award.</p>
          )
        ) : (
          <p className="font-plex text-sm text-lightgray">Awards open once judging is locked.</p>
        )}
      </section>
    </div>
  );
}
