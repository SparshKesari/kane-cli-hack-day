import type { Metadata } from "next";
import Link from "next/link";
import StatusPill from "@/components/ui/StatusPill";
import { event } from "@/data/hackday";
import { PROGRESS_ITEMS } from "@/lib/progress";
import { query } from "@/lib/db";
import { getProgress } from "@/lib/teams";
import { getPersonalMember } from "@/server/auth";
import { to12h } from "@/lib/time";
import { PROJECT_TYPES, PROJECT_TYPE_LABEL, runConfidence } from "@/server/showcase";
import { KANE_COMPONENTS, getSubmissionContext, isFrozen, type PreflightItem, type SubmissionContext } from "@/server/submission";
import Hub, { type HubContext } from "../hub";
import { ProgressRow } from "../parts";
import { CreditChoice, FinalizePanel, PreflightButton, ShowcaseMode } from "./parts";
import SubmissionForm, { type RunOption } from "./SubmissionForm";

export const metadata: Metadata = { title: "Submit" };

// The official submission (D2). Everything a team hands in, one draft,
// preflight, then a typed-confirmation finalize that freezes a signed receipt
// and publishes the public showcase at /ship/{slug}.

export default function SubmitTab({ params }: PageProps<"/t/[slug]/submit">) {
  return (
    <Hub params={params} tab="submit">
      {(ctx) => <SubmitView {...ctx} />}
    </Hub>
  );
}

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: event.timezone, timeZoneName: "short" });
const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: event.timezone, timeZoneName: "short" });
const eyebrow = "font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray";

async function SubmitView({ team, me }: HubContext) {
  const [ctx, progress, personal, [cap]] = await Promise.all([
    getSubmissionContext(team.id),
    getProgress(team.id),
    getPersonalMember(),
    query<{ captain_id: number | null }>("select captain_id from teams where id = $1", [team.id]),
  ]);
  // Finalize and consent are personal: the captain (or the person) signed in as themselves.
  const isPersonal = !!me && personal?.id === me.id;
  const isCaptain = !!me && (!cap?.captain_id || Number(cap.captain_id) === me.id);
  const frozen = !!ctx.submission && isFrozen(ctx.submission.status);
  const readOnly = !me || ctx.locked || frozen;

  return (
    <>
      <StatusBand ctx={ctx} frozen={frozen} />

      {frozen ? (
        <Finalized ctx={ctx} slug={team.slug} canEdit={!!me} />
      ) : (
        <section className="py-12 sm:py-16">
          <div className="container-page grid gap-12 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
            <div className="min-w-0">
              {ctx.submission?.status === "withdrawn" && (
                <p className="mb-8 border-l-2 border-warning pl-3 font-plex text-sm text-warning">
                  Your earlier submission{ctx.submission.receipt_code ? ` (${ctx.submission.receipt_code})` : ""} was withdrawn by an organizer. Saving starts a new draft that supersedes it.
                </p>
              )}
              <SubmissionForm
                slug={team.slug}
                projectSlug={ctx.project.slug}
                projectId={ctx.project.id}
                draft={ctx.draft}
                runs={ctx.runs.map(runOption)}
                types={PROJECT_TYPES.map((t) => ({ value: t, label: PROJECT_TYPE_LABEL[t] }))}
                components={KANE_COMPONENTS.map((c) => ({ id: c.id, label: c.label }))}
                disabled={readOnly}
              />
            </div>
            <aside className="space-y-8 lg:sticky lg:top-28 lg:self-start">
              <Preflight items={ctx.preflight.items} checkedAt={ctx.submission?.preflight?.checked_at ?? null} />
              {me && !ctx.locked && ctx.submission && <PreflightButton slug={team.slug} />}
              <div className="brackets border border-hairline bg-surface p-5">
                <p className={eyebrow}>Finalize</p>
                {ctx.locked ? (
                  <div className="mt-3 space-y-3 font-plex text-sm">
                    <StatusPill tone="danger">Locked</StatusPill>
                    <p className="text-lightgray">
                      Submissions locked at {clock.format(ctx.locksAt)} (server time). If an outage blocked you, go to the help desk: staff can write a manual receipt with the real time.
                    </p>
                    <Link href={`/t/${team.slug}/help`} className="inline-flex min-h-11 items-center text-bright underline underline-offset-4 hover:text-lime">
                      Ask the help desk →
                    </Link>
                  </div>
                ) : me && !isCaptain ? (
                  <p className="mt-3 font-plex text-sm text-lightgray">Only your team captain can finalize. Everyone can edit the draft and run preflight.</p>
                ) : me && !isPersonal ? (
                  <PersonalSignIn slug={team.slug} what="finalize" />
                ) : me ? (
                  <div className="mt-3">
                    <FinalizePanel slug={team.slug} teamName={team.name} ready={!!ctx.submission && ctx.preflight.ok} missing={ctx.submission ? ctx.preflight.missing : ["save your draft"]} />
                  </div>
                ) : (
                  <p className="mt-3 font-plex text-sm text-lightgray">Viewing as staff. Only team members can finalize.</p>
                )}
              </div>
              {ctx.submission && ctx.submission.status !== "withdrawn" && (
                <Link href={`/ship/${ctx.project.slug}`} className="inline-flex min-h-11 items-center font-plex text-sm text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                  Preview your showcase page (saved draft) →
                </Link>
              )}
            </aside>
          </div>
        </section>
      )}

      <Credits ctx={ctx} slug={team.slug} meId={me?.id ?? null} personal={isPersonal} />
      <PrizeChecklist slug={team.slug} progress={progress} shipped={ctx.prize.shipped} readOnly={!me} />
    </>
  );
}

