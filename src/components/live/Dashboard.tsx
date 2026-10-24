"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { Phase } from "@/lib/event";
import type { DashboardData, Series } from "@/server/dashboard";
import type { FeedItem } from "@/server/metrics";
import type { OrgMetrics, RunStatus } from "@/server/orgMetrics";
import { displayValue, type MetricName } from "./definitions";
import { PHASE_SPECS } from "./phases";

// /dashboard (public). Layout from the Mission Control design: header with
// phase tabs, hero (phase headline + one big count), velocity chart, a metric
// strip, then three story cards. Polls every 10s; on failure the last values
// stay with a DELAYED/OFFLINE chip, never zeros. Unknown → "—".

const POLL_MS = 10_000;
const TABS: { phase: Phase; label: string }[] = [
  { phase: "arrival", label: "Arrival" },
  { phase: "build", label: "Build" },
  { phase: "verify", label: "Verify" },
  { phase: "submit", label: "Final call" },
  { phase: "showtime", label: "Showtime" },
];

const mono = "font-plex uppercase tracking-[0.18em]";

function useServerClock(serverTime: string) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // serverTime just arrived, so the offset is taken now.
    const offset = new Date(serverTime).getTime() - Date.now();
    const tick = () => setNow(Date.now() + offset);
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [serverTime]);
  return now;
}

const pct = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? `${Math.round((a / b) * 100)}%` : null);
const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US"));

