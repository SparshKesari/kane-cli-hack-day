"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import DegradedServiceAlert from "@/components/ui/DegradedServiceAlert";
import DemoDataChip from "@/components/ui/DemoDataChip";
import FreshnessStamp, { type FreshnessState } from "@/components/ui/FreshnessStamp";
import Ring from "@/components/ui/Ring";
import StatusPill from "@/components/ui/StatusPill";
import { event as copy, schedule } from "@/data/hackday";
import { inEventZone, to12h, toMinutes } from "@/lib/time";
import type { FeedItem, LiveSnapshot } from "@/server/metrics";
import { displayValue, formatSeconds, METRICS } from "./definitions";
import LiveActivityTicker, { FeedStatus } from "./LiveActivityTicker";
import { OPS_STRIP, PANEL_SECONDS, PANEL_TITLES, PHASE_SPECS, type PanelKey } from "./phases";
import VerifiedMetric from "./VerifiedMetric";

// Mission Control (/live): a room-scale TV at 1920×1080 that also reads on a
// phone. Layout budget: story/people 50% (left), actions & deadlines 30%
// (right), metrics 20% (bottom strip). Data arrives over SSE
// (/api/v1/live/stream) with Last-Event-ID resume; if the stream is off or
// keeps failing we poll /api/v1/live/metrics?board=1. On any failure the last
// values stay on screen with DELAYED / STALE / OFFLINE, never 0.
//
// The clock is the server's: every snapshot carries server_time and we keep
// the offset, so the countdown is right even on a TV with a wrong clock. It is
// display only; deadlines are enforced on the server.

// ── Clocks ───────────────────────────────────────────────────────────────────

const subscribeSecond = (cb: () => void) => {
  const id = window.setInterval(cb, 1000);
  return () => window.clearInterval(id);
};
const getSecond = () => Math.floor(Date.now() / 1000) * 1000;
const getNull = () => null;

const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const getReduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const getReducedServer = () => false;

const clockFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: copy.timezone });
const zoneFmt = new Intl.DateTimeFormat("en-US", { timeZone: copy.timezone, timeZoneName: "short" });
const zoneName = (ms: number) => zoneFmt.formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "";

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
}

/** The next schedule slot (hackday.ts) after `ms`, by the event's local clock. */
function nextAgenda(ms: number) {
  const { date, minutes } = inEventZone(ms);
  if (date < copy.date) return schedule[0];
  if (date > copy.date) return null;
  return schedule.find((s) => toMinutes(s.start) > minutes) ?? null;
}

const ORDER: FreshnessState[] = ["fresh", "delayed", "stale", "offline"];
const worst = (a: FreshnessState, b: FreshnessState) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

type Conn = "connecting" | "streaming" | "reconnecting" | "polling";

// ── Component ────────────────────────────────────────────────────────────────