function runOption(r: SubmissionContext["runs"][number]): RunOption {
  const c = runConfidence(r);
  return {
    id: r.id,
    label: r.objective?.trim() || `Run ${r.upstream_execution_id}`,
    status: r.status,
    tone: c === "verified" ? "verified" : c === "detected" ? "suspected" : "unverified",
    toneLabel: c === "verified" ? "Verified pass" : c === "detected" ? `Suspected · ${r.status}` : `Reported · ${r.status}`,
    commit: r.commit_sha,
    when: r.at ? when.format(new Date(r.at)) : "time unknown",
  };
}

function StatusBand({ ctx, frozen }: { ctx: SubmissionContext; frozen: boolean }) {
  const s = ctx.submission;
  const minutesLeft = Math.floor((ctx.locksAt.getTime() - ctx.serverNow.getTime()) / 60_000);
  return (
    <section className="border-b border-dashed border-hairline py-8">
      <div className="container-page flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className={eyebrow}>Official submission</p>
          <p className="mt-2 font-dots text-4xl leading-none font-black text-bright sm:text-5xl">
            {frozen ? s!.receipt_code : s?.status === "preflighted" ? "Preflighted" : "Draft"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-plex text-xs text-lightgray">
          {frozen ? (
            s!.signature ? (
              <StatusPill tone="verified">Verified · signed receipt</StatusPill>
            ) : (
              <StatusPill tone="unverified">Receipt unsigned</StatusPill>
            )
          ) : ctx.locked ? (
            <StatusPill tone="danger">Not submitted · locked</StatusPill>
          ) : (
            <StatusPill tone="pending">{minutesLeft >= 0 && minutesLeft < 60 ? `${minutesLeft} min left` : "Not finalized"}</StatusPill>
          )}
          <span>
            Due {clock.format(ctx.locksAt)} · server time {clock.format(ctx.serverNow)}
          </span>
        </div>
      </div>
    </section>
  );
}

function Preflight({ items, checkedAt }: { items: PreflightItem[]; checkedAt: string | null }) {
  const required = items.filter((i) => i.required);
  const optional = items.filter((i) => !i.required);
  const missing = required.filter((i) => i.state === "missing").length;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-hairline pb-3">
        <p className={eyebrow}>Preflight</p>
        <p className="font-plex text-xs text-lightgray">{missing ? `${missing} required missing` : "Required items present"}</p>
      </div>
      <PreflightList items={required} />
      <p className={`${eyebrow} mt-6`}>Recommended</p>
      <PreflightList items={optional} />
      <p className="mt-3 font-plex text-[11px] text-lightgray">
        Live check of your saved draft{checkedAt ? ` · last stored run ${when.format(new Date(checkedAt))}` : ""}. Deck and video are never required.
      </p>
    </div>
  );
}