export default function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial);
  const [failing, setFailing] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/v1/dashboard", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const env = (await res.json()) as { data?: DashboardData };
        if (alive && env.data) {
          setData(env.data);
          setFailing(false);
        }
      } catch {
        if (alive) setFailing(true);
      }
    };
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const { snap, people } = data;
  const phase = snap.event.phase;
  const spec = PHASE_SPECS[phase];
  const m = snap.metrics;
  const val = (name: MetricName) => displayValue(m[name]) ?? "—";
  const raw = (name: MetricName) => (m[name]?.withheld ? null : (m[name]?.value ?? null));

  const now = useServerClock(snap.server_time);
  const tz = snap.event.timezone;
  const clock = now == null ? "--:--:--" : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz }).format(now);
  const day = now == null ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(now).toUpperCase();

  const arriving = phase === "arrival";
  const chart = arriving ? data.arrivals : data.runs;
  const state = failing ? (snap.freshness_state === "fresh" ? "delayed" : snap.freshness_state) : snap.freshness_state;

  const teamsActive = raw("teams_active");
  const teamsVerified = raw("teams_verified");
  const moment = arriving
    ? { chip: "Doors open", title: `${fmt(people.signed_up)} people have saved their profile.`, body: "Save your profile at kaneclihack.sh/register, then find a team.", a: people.signed_up, b: people.registered, unit: "on the guest list" }
    : { chip: "First proof unlocked", title: `${fmt(teamsVerified)} teams have their first green Kane run.`, body: "The first trusted passed run tied to a real project unlocks a team milestone.", a: teamsVerified, b: teamsActive, unit: "active teams" };

  return (
    <div className="fixed inset-0 z-[80] overflow-x-hidden overflow-y-auto bg-[#0a0d1c] font-display text-[#eeeaff]">
      <div className="mx-auto flex min-h-full max-w-[1920px] flex-col gap-4 px-4 py-4 lg:gap-3 lg:px-7 lg:py-3">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1d2140] pb-3">
          <div className="flex items-center gap-3">
            <Image src="/icon.png" alt="" width={44} height={44} className="size-11 rounded-lg border border-[#2a2f55] bg-[#151935] p-1" />
            <div>
              <p className="text-base font-bold leading-none">
                KANE CLI <span className="font-plex text-xs font-normal text-[#9a96c8]">{"// HACK 2026"}</span>
              </p>
              <p className={`${mono} mt-1 text-[10px] text-[#cfcaf3]`}>
                Mission control <span className="text-[#6e6a9a]">/ &nbsp;{spec.kicker}</span>
              </p>
            </div>
          </div>
          <nav aria-label="Event phases" className="order-3 w-full overflow-x-auto lg:order-none lg:w-auto">
            <ol className="flex w-max gap-1 rounded-xl border border-[#262b4d] bg-[#0e1226] p-1">
              {TABS.map((t, i) => {
                const on = t.phase === phase || (phase === "recap" && t.phase === "showtime");
                return (
                  <li key={t.phase} aria-current={on ? "step" : undefined} className={`rounded-lg px-3 py-2 text-xs lg:px-4 lg:text-sm ${on ? "border border-[#7c6cf0] bg-[#2a2560] text-white" : "border border-transparent text-[#a9a5d3]"}`}>
                    <span className="mr-2 font-plex text-[10px] text-[#7d79ad]">0{i + 1}</span>
                    {t.label}
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="flex items-center gap-4">
            <StateChip state={state} demo={snap.demo_shown} />
            <div className="text-right">
              <p className="text-xl font-bold tabular-nums lg:text-2xl" suppressHydrationWarning>{clock}</p>
              <p className="font-plex text-[10px] tracking-[0.18em] text-[#8a86b8]" suppressHydrationWarning>PT · {day}</p>
            </div>
          </div>
        </header>

        {/* On-air line */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`${mono} flex items-center gap-3 text-[11px] font-semibold`}>
            On air <span className="inline-flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#4ade9a]" aria-hidden />Hackathon pulse</span>
            <span className="hidden text-[#6e6a9a] sm:inline">|&nbsp; {spec.index} / {spec.kicker}</span>
          </p>
          <p className="text-sm text-[#cfcaf3]">{spec.sub.split(". ")[0]}.</p>
        </div>

        {/* Hero + chart */}
        <section className="grid overflow-hidden rounded-2xl border border-[#262b4d] bg-gradient-to-br from-[#1b1840] via-[#121530] to-[#0f1228] lg:grid-cols-[44%_1fr]">
          <div className="relative border-b border-[#262b4d] p-6 lg:border-r lg:border-b-0 lg:px-10 lg:py-7">
            <p className={`${mono} flex items-center gap-3 text-[10px] text-[#b9b3ef]`}><span className="h-px w-6 bg-[#8b7cf6]" aria-hidden />{spec.kicker}</p>
            <h1 className="mt-3 text-5xl font-extrabold leading-[0.95] tracking-tight lg:text-[4.25rem]">
              {spec.headline[0]}
              <br />
              <span className="font-light italic text-[#a79bff]">{spec.headline[1]}</span>
            </h1>
            <p className="mt-4 max-w-md text-base text-[#c3bfe6] lg:text-lg">{spec.sub}</p>
            <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-2">
              <p className="text-8xl font-extrabold leading-none tracking-tighter tabular-nums lg:text-[7.5rem]">{arriving ? fmt(people.signed_up) : val(spec.primary)}</p>
              <div className="pb-3">
                <p className={`${mono} text-xs font-semibold`}>{arriving ? "People signed up" : primaryLabel(spec.primary)}</p>
                <p className="mt-1 max-w-[14rem] text-xs text-[#8f8bbd]">
                  {arriving ? `profiles saved · ${fmt(people.registered)} on the guest list` : "Verifiable run outcomes, not build count"}
                </p>
              </div>
            </div>
          </div>
          <Velocity series={chart} title={arriving ? "Arrivals" : "Verification velocity"} unit={arriving ? "Sign-ups / last 15 min" : "Runs / last 15 min"} footer={arriving ? "Profiles saved on the site" : "Actual run endings · not builds"} demo={snap.demo_shown} />
        </section>

        {/* Metric strip */}
        <section aria-label="Live numbers" className="grid gap-px overflow-hidden rounded-2xl border border-[#262b4d] bg-[#262b4d] sm:grid-cols-2 lg:grid-cols-4">
          <Tile icon="●" tone="green" label="Signed up" value={fmt(people.signed_up)} note={`of ${fmt(people.registered)} on the guest list${pct(people.signed_up, people.registered) ? ` · ${pct(people.signed_up, people.registered)}` : ""}`} />
          <Tile icon="○" tone="green" label="First proof unlocked" value={val("teams_verified")} note={`of ${fmt(teamsActive)} active teams${pct(teamsVerified, teamsActive) ? ` · ${pct(teamsVerified, teamsActive)}` : ""}`} />
          <Tile icon="↗" tone="purple" label="Builds validated" value={val("builds_validated")} note="distinct commit SHAs" />
          <Tile icon="⌁" tone="amber" label="Potential detections" value={val("bugs_detected")} note="not confirmed bugs" />
        </section>

        <OrgUsage org={data.org} />

        {/* Story cards */}
        <section className="grid gap-4 lg:grid-cols-3">
          <Card title="The moment" index="01 / The room">
            <Chip>{moment.chip}</Chip>
            <h2 className="mt-3 text-2xl font-bold tracking-tight lg:text-[1.75rem]">{moment.title}</h2>
            <p className="mt-3 text-base text-[#b9b5dd] lg:text-lg">{moment.body}</p>
            <div className="mt-auto pt-6">
              <div className="h-1.5 overflow-hidden rounded-full bg-[#262b4d]" role="progressbar" aria-valuenow={moment.a ?? undefined} aria-valuemax={moment.b ?? undefined} aria-label={moment.chip}>
                <div className="h-full rounded-full bg-[#4ade9a]" style={{ width: moment.a != null && moment.b ? `${Math.min(100, (moment.a / moment.b) * 100)}%` : "0%" }} />
              </div>
              <p className={`${mono} mt-4 text-[11px] text-[#cfcaf3]`}>{fmt(moment.a)} / {fmt(moment.b)} {moment.unit}</p>
            </div>
          </Card>
          <Card title="Live activity" index="02 / In motion">
            <Feed items={snap.feed.slice(0, 4)} tz={tz} />
            <p className={`${mono} mt-auto pt-4 text-[9px] text-[#6e6a9a]`}>
              {snap.demo_shown ? "Example events · names are fictional · " : ""}At most 1 highlight per team / window
            </p>
          </Card>
          <Card title="What to do next" index="03 / Action">
            <Chip>Next move</Chip>
            <h2 className="mt-3 text-2xl font-bold tracking-tight lg:text-[1.75rem]">{spec.next.title}</h2>
            <p className="mt-3 text-base text-[#b9b5dd] lg:text-lg">{spec.next.body}</p>
            <a href={spec.next.href} className="mt-auto flex items-center justify-between border-t border-[#262b4d] pt-5 text-sm">
              <span className="font-plex font-semibold">kaneclihack.sh{spec.next.href}</span>
              <span className={`${mono} text-xs text-[#cfcaf3]`}>{spec.next.cta} ↗</span>
            </a>
          </Card>
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[#1d2140] pt-3 text-sm">
          <p className="flex items-center gap-2"><span className="text-[#a79bff]" aria-hidden>✳</span>Next mission: {spec.next.title.toLowerCase()}</p>
          <p className={`${mono} text-[10px] text-[#8a86b8]`}>
            Help <span className="normal-case text-[#cfcaf3]">kaneclihack.sh/help</span> &nbsp;•&nbsp; Your team <span className="normal-case text-[#cfcaf3]">kaneclihack.sh/passport</span>
          </p>
          <p className="text-sm font-semibold text-[#cfcaf3]">TestMu AI</p>
        </footer>
      </div>
    </div>
  );
}

function primaryLabel(name: MetricName) {
  return name === "kane_executions" ? "Completed Kane executions" : name.replace(/_/g, " ");
}

function StateChip({ state, demo }: { state: string; demo: boolean }) {
  const label = demo ? "Demo data" : state === "fresh" ? "Live" : state;
  const dot = demo ? "bg-[#8b7cf6]" : state === "fresh" ? "bg-[#4ade9a]" : state === "delayed" ? "bg-[#f2b45a]" : "bg-[#f26d6d]";
  return (
    <span className={`${mono} inline-flex items-center gap-2 rounded-full border border-[#3b3570] bg-[#1a1840] px-3 py-1.5 text-[10px] font-semibold`}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}

function Velocity({ series, title, unit, footer, demo }: { series: Series; title: string; unit: string; footer: string; demo: boolean }) {
  const counts = series.counts;
  const max = useMemo(() => Math.max(1, ...(counts ?? [0])), [counts]);
  const hot = counts ? counts.length - 9 : 0; // the last 45 minutes are highlighted
  return (
    <div className="flex flex-col p-6 lg:px-8 lg:py-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={`${mono} text-[11px] text-[#b9b3ef]`}>Trailing 200 minutes · 5-min buckets</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight lg:text-3xl">{title}</h2>
        </div>
        <div className="text-right">
          <p className="text-6xl font-extrabold leading-none tracking-tighter tabular-nums lg:text-7xl">{fmt(series.last15)}</p>
          <p className={`${mono} mt-1 text-[10px] text-[#cfcaf3]`}>{unit}</p>
        </div>
      </div>
      <div className="mt-4 flex h-44 items-end gap-[3px] border-b border-[#2a2f55] lg:h-52 lg:gap-1.5" role="img" aria-label={counts ? `${title}: ${series.last15 ?? 0} in the last 15 minutes` : `${title}: unavailable`}>
        {counts ? (
          counts.map((c, i) => (
            <div
              key={i}
              className={`flex-1 rounded-t-sm ${i >= hot ? "bg-gradient-to-t from-[#7b63f2] to-[#a99cff]" : "bg-[#3a3870]"}`}
              style={{ height: c ? `${Math.max(4, (c / max) * 100)}%` : "2px" }}
              title={`${c}`}
            />
          ))
        ) : (
          <p className="m-auto font-plex text-sm text-[#8a86b8]">Series unavailable right now</p>
        )}
      </div>
      <div className={`${mono} mt-2 flex justify-between text-[9px] text-[#8a86b8]`}>
        <span>−200 min</span>
        <span>−100 min</span>
        <span>Now</span>
      </div>
      <div className={`${mono} mt-3 flex justify-between text-[10px] text-[#8a86b8]`}>
        <span>{footer}</span>
        {demo && <span className="flex items-center gap-2 text-[#cfcaf3]"><span className="size-2 rounded-sm bg-[#8b7cf6]" aria-hidden />Illustrative</span>}
      </div>
    </div>
  );
}

const TONES = {
  green: "border-[#235a45] bg-[#12302a] text-[#4ade9a]",
  purple: "border-[#3b3570] bg-[#211d4a] text-[#a79bff]",
  amber: "border-[#5a4220] bg-[#2e2414] text-[#f2b45a]",
} as const;

function Tile({ icon, tone, label, value, note }: { icon: string; tone: keyof typeof TONES; label: string; value: string; note: string }) {
  return (
    <div className="flex items-center gap-4 bg-[#0f1228] px-5 py-4">
      <span className={`grid size-11 shrink-0 place-items-center rounded-xl border ${TONES[tone]}`} aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className={`${mono} text-[10px] font-semibold text-[#cfcaf3]`}>{label}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="text-4xl font-extrabold tabular-nums">{value}</span>
          <span className="font-plex text-xs text-[#a9a5d3]">{note}</span>
        </p>
      </div>
    </div>
  );
}

function Card({ title, index, children }: { title: string; index: string; children: React.ReactNode }) {
  return (
    <article className="flex flex-col rounded-2xl border border-[#262b4d] bg-[#0f1228] p-5">
      <div className={`${mono} mb-4 flex justify-between text-[11px]`}>
        <span className="font-semibold">{title}</span>
        <span className="text-[#8b7cf6]">{index}</span>
      </div>
      {children}
    </article>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className={`${mono} inline-flex w-max rounded-full border border-[#4a4290] bg-[#211d4a] px-3 py-1.5 text-[10px] font-semibold tracking-[0.1em]`}>{children}</span>;
}

const FEED_PILL: Record<FeedItem["status"], { label: string; cls: string }> = {
  proof: { label: "Pass", cls: "border-[#235a45] bg-[#12302a] text-[#4ade9a]" },
  linked: { label: "Build", cls: "border-[#3b3570] bg-[#211d4a] text-[#a79bff]" },
  detected: { label: "Detected", cls: "border-[#5a4220] bg-[#2e2414] text-[#f2b45a]" },
  info: { label: "Info", cls: "border-[#2a2f55] bg-[#151935] text-[#cfcaf3]" },
};

function Feed({ items, tz }: { items: FeedItem[]; tz: string }) {
  if (!items.length) return <p className="py-6 text-base text-[#8f8bbd]">Quiet so far. The first verified runs will show up here.</p>;
  const t = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: false, timeZone: tz });
  return (
    <ul className="divide-y divide-[#1f2343]">
      {items.map((f) => {
        const pill = FEED_PILL[f.status];
        return (
          <li key={f.id} className="flex items-center gap-4 py-2.5">
            <span className="w-11 shrink-0 font-plex text-xs text-[#8a86b8]">{t.format(new Date(f.at))}</span>
            <span className="min-w-0 flex-1 truncate text-base lg:text-lg">
              {f.title}
            </span>
            <span className={`${mono} shrink-0 rounded-md border px-3 py-1 text-[10px] font-semibold ${pill.cls}`}>{pill.label}</span>
          </li>
        );
      })}
    </ul>
  );
}


const STATUS_TONE: Record<RunStatus, string> = {
  Passed: "bg-[#4ade9a]",
  Failed: "bg-[#f26d6d]",
  "In Progress": "bg-[#a79bff]",
  "Not Started": "bg-[#5b5890]",
  Skipped: "bg-[#f2b45a]",
  Unknown: "bg-[#3a3870]",
};
const RUN_STATUSES = Object.keys(STATUS_TONE) as RunStatus[];

// TestMu AI Insights totals for the event orgs (server-fetched, cached 60s).
function OrgUsage({ org }: { org: OrgMetrics | null }) {
  const v = (x: number | undefined) => fmt(org ? x : null);
  const runs = org?.testRuns;
  const range = org ? `${org.startDate} → ${org.endDate}` : "Unavailable right now";
  return (
    <section aria-label="TestMu AI usage" className="rounded-2xl border border-[#262b4d] bg-[#0f1228] p-5">
      <div className={`${mono} mb-4 flex flex-wrap justify-between gap-2 text-[11px]`}>
        <span className="font-semibold">TestMu AI usage · Kane CLI and test runs</span>
        <span className="text-[#8b7cf6]">{range}</span>
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border border-[#262b4d] bg-[#262b4d] sm:grid-cols-2 lg:grid-cols-5">
        <Tile icon="▶" tone="purple" label="Kane CLI tests" value={v(org?.kaneTestsRun)} note="run" />
        <Tile icon="◆" tone="purple" label="Kane credits" value={v(org?.kaneCredits)} note="used" />
        <Tile icon="≡" tone="green" label="Automated cases" value={v(org?.automatedTestCases)} note="test cases" />
        <Tile icon="⌁" tone="amber" label="Bugs reported" value={v(org?.bugsReported)} note="in Test Manager" />
        <Tile icon="⇶" tone="green" label="HyperExecute" value={v(org?.hyperexecuteJobs)} note="jobs" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div>
          <p className="flex items-baseline justify-between">
            <span className={`${mono} text-[10px] font-semibold text-[#cfcaf3]`}>Test runs by status</span>
            <span className="text-2xl font-extrabold tabular-nums">{v(runs?.total)}</span>
          </p>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-[#262b4d]" role="img" aria-label={runs ? RUN_STATUSES.map((s) => `${s} ${runs.byStatus[s]}`).join(", ") : "Test runs unavailable"}>
            {runs && runs.total > 0 && RUN_STATUSES.map((s) => (runs.byStatus[s] ? <div key={s} className={STATUS_TONE[s]} style={{ width: `${(runs.byStatus[s] / runs.total) * 100}%` }} /> : null))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {RUN_STATUSES.map((s) => (
              <li key={s} className="flex items-center gap-2 font-plex text-xs text-[#a9a5d3]">
                <span className={`size-2 rounded-sm ${STATUS_TONE[s]}`} aria-hidden />
                {s} <span className="ml-auto tabular-nums text-[#eeeaff]">{v(runs?.byStatus[s])}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Devices title="Desktop" list={org?.devices.desktop} />
          <Devices title="Mobile" list={org?.devices.mobile} />
        </div>
      </div>
    </section>
  );
}

function Devices({ title, list }: { title: string; list: { name: string; count: number | null }[] | undefined }) {
  return (
    <div>
      <p className={`${mono} text-[10px] font-semibold text-[#cfcaf3]`}>{title} devices</p>
      {!list ? (
        <p className="mt-2 font-plex text-xs text-[#8a86b8]">—</p>
      ) : list.length === 0 ? (
        <p className="mt-2 font-plex text-xs text-[#8a86b8]">None used yet</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#1f2343]">
          {list.slice(0, 5).map((d) => (
            <li key={d.name} className="flex justify-between gap-3 py-1.5 font-plex text-xs">
              <span className="truncate">{d.name}</span>
              {d.count != null && <span className="tabular-nums text-[#a9a5d3]">{fmt(d.count)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
