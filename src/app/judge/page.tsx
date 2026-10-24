import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatusPill from "@/components/ui/StatusPill";
import { getStaff, hasRole } from "@/server/auth";
import { ROUNDS, getDemoQueue, getJudgingState, isFinal, listJudgeQueue, type QueueItem, type Round } from "@/server/judging";
import { StaffGate, Tag, label, when } from "./parts";

export const metadata: Metadata = { title: "Judge", robots: { index: false } };

// The judge's console: every submission to score, this judge's own state per
// round, and the demo queue once the organizers confirm it.

export default function JudgePage() {
  return (
    <main>
      <PageHeader
        eyebrow="Judge"
        dim="Score the proof,"
        bright="Not the pitch."
        intro="Open a team, inspect its receipt, Kane runs and evidence, then score each category with an anchor. Cite evidence or say what you couldn't verify. A committed score can't change."
        jumps={[
          { href: "/judge/scorecard", label: "Printable scorecard" },
          { href: "#queue", label: "Teams" },
        ]}
      />
      <section className="py-12 sm:py-16">
        <div className="container-page">
          <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading…</p>}>
            <JudgeView />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function JudgeView() {
  const staff = await getStaff();
  if (!hasRole(staff, "judge", "organizer")) return <StaffGate role="judge" next="/judge" signedIn={!!staff} />;

  const [items, state, demo] = await Promise.all([listJudgeQueue(staff!.id), getJudgingState(), getDemoQueue()]);
  const finals = items.filter((i) => isFinal(i.status));
  const inProgress = items.filter((i) => !isFinal(i.status));

  return (
    <div className="space-y-12">
      {staff!.id == null && (
        <p role="status" className="border-l-2 border-warning bg-warning-deep px-4 py-3 font-plex text-sm text-bright">
          You are signed in with the admin password. Scores need a named judge account: sign in with your staff email and one-time code to score.
        </p>
      )}
      {state.locked && (
        <div role="status" className="flex flex-wrap items-center gap-3 border-l-2 border-warning bg-warning-deep px-4 py-3">
          <StatusPill tone="pending">Locked</StatusPill>
          <p className="font-plex text-sm text-bright">
            Judging was locked {when(state.locked.at)} by {state.locked.by}. Scores are read-only.
          </p>
        </div>
      )}

      <section aria-labelledby="demo-h">
        <h2 id="demo-h" className={label}>
          Demo queue · top 7 {demo.confirmed ? "· confirmed" : "· not confirmed yet"}
        </h2>
        {demo.items.length ? (
          <ol className="mt-3 grid gap-px border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-4">
            {demo.items.map((r, i) => (
              <li key={r.submission_id} className="bg-ink p-4">
                <span className="font-dots text-3xl leading-none font-black text-bright">{i + 1}</span>
                <Link href={`/judge/${r.submission_id}?round=stage`} className="mt-2 flex min-h-11 items-center font-display text-lg text-bright hover:text-lime">
                  {r.team_name}
                </Link>
                <p className="font-plex text-xs text-lightgray">{r.project_name}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 font-plex text-sm text-lightgray">
            {demo.confirmed ? "The confirmed queue is empty." : "Appears once final-round scores are committed. Organizers confirm it."}
          </p>
        )}
        {!demo.confirmed && demo.items.length > 0 && (
          <p className="mt-2 font-plex text-xs text-lightgray">Suggested from committed final scores. Organizers confirm the order before the stage round.</p>
        )}
      </section>

      <section id="queue" aria-labelledby="queue-h" className="space-y-4">
        <h2 id="queue-h" className={label}>
          Finalized submissions · {finals.length}
        </h2>
        <QueueList items={finals} empty="No finalized submissions yet. Submissions are due at 6:00 PM." />
      </section>

      {inProgress.length > 0 && (
        <section aria-labelledby="prog-h" className="space-y-4">
          <h2 id="prog-h" className={label}>
            In progress · {inProgress.length}
          </h2>
          <p className="max-w-2xl font-plex text-sm text-lightgray">
            Not finalized yet. You can give mid-round feedback and score the final table round against what they have now; the stage round only takes finalized submissions.
          </p>
          <QueueList items={inProgress} empty="" />
        </section>
      )}
    </div>
  );
}

function RoundState({ round, item }: { round: Round; item: QueueItem }) {
  const s = item.mine.find((m) => m.round === round);
  const name = round === "mid" ? "Mid" : round === "final" ? "Final" : "Stage";
  if (!s) return <Tag>{name} · not started</Tag>;
  if (!s.frozen) return <Tag>{name} · draft</Tag>;
  return <Tag strong>{ROUNDS[round].scored && s.total !== null ? `${name} · ${Number(s.total)} pts` : `${name} · committed`}</Tag>;
}

function QueueList({ items, empty }: { items: QueueItem[]; empty: string }) {
  if (!items.length) return empty ? <p className="font-plex text-sm text-lightgray">{empty}</p> : null;
  return (
    <ul className="border-t border-dashed border-hairline">
      {items.map((i) => (
        <li key={i.id} className="grid gap-3 border-b border-dashed border-hairline py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <p className="font-display text-lg text-bright">
              {i.team_name}
              {i.table_label && <span className="ml-2 font-plex text-xs text-lightgray">table {i.table_label}</span>}
            </p>
            <p className="font-plex text-xs text-lightgray">
              {i.project_name} · {i.project_type.replace("_", " ")} · {i.receipt_code ?? "no receipt yet"}
              {isFinal(i.status) ? ` · finalized ${when(i.finalized_at)}` : ` · ${i.status.replace("_", " ")}`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!isFinal(i.status) && <StatusPill tone="unverified">Not final</StatusPill>}
              <RoundState round="mid" item={i} />
              <RoundState round="final" item={i} />
              {isFinal(i.status) && <RoundState round="stage" item={i} />}
            </div>
          </div>
          <Link
            href={`/judge/${i.id}`}
            className="inline-flex min-h-11 items-center justify-center border border-hairline px-4 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime"
          >
            Inspect &amp; score →
          </Link>
        </li>
      ))}
    </ul>
  );
}