function PreflightList({ items }: { items: PreflightItem[] }) {
  return (
    <ul className="divide-y divide-dashed divide-hairline">
      {items.map((i) => (
        <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 py-2 font-plex text-sm">
          <span className="min-w-0 text-bright">
            <span aria-hidden className="mr-2 text-lightgray">
              {i.state === "ok" ? "✓" : i.state === "uncertain" ? "?" : "·"}
            </span>
            {i.label}
            {i.detail && <span className="mt-0.5 block pl-5 text-xs text-lightgray">{i.detail}</span>}
          </span>
          {i.state === "missing" ? (
            i.required ? (
              <StatusPill tone="pending">Missing</StatusPill>
            ) : (
              <span className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Optional</span>
            )
          ) : i.state === "uncertain" ? (
            <StatusPill tone="unverified">Uncertain</StatusPill>
          ) : (
            <span className="font-pixel text-[10px] uppercase tracking-[0.2em] text-bright">Ready</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Finalized({ ctx, slug, canEdit }: { ctx: SubmissionContext; slug: string; canEdit: boolean }) {
  const s = ctx.submission!;
  const snap = (s.immutable_snapshot ?? {}) as { submission?: { commit_sha?: string | null; repo_url?: string | null } };
  return (
    <section className="py-12 sm:py-16">
      <div className="container-page grid gap-10 lg:grid-cols-2">
        <div className="brackets border border-hairline bg-surface p-6">
          <p className={eyebrow}>Receipt</p>
          <p className="mt-3 font-dots text-6xl leading-none font-black text-bright">{s.receipt_code}</p>
          <dl className="mt-6 space-y-3 font-plex text-sm">
            <Row k="Finalized (server time)" v={when.format(new Date(s.finalized_at!))} />
            {s.received_at && <Row k="Received by staff" v={when.format(new Date(s.received_at))} />}
            <Row k="Source" v={s.source === "manual_offline" ? "Manual (offline backup)" : s.source === "mcp" ? "Codex session" : "Web"} />
            <Row k="Repository" v={snap.submission?.repo_url ?? "—"} mono />
            {snap.submission?.commit_sha && <Row k="Commit" v={snap.submission.commit_sha} mono />}
            <Row k="Snapshot SHA-256" v={s.snapshot_sha256 ?? "—"} mono />
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/submit/receipt/${s.receipt_code}`} className="inline-flex min-h-11 items-center bg-bright px-4 font-plex text-sm text-ink hover:bg-lime">
              Open receipt →
            </Link>
          </div>
          <p className="mt-4 font-plex text-xs text-lightgray">This record is frozen. To change anything, an organizer must withdraw it first; history is kept.</p>
        </div>
        <div className="space-y-6">
          <div>
            <p className={eyebrow}>Your showcase</p>
            <p className="mt-2 font-display text-3xl text-bright">/ship/{ctx.project.slug}</p>
            <p className="mt-2 font-plex text-sm text-lightgray">Built from this submission. Screenshots, evidence and credits appear exactly as submitted.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href={`/ship/${ctx.project.slug}`} className="inline-flex min-h-11 items-center border border-hairline px-4 font-plex text-sm text-bright hover:border-lime hover:text-lime">
                View page →
              </Link>
              <Link href={`/ship/${ctx.project.slug}/deck`} className="inline-flex min-h-11 items-center border border-hairline px-4 font-plex text-sm text-bright hover:border-lime hover:text-lime">
                HTML deck →
              </Link>
            </div>
          </div>
          {canEdit && (
            <div>
              <p className={`${eyebrow} mb-2`}>Visibility</p>
              <ShowcaseMode slug={slug} current={ctx.project.showcase_state} moderated={ctx.project.showcase_state === "hidden_by_moderation"} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-lightgray">{k}</dt>
      <dd className={`min-w-0 break-all text-bright ${mono ? "font-mono text-xs leading-6" : ""}`}>{v}</dd>
    </div>
  );
}

function PersonalSignIn({ slug, what }: { slug: string; what: string }) {
  return (
    <div className="mt-3 space-y-3 font-plex text-sm">
      <p className="text-lightgray">To {what}, sign in as yourself (your password, or a one-time code from the desk).</p>
      <Link href={`/passport/login?next=${encodeURIComponent(`/t/${slug}/submit`)}`} className="inline-flex min-h-11 items-center border border-hairline px-4 text-bright hover:border-lime hover:text-lime">
        Sign in as yourself →
      </Link>
      <p className="text-xs text-lightgray">You&apos;ll come straight back to this submission.</p>
    </div>
  );
}

function Credits({ ctx, slug, meId, personal }: { ctx: SubmissionContext; slug: string; meId: number | null; personal: boolean }) {
  const mine = ctx.members.find((m) => m.id === meId);
  return (
    <section className="border-t border-dashed border-hairline py-12">
      <div className="container-page grid gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div>
          <p className={eyebrow}>Team credits</p>
          <h2 className="mt-2 font-display text-2xl text-bright">Who is named on the public page</h2>
          <p className="mt-2 max-w-xl font-plex text-sm text-lightgray">
            Each person decides for themselves. Only people who said yes appear on the showcase and deck, and a later &ldquo;no&rdquo; removes them right away.
          </p>
          <ul className="mt-6 divide-y divide-dashed divide-hairline border-y border-dashed border-hairline">
            {ctx.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3 font-plex text-sm">
                <span className="text-bright">
                  {m.display_name}
                  {m.handle && <span className="ml-2 text-xs text-lightgray">{m.handle}</span>}
                </span>
                {m.consent === true ? (
                  <span className="font-pixel text-[10px] uppercase tracking-[0.2em] text-bright">■ Credited</span>
                ) : m.consent === false ? (
                  <span className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Not named</span>
                ) : (
                  <StatusPill tone="pending">Not asked yet</StatusPill>
                )}
              </li>
            ))}
          </ul>
        </div>
        {mine && (
          <div className="brackets self-start border border-lime bg-lime-deep p-5">
            <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">Your choice</p>
            <p className="mt-2 font-plex text-sm text-bright">May we show your name{mine.handle ? ` and ${mine.handle}` : ""} on your team&apos;s public showcase and deck?</p>
            {personal ? (
              <div className="mt-4">
                <CreditChoice slug={slug} consent={mine.consent} />
              </div>
            ) : (
              <PersonalSignIn slug={slug} what="answer for yourself" />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function PrizeChecklist({ slug, progress, shipped, readOnly }: { slug: string; progress: Awaited<ReturnType<typeof getProgress>>; shipped: boolean; readOnly: boolean }) {
  const byItem = new Map(progress.map((p) => [p.item, p]));
  const done = progress.filter((p) => p.done).length;
  return (
    <section className="border-t border-dashed border-hairline py-12 sm:py-16">
      <div className="container-page max-w-4xl">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-dashed border-hairline pb-4">
          <div>
            <p className={eyebrow}>Shipped prize bundle</p>
            <p className="mt-2 font-dots text-5xl leading-none font-black text-bright">
              {done}
              <span className="text-lightgray">/{PROGRESS_ITEMS.length}</span>
            </p>
          </div>
          <span className={`border px-2 py-1 font-pixel text-[10px] uppercase tracking-[0.2em] ${shipped ? "border-bright text-bright" : "border-hairline text-lightgray"}`}>
            {shipped ? "✓ Shipped minimum met" : "Shipped minimum: 3 essentials + 2 content"}
          </span>
        </div>
        <p className="mt-3 max-w-2xl font-plex text-xs text-lightgray">
          Separate from the official submission above: the shipped prize needs the essentials plus any two content pieces. Your receipt records whether this was met at finalize.
        </p>
        {(["idea", "essential", "content"] as const).map((kind) => (
          <div key={kind} className="mt-8">
            <p className={`${eyebrow} mb-2`}>{kind === "idea" ? "Idea" : kind === "essential" ? "Essentials" : "Content · pick two or more"}</p>
            <ul className="border-t border-dashed border-hairline">
              {PROGRESS_ITEMS.filter((i) => i.kind === kind).map((item) => {
                const row = byItem.get(item.id);
                return (
                  <ProgressRow
                    key={`${item.id}:${row?.updated_at?.toISOString() ?? ""}`}
                    slug={slug}
                    item={{ id: item.id, label: item.label, placeholder: item.placeholder }}
                    deadline={to12h(item.deadline)}
                    value={row?.value ?? ""}
                    done={row?.done ?? false}
                    by={row?.updated_by_name ? `${row.updated_by_name} · ${clock.format(row.updated_at)}` : null}
                    readOnly={readOnly}
                  />
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