export default function LiveTV({
  initial,
  ops = false,
  qrHelp,
  qrTeams,
  qrBig,
  opsControls,
}: {
  initial: LiveSnapshot;
  ops?: boolean;
  /** Server-rendered QR codes (no PII): help desk and team finder, small for the strip. */
  qrHelp: ReactNode;
  qrTeams: ReactNode;
  /** Large QR for the panels that point people somewhere (help / showcase). */
  qrBig: { help: ReactNode; ship: ReactNode; teams: ReactNode };
  /** Organizer-only controls (phase override), rendered by the server page. */
  opsControls?: ReactNode;
}) {
  const [snap, setSnap] = useState(initial);
  const [offset, setOffset] = useState<number | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [failingSince, setFailingSince] = useState<number | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [toast, setToast] = useState<FeedItem | null>(null);
  const toastTimer = useRef<number | null>(null);

  const local = useSyncExternalStore(subscribeSecond, getSecond, getNull);
  const reduced = useSyncExternalStore(subscribeMotion, getReduced, getReducedServer);
  // Before hydration (and on the server) use the snapshot's own server time, so
  // the first frame already shows the official clock instead of a dash.
  const serverMs: number | null = local == null ? new Date(snap.server_time).getTime() : local + (offset ?? 0);

  const base = ops ? "?ops=1" : "";
  const accept = useCallback((s: LiveSnapshot) => {
    const at = Date.now(); // receipt time, for the offset and client-side staleness only
    // An empty metrics object means the server couldn't read them: keep the
    // last values on screen (the snapshot's banner says they are held).
    setSnap((prev) => (prev && Object.keys(s.metrics ?? {}).length === 0 && Object.keys(prev.metrics ?? {}).length > 0 ? { ...s, metrics: prev.metrics, as_of: prev.as_of } : s));
    setOffset(new Date(s.server_time).getTime() - at);
    setLastOk(at);
    setFailingSince(null);
  }, []);

  const showToast = useCallback((item: FeedItem) => {
    if (item.status !== "proof") return; // kinetic notifications are for evidence-backed proof only
    setToast(item);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 9000);
  }, []);

  // Reconcile against the metrics endpoint (after a reconnect, and when polling).
  const reconcile = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/live/metrics?board=1${ops ? "&ops=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const env = (await res.json()) as { data?: { board?: LiveSnapshot } };
      if (env.data?.board) accept(env.data.board);
      return true;
    } catch {
      setFailingSince((f) => f ?? Date.now());
      return false;
    }
  }, [accept, ops]);

  // SSE with fallback to polling.
  useEffect(() => {
    let es: EventSource | null = null;
    let poll: number | null = null;
    let errors = 0;
    let closed = false;

    const startPolling = () => {
      if (poll != null || closed) return;
      es?.close();
      setConn("polling");
      void reconcile();
      poll = window.setInterval(() => void reconcile(), 15_000);
    };

    if (typeof EventSource === "undefined") {
      startPolling();
    } else {
      es = new EventSource(`/api/v1/live/stream${base}`);
      es.addEventListener("open", () => {
        setConn("streaming");
        if (errors > 0) void reconcile(); // reconnect → reconcile
        errors = 0;
      });
      es.addEventListener("snapshot", (ev) => {
        try {
          accept(JSON.parse((ev as MessageEvent).data) as LiveSnapshot);
        } catch {
          /* ignore a malformed frame; the next one replaces it */
        }
      });
      es.addEventListener("feed", (ev) => {
        try {
          showToast(JSON.parse((ev as MessageEvent).data) as FeedItem);
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("ping", (ev) => {
        try {
          const { server_time } = JSON.parse((ev as MessageEvent).data) as { server_time: string | null };
          const at = Date.now();
          if (server_time) setOffset(new Date(server_time).getTime() - at);
          setLastOk(at);
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("degraded", () => setFailingSince((f) => f ?? Date.now()));
      es.addEventListener("error", () => {
        errors += 1;
        setFailingSince((f) => f ?? Date.now());
        // CLOSED = the server refused (flag off / 503): poll instead. Otherwise
        // EventSource retries by itself with Last-Event-ID.
        if (es?.readyState === EventSource.CLOSED || errors >= 4) startPolling();
        else setConn("reconnecting");
      });
    }
    return () => {
      closed = true;
      es?.close();
      if (poll != null) window.clearInterval(poll);
    };
  }, [accept, base, reconcile, showToast]);

  // Panel rotation, 15–25s per panel; paused by the viewer.
  const spec = PHASE_SPECS[snap.event.phase];
  const panels = spec.panels;
  const panel = panels[tick % panels.length];
  useEffect(() => {
    if (paused || ops) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), PANEL_SECONDS[tick % PANEL_SECONDS.length] * 1000);
    return () => window.clearTimeout(t);
  }, [tick, paused, ops]);

  // Freshness: the server's view, made worse if we haven't heard from it.
  const silentFor = local == null ? 0 : failingSince != null ? local - failingSince : lastOk != null ? local - lastOk : 0;
  const clientState: FreshnessState = silentFor > 300_000 ? "offline" : silentFor > 90_000 ? "stale" : silentFor > 40_000 ? "delayed" : "fresh";
  const freshness = worst(snap.freshness_state, clientState);
  const held = freshness !== "fresh";

  const locksAt = new Date(snap.event.submission_locks_at).getTime();
  const left = serverMs == null ? null : locksAt - serverMs;
  const agenda = serverMs == null ? null : nextAgenda(serverMs);
  const m = snap.metrics;

  return (
    <div className="fixed inset-0 z-[80] overflow-x-hidden overflow-y-auto bg-ink text-bright lg:overflow-hidden">
      <div className="mx-auto flex min-h-full w-full max-w-[1920px] flex-col gap-3 px-4 py-4 lg:h-dvh lg:gap-[1.4vh] lg:px-[2vw] lg:py-[1.6vh]">
        {/* ── Top strip (fixed) ─────────────────────────────────────────── */}
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-hairline pb-3">
          <Link href="/" className="flex min-h-11 items-center gap-3" aria-label={`${copy.name}: exit Mission Control`}>
            <span className="font-display text-[clamp(1.1rem,1.4vw,1.75rem)] font-bold tracking-tight">
              KANE<span className="text-lightgray">/</span>MISSION CONTROL
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <StatusPill tone="accent" size="md">
              Now · {snap.event.phase}
            </StatusPill>
            {snap.event.phase_source === "override" && <span className="font-plex text-xs text-lightgray">set by organizers</span>}
            {ops && <span className="border border-warning px-2 py-0.5 font-pixel text-[10px] uppercase tracking-[0.2em] text-warning">Ops · private</span>}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Official time</p>
              <p className="font-dots text-[clamp(1.5rem,2.2vw,2.75rem)] leading-none font-black" suppressHydrationWarning>
                {serverMs == null ? "—" : clockFmt.format(serverMs)}
                <span className="ml-2 font-plex text-xs font-normal text-lightgray">{serverMs == null ? "" : zoneName(serverMs)}</span>
              </p>
            </div>
            <div aria-live="off">
              <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Submissions lock</p>
              <p
                className={`font-dots text-[clamp(1.5rem,2.2vw,2.75rem)] leading-none font-black ${
                  left != null && left > 0 && left < 30 * 60_000 ? "text-warning" : "text-bright"
                }`}
              >
                {left == null ? "—" : left > 0 ? countdown(left) : "Locked"}
              </p>
            </div>
            <div className="max-w-[22rem]">
              <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Next on the agenda</p>
              <p className="font-plex text-sm text-bright">
                {agenda ? (
                  <>
                    <span className="text-lightgray">{to12h(agenda.start)} </span>
                    {agenda.title}
                  </>
                ) : (
                  "—"
                )}
              </p>
            </div>
            <div className="flex items-start gap-3">
              {qrHelp}
              {qrTeams}
            </div>
          </div>
        </header>

        {/* ── Degradation banners ──────────────────────────────────────── */}
        {(held || snap.banners.length > 0) && (
          <div className="flex flex-col gap-2">
            {held && (
              <DegradedServiceAlert state={freshness as "delayed" | "stale" | "offline"} system="Live board">
                Showing the last values received
                {lastOk != null ? ` at ${clockFmt.format(lastOk + (offset ?? 0))}` : snap.as_of ? ` at ${clockFmt.format(new Date(snap.as_of))}` : ""}. Numbers are held, not reset. Help and submission still work.
              </DegradedServiceAlert>
            )}
            {snap.banners.slice(0, ops ? 6 : 2).map((b) => (
              <DegradedServiceAlert key={b.system + b.state} state={b.state} system={b.system}>
                {b.detail}
              </DegradedServiceAlert>
            ))}
          </div>
        )}

        {/* ── Main: story 50% | actions 30% ────────────────────────────── */}
        <main className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[5fr_3fr] lg:gap-[1.6vw]">
          <section className="flex min-h-0 min-w-0 flex-col gap-4" aria-label="Story">
            {ops ? (
              <OpsBoardView snap={snap} />
            ) : (
              <>
                <div>
                  <p className="font-pixel text-[11px] uppercase tracking-[0.25em] text-lightgray">
                    {spec.index} / {spec.kicker}
                  </p>
                  <h1 className="mt-2 font-display text-[clamp(2.5rem,5.4vw,7rem)] leading-[0.92] font-bold tracking-[-0.03em]">
                    {spec.headline[0]} <span className="font-dots font-black text-lime">{spec.headline[1]}</span>
                  </h1>
                  <p className="mt-3 max-w-[48rem] font-plex text-[clamp(0.9rem,1.05vw,1.25rem)] text-lightgray">{spec.sub}</p>
                </div>
                <div className="flex min-h-0 flex-1 flex-col border-t border-hairline pt-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="font-display text-[clamp(1.1rem,1.5vw,1.75rem)] font-medium">
                      <span aria-hidden="true" className="text-lightgray">
                        ↗{" "}
                      </span>
                      {PANEL_TITLES[panel]}
                    </h2>
                    <p className="font-plex text-xs text-lightgray">
                      Panel {(tick % panels.length) + 1} of {panels.length}
                    </p>
                  </div>
                  <div key={`${snap.event.phase}-${panel}`} className={`min-h-0 flex-1 overflow-hidden ${reduced ? "" : "animate-rise"}`}>
                    <Panel panel={panel} snap={snap} page={Math.floor(tick / panels.length)} qrBig={qrBig} held={held} />
                  </div>
                </div>
              </>
            )}
          </section>

          <aside className="flex min-h-0 min-w-0 flex-col gap-4" aria-label="What to do now">
            {ops ? (
              <>
                {opsControls}
                <Integrations snap={snap} />
              </>
            ) : (
              <div className="brackets border border-lime bg-lime-deep/40 p-5">
                <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">Next important step</p>
                <h2 className="mt-2 font-display text-[clamp(1.5rem,2.4vw,3rem)] leading-tight font-bold tracking-tight">{spec.next.title}</h2>
                <p className="mt-2 font-plex text-[clamp(0.85rem,0.95vw,1.1rem)] text-bright/80">{spec.next.body}</p>
                <a href={spec.next.href} className="mt-4 inline-flex min-h-11 items-center bg-lime px-4 font-plex text-sm text-ink hover:bg-bright">
                  {spec.next.cta} ↗
                </a>
              </div>
            )}
            <Announcements snap={snap} />
            <HelpLine snap={snap} />
          </aside>
        </main>

        {/* ── Metric strip (20%) ───────────────────────────────────────── */}
        <section aria-label="Live metrics" className="grid gap-3 sm:grid-cols-2 lg:h-[22vh] lg:min-h-[180px] lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
          {!ops && (
            <div className="flex items-center justify-center border border-hairline bg-surface p-2">
              <Ring
                value={displayValue(m[spec.primary]) == null ? null : (m[spec.primary]?.value ?? null)}
                denominator={m[spec.primary]?.denominator ?? null}
                label={`${METRICS[spec.primary].label}${METRICS[spec.primary].trust === "verified" ? " · ✓ Verified" : ""}`}
                tone={spec.primaryTone === "verified" ? "verified" : "neutral"}
                size={150}
              />
            </div>
          )}
          {(ops ? OPS_STRIP : spec.strip).map((name) => (
            <VerifiedMetric key={name} name={name} value={m[name]} held={held} idSuffix="-strip" size="compact" />
          ))}
        </section>

        {/* ── Footer: freshness, connection, pause ─────────────────────── */}
        <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-hairline pt-2 font-plex text-xs text-lightgray">
          <span className="font-pixel text-[10px] uppercase tracking-[0.2em]">
            {copy.name} / Mission Control
          </span>
          <span>
            Last <FreshnessStamp asOf={snap.as_of} state={freshness} source="verified aggregation" />
          </span>
          <span role="status">
            {conn === "streaming" ? "Live stream" : conn === "polling" ? "Polling every 15s" : conn === "reconnecting" ? "Reconnecting…" : "Connecting…"}
          </span>
          <span>Counts are de-duplicated. A failing run is a detection, not a confirmed bug.</span>
          {!ops && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              className="ml-auto inline-flex min-h-11 items-center border border-hairline px-3 hover:border-bright hover:text-bright"
            >
              {paused ? "Resume rotation" : "Pause rotation"}
            </button>
          )}
        </footer>
      </div>

      {snap.demo_shown && <DemoDataChip fixed>Illustrative · demo data (staging)</DemoDataChip>}

      {toast && (
        <div role="status" className={`fixed bottom-6 left-6 z-[90] max-w-[min(90vw,36rem)] border border-verified bg-ink p-4 ${reduced ? "" : "animate-rise"}`}>
          <div className="flex items-center gap-3">
            <FeedStatus status={toast.status} />
            <span className="font-plex text-xs text-lightgray">just now</span>
          </div>
          <p className="mt-2 font-display text-xl font-medium">{toast.title}</p>
          {toast.detail && <p className="font-plex text-sm text-lightgray">{toast.detail}</p>}
        </div>
      )}
    </div>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────────

function Panel({ panel, snap, page, qrBig, held }: { panel: PanelKey; snap: LiveSnapshot; page: number; qrBig: { help: ReactNode; ship: ReactNode; teams: ReactNode }; held: boolean }) {
  const m = snap.metrics;
  switch (panel) {
    case "welcome":
      return (
        <div className="grid h-full gap-6 sm:grid-cols-[1fr_auto]">
          <ol className="space-y-4 font-plex text-[clamp(1rem,1.3vw,1.6rem)]">
            {[
              ["Save your profile.", "Start at kaneclihack.sh/register; it takes two minutes."],
              ["Activate your passport.", "A personal account, independent of any team."],
              ["Find a team, or stay solo.", "Teams lock at 11:00. Scan the code to browse open seats."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="font-dots text-[1.5em] leading-none font-black text-lightgray">{i + 1}</span>
                <span>
                  <span className="block text-bright">{t}</span>
                  <span className="block text-[0.75em] text-lightgray">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="self-start">{qrBig.teams}</div>
        </div>
      );
    case "teams":
      return snap.recruiting.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {snap.recruiting.map((t) => (
            <li key={t.name} className="flex items-center justify-between gap-3 border border-hairline px-4 py-3">
              <span className="truncate font-display text-[clamp(1rem,1.3vw,1.5rem)]">{t.name}</span>
              <span className="shrink-0 font-plex text-xs text-lightgray">
                {t.open_seats} open seat{t.open_seats === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No teams are advertising open seats right now. Scan the team finder to post your own.</Empty>
      );
    case "activation":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <VerifiedMetric name="participants_activated" value={m.participants_activated} held={held} size="large" idSuffix="-panel" />
          <VerifiedMetric name="participants_registered" value={m.participants_registered} held={held} size="large" idSuffix="-panel" />
        </div>
      );
    case "activity":
      return <LiveActivityTicker items={snap.feed} limit={6} />;
    case "proof":
      return (
        <div className="grid gap-4 sm:grid-cols-[1fr_1.2fr]">
          <VerifiedMetric name="teams_verified" value={m.teams_verified} held={held} size="large" idSuffix="-panel" />
          <ol className="space-y-3 font-plex text-[clamp(0.95rem,1.1vw,1.35rem)]">
            {["Pair your machine with your team.", "Point Kane at one critical user flow.", "Report the run: verified runs count here, with evidence."].map((t, i) => (
              <li key={t} className="flex gap-3 border-b border-hairline pb-3">
                <span className="font-dots font-black text-lightgray">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        </div>
      );
    case "tips":
      return (
        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            ["A green run isn't a release.", "It proves the flows it ran, not the whole app."],
            ["A failure is a detection.", "Triage it before calling it a bug: product, environment, or flaky test?"],
            ["Claims need evidence.", "Anything without a run or pack shows as UNVERIFIED on your ship page."],
          ].map(([t, d]) => (
            <li key={t} className="brackets border border-hairline bg-surface p-4">
              <p className="font-display text-[clamp(1.1rem,1.4vw,1.75rem)] font-medium">{t}</p>
              <p className="mt-2 font-plex text-sm text-lightgray">{d}</p>
            </li>
          ))}
        </ul>
      );
    case "help":
      return (
        <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <p className="font-display text-[clamp(1.5rem,2.4vw,3rem)] leading-tight font-bold">Stuck for 15 minutes? Ask.</p>
            <p className="font-plex text-[clamp(0.95rem,1.1vw,1.3rem)] text-lightgray">
              Scan the code or open Help in your team hub. A mentor comes to your table. No details from your request are shown here.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <VerifiedMetric name="help_open" value={m.help_open} held={held} idSuffix="-panel" size="compact" />
              <VerifiedMetric name="help_median_claim_seconds" value={m.help_median_claim_seconds} held={held} idSuffix="-panel" size="compact" />
            </div>
          </div>
          <div className="self-start">{qrBig.help}</div>
        </div>
      );
    case "loops": {
      const loops = snap.feed.filter((f) => f.kind === "defect_reverified" || f.status === "proof");
      return <LiveActivityTicker items={loops} limit={6} empty="No closed loops published yet. Fix a confirmed bug, re-run Kane on the new commit, and it lands here." />;
    }
    case "lesson":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="brackets border border-hairline bg-surface p-5">
            <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Designed</p>
            <p className="mt-2 font-display text-[clamp(1.25rem,1.8vw,2.25rem)] font-medium">What your requirements say must work.</p>
          </div>
          <div className="brackets border border-hairline bg-surface p-5">
            <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Proven</p>
            <p className="mt-2 font-display text-[clamp(1.25rem,1.8vw,2.25rem)] font-medium">What Kane actually ran, with a sealed pack.</p>
          </div>
          <p className="font-plex text-sm text-lightgray sm:col-span-2">
            The gap between the two is your next task. Coverage is shown per team on your proof page only. Projects aren&rsquo;t comparable, so there is no room-wide
            percentage.
          </p>
        </div>
      );
    case "checklist":
      return (
        <ol className="grid gap-2 font-plex text-[clamp(0.95rem,1.15vw,1.4rem)]">
          {[
            "Repo URL and the full 40-character commit SHA",
            "A working link (or how to run it)",
            "Kane evidence: a verified run or evidence pack",
            "Story and deck (optional; the HTML deck works with no edits)",
            "Finalize → your S- receipt with the server time",
          ].map((t, i) => (
            <li key={t} className="flex items-center gap-4 border border-hairline px-4 py-3">
              <span className="font-dots font-black text-lightgray">{i + 1}</span>
              {t}
            </li>
          ))}
          <li className="px-1 pt-2 text-[0.75em] text-warning">
            <span aria-hidden="true">◷ </span>Can&rsquo;t finalize because of an outage? Go to the help desk before the lock; staff write a manual receipt with the real time.
          </li>
        </ol>
      );
    case "cards": {
      const per = 3;
      const pages = Math.max(1, Math.ceil(snap.showcase.length / per));
      const cards = snap.showcase.slice((page % pages) * per, (page % pages) * per + per);
      return cards.length ? (
        <div className="grid h-full gap-4 sm:grid-cols-3">
          {cards.map((c) => (
            <a key={c.slug} href={`/ship/${c.slug}`} className="brackets flex min-w-0 flex-col gap-3 border border-hairline bg-surface p-5 hover:border-bright">
              <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{c.project_type.replace("_", " ")}</p>
              <p className="font-display text-[clamp(1.25rem,1.9vw,2.4rem)] leading-tight font-bold">{c.name}</p>
              <p className="font-plex text-sm text-lightgray">{c.team}</p>
              {c.summary && <p className="line-clamp-4 font-plex text-[clamp(0.85rem,0.95vw,1.1rem)] text-bright/80">{c.summary}</p>}
              <div className="mt-auto">{c.submitted ? <StatusPill tone="verified">Receipt · Verified</StatusPill> : <StatusPill tone="unverified">Not submitted</StatusPill>}</div>
            </a>
          ))}
          {pages > 1 && <p className="font-plex text-xs text-lightgray sm:col-span-3">Page {(page % pages) + 1} of {pages}</p>}
        </div>
      ) : (
        <Empty>Project cards appear here when teams publish their ship pages.</Empty>
      );
    }
    case "aggregates": {
      const names = (Object.keys(m) as (keyof typeof m)[]).filter((k) => METRICS[k].audience === "public");
      return (
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {names.map((k) => (
            <li key={k} className="flex items-baseline justify-between gap-4 border-b border-hairline py-2">
              <span className="font-plex text-sm text-lightgray">{METRICS[k].label}</span>
              <span className="font-dots text-[clamp(1.25rem,1.8vw,2.25rem)] font-black">{displayValue(m[k]) ?? "—"}</span>
            </li>
          ))}
        </ul>
      );
    }
    case "gallery": {
      const ships = snap.showcase.filter((s) => s.ship_page);
      return (
        <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
          {ships.length ? (
            <ul className="grid content-start gap-2 sm:grid-cols-2">
              {ships.slice(0, 16).map((s) => (
                <li key={s.slug}>
                  <a href={`/ship/${s.slug}`} className="flex min-h-11 items-center justify-between gap-3 border border-hairline px-4 py-2 hover:border-bright">
                    <span className="truncate font-display text-[clamp(1rem,1.2vw,1.4rem)]">{s.name}</span>
                    <span className="shrink-0 font-plex text-xs text-lightgray">/ship/{s.slug}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No ship pages are published yet.</Empty>
          )}
          <div className="self-start">{qrBig.ship}</div>
        </div>
      );
    }
  }
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="border border-dashed border-hairline p-5 font-plex text-sm text-lightgray">{children}</p>;
}

function Announcements({ snap }: { snap: LiveSnapshot }) {
  if (snap.announcements.length === 0) return null;
  const [first, ...rest] = snap.announcements;
  return (
    <section aria-label="Announcements" className="border border-hairline bg-surface p-5">
      <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Announcement</p>
      <p className="mt-2 font-display text-[clamp(1.2rem,1.7vw,2rem)] leading-tight font-medium">{first.title}</p>
      {first.body && <p className="mt-1 line-clamp-3 font-plex text-sm text-bright/80">{first.body}</p>}
      {rest.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-hairline pt-3 font-plex text-xs text-lightgray">
          {rest.slice(0, 2).map((a) => (
            <li key={a.id} className="truncate">
              {a.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HelpLine({ snap }: { snap: LiveSnapshot }) {
  const open = displayValue(snap.metrics.help_open);
  const wait = displayValue(snap.metrics.help_median_claim_seconds);
  return (
    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3 font-plex text-sm">
      <span>
        <span aria-hidden="true" className="text-bright">
          ●{" "}
        </span>
        Mentor queue open · {open ?? "—"} request{open === "1" ? "" : "s"} waiting or in progress
        {wait && <span className="text-lightgray"> · median wait {wait}</span>}
      </span>
      <span className="text-lightgray">Find your team · Request help · See schedule ↗</span>
    </div>
  );
}

// ── Ops variant ──────────────────────────────────────────────────────────────

function age(s: number) {
  return formatSeconds(s);
}

function OpsBoardView({ snap }: { snap: LiveSnapshot }) {
  const board = snap.ops;
  if (!board) return <Empty>Ops data unavailable. The help desk still works.</Empty>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <section aria-label="Help queue">
        <h2 className="mb-2 font-display text-[clamp(1.25rem,1.6vw,2rem)] font-medium">Help queue · oldest first</h2>
        {board.help.length ? (
          <table className="w-full border-collapse font-plex text-sm">
            <thead className="text-left text-xs text-lightgray">
              <tr className="border-b border-hairline">
                <th className="py-2 pr-3 font-normal">Code</th>
                <th className="py-2 pr-3 font-normal">Category</th>
                <th className="py-2 pr-3 font-normal">Table</th>
                <th className="py-2 pr-3 font-normal">Status</th>
                <th className="py-2 pr-3 font-normal">Age</th>
                <th className="py-2 font-normal">Mentor</th>
              </tr>
            </thead>
            <tbody>
              {board.help.map((h) => {
                const waiting = h.status === "new" || h.status === "triaged";
                const late = waiting && h.age_s > 600;
                return (
                  <tr key={h.code} className="border-b border-hairline">
                    <td className="py-2 pr-3">{h.code}</td>
                    <td className="py-2 pr-3">{h.category.replace("_", " ")}</td>
                    <td className="py-2 pr-3">{h.table ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {waiting ? <StatusPill tone="pending">{h.priority === "urgent" ? "Urgent · waiting" : "Waiting"}</StatusPill> : <span className="text-lightgray">{h.status.replace("_", " ")}</span>}
                    </td>
                    <td className={`py-2 pr-3 ${late ? "text-warning" : ""}`}>
                      {age(h.age_s)}
                      {late && <span className="sr-only"> (over 10 minutes unclaimed)</span>}
                    </td>
                    <td className="py-2">{h.mentor ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>Queue is empty.</Empty>
        )}
      </section>
      <section aria-label="Open incidents">
        <h2 className="mb-2 font-display text-[clamp(1.25rem,1.6vw,2rem)] font-medium">Open incidents</h2>
        {board.incidents.length ? (
          <ul className="space-y-2">
            {board.incidents.map((i) => (
              <li key={i.code} className="flex flex-wrap items-baseline gap-3 border border-danger bg-danger-deep px-4 py-2 font-plex text-sm">
                <span className="font-pixel text-[10px] uppercase tracking-[0.2em] text-danger">
                  ✕ {i.code} · {i.severity}
                </span>
                <span>{i.subsystem}</span>
                <span className="text-lightgray">{i.description}</span>
                <span className="ml-auto text-lightgray">{age(i.age_s)} open</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No open incidents.</Empty>
        )}
      </section>
    </div>
  );
}

function Integrations({ snap }: { snap: LiveSnapshot }) {
  const list = snap.ops?.integrations ?? [];
  if (!list.length) return null;
  return (
    <section aria-label="Integrations" className="border border-hairline bg-surface p-4">
      <p className="mb-2 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Integrations</p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-plex text-xs">
        {list.map((i) => (
          <li key={i.system} className="flex items-center justify-between gap-2">
            <span>{i.system}</span>
            <span className={i.status === "ok" ? "text-lightgray" : i.status === "down" ? "text-danger" : "text-warning"}>
              {i.paused ? "paused" : i.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
