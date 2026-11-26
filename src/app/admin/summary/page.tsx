import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { onlineEvent } from "@/data/online";
import { isAdmin } from "@/lib/online/admin";
import { onlineSummary } from "@/lib/online/summary";

export const metadata: Metadata = { title: { absolute: `Summary · ${onlineEvent.name}` }, robots: { index: false, follow: false } };

// /admin/summary: where the online hackathon stands, on one screen, made to be
// screenshotted. Same sign-in as /admin. Read-only.
export default function SummaryPage() {
  return (
    <div data-online className="min-h-svh">
      <style>{`body:has([data-online]) > #nav-bar, body:has([data-online]) > footer { display: none; } [data-online] { --lightgray: #a8a8a8; }`}</style>
      <Suspense fallback={<p className="container-page py-16 font-plex text-sm text-lightgray">Loading…</p>}>
        <Body />
      </Suspense>
    </div>
  );
}

const label = "font-pixel text-[11px] uppercase tracking-[0.15em] text-lightgray";
const panel = "border border-hairline bg-surface p-5";
const n = (v: number) => v.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const IST = "Asia/Kolkata";

async function Body() {
  if (!(await isAdmin())) redirect("/admin");
  const s = await onlineSummary();
  const now = new Date();
  const left = new Date(onlineEvent.submissionDeadline).getTime() - now.getTime();
  const closes = left <= 0 ? "Submissions closed" : left < 86_400_000 ? `Submissions close in ${Math.ceil(left / 3_600_000)} hours` : `Submissions close in ${Math.ceil(left / 86_400_000)} days`;
  const clock = (d: Date) => `${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST }).format(d)} IST`;

  const tiles = [
    { name: "People registered", value: s.people, note: `${n(s.on_team)} on a team` },
    { name: "Teams", value: s.teams, note: `${n(s.started)} started a submission` },
    { name: "Projects submitted", value: s.submitted, note: `by ${n(s.builders)} builders`, accent: true },
    { name: "Social posts", value: s.posts, note: `from ${n(s.projectsPosting)} projects`, accent: true },
    { name: "Likes and comments", value: s.likes + s.comments, note: `${n(s.likes)} likes · ${n(s.comments)} comments`, accent: true },
    { name: "Demo video views", value: s.views, note: "YouTube" },
  ];
  const funnel = [
    { name: "Teams created", value: s.teams },
    { name: "Started a submission", value: s.started },
    { name: "Submitted", value: s.submitted },
  ];
  const maxPosts = Math.max(1, ...s.channels.map((c) => c.posts));
  const maxAgent = Math.max(1, ...s.builtWith.map((a) => a.n));

  return (
    <main className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">{onlineEvent.facts[0]} · {closes}</p>
          <h1 className="mt-2 font-dots text-4xl leading-none font-black text-bright sm:text-5xl">
            {onlineEvent.name}<span className="text-lime">.</span>
          </h1>
        </div>
        <p className="font-plex text-sm text-lightgray">
          As of <span className="text-bright">{clock(now)}</span> ·{" "}
          <Link href="/admin" className="underline decoration-hairline underline-offset-4 hover:text-bright">Organiser view</Link>
        </p>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-px border border-hairline bg-hairline md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.name} className="bg-ink p-5">
            <dt className={label}>{t.name}</dt>
            <dd className={`mt-2 font-dots text-5xl leading-none font-black ${t.accent ? "text-lime" : "text-bright"}`}>{n(t.value)}</dd>
            <dd className="mt-2 font-plex text-xs text-lightgray">{t.note}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <DayBars title="Registrations per day" total={s.people} days={s.days.map((d) => ({ day: d.day, value: d.registered }))} />
        <DayBars title="Projects submitted per day" total={s.submitted} days={s.days.map((d) => ({ day: d.day, value: d.submitted }))} />
        <section className={panel}>
          <h2 className={label}>From team to submission</h2>
          <ul className="mt-5 space-y-4">
            {funnel.map((f) => (
              <li key={f.name}>
                <div className="flex items-baseline justify-between gap-3 font-plex text-sm">
                  <span className="text-bright">{f.name}</span>
                  <span className="tabular-nums text-lightgray">
                    <span className="text-bright">{n(f.value)}</span> · {pct(f.value, s.teams)}
                  </span>
                </div>
                <div className="mt-1.5 h-3 bg-ink">
                  <div className="h-full rounded-r-sm bg-lime" style={{ width: `${s.teams > 0 ? Math.max(1, (f.value / s.teams) * 100) : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-5 font-plex text-xs text-lightgray">
            {n(s.emails_sent)} emails sent, {pct(s.emails_opened, s.emails_sent)} opened.
          </p>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className={`${panel} lg:col-span-2`}>
          <h2 className={label}>Posts by channel</h2>
          <table className="mt-4 w-full border-separate border-spacing-0 font-plex text-sm">
            <thead>
              <tr className="text-right text-xs text-lightgray">
                <th scope="col" className="pb-2 text-left font-normal">Channel</th>
                <th scope="col" className="w-[38%] pb-2 text-left font-normal">Posts</th>
                <th scope="col" className="pb-2 font-normal">Projects</th>
                <th scope="col" className="pb-2 font-normal">Likes</th>
                <th scope="col" className="pb-2 font-normal">Comments</th>
              </tr>
            </thead>
            <tbody>
              {s.channels.map((c) => (
                <tr key={c.key} className="text-right tabular-nums">
                  <th scope="row" className="border-t border-dashed border-hairline py-2.5 pr-3 text-left font-normal whitespace-nowrap text-bright">{c.label}</th>
                  <td className="border-t border-dashed border-hairline py-2.5 pr-4">
                    <span className="flex items-center gap-2">
                      <span className="h-3 rounded-r-sm bg-lime" style={{ width: `${Math.max(1, (c.posts / maxPosts) * 82)}%` }} />
                      <span className="text-bright">{n(c.posts)}</span>
                    </span>
                  </td>
                  <td className="border-t border-dashed border-hairline py-2.5 text-bright">{n(c.projects)}</td>
                  <td className="border-t border-dashed border-hairline py-2.5 text-bright">{c.read > 0 ? n(c.likes) : "—"}</td>
                  <td className="border-t border-dashed border-hairline py-2.5 text-bright">{c.read > 0 && c.key !== "youtube" ? n(c.comments) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="grid gap-6">
          <section className={panel}>
            <h2 className={label}>Most engagement</h2>
            <ol className="mt-4 space-y-2.5 font-plex text-sm">
              {s.topProjects.map((p, i) => (
                <li key={p.project} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-bright">
                    <span className="mr-2 tabular-nums text-lightgray">{i + 1}</span>
                    {p.project}
                  </span>
                  <span className="shrink-0 tabular-nums text-lightgray">
                    <span className="text-bright">{n(p.engagement)}</span> · {p.posts} {p.posts === 1 ? "post" : "posts"}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section className={panel}>
            <h2 className={label}>Built with</h2>
            <ul className="mt-4 space-y-2 font-plex text-sm">
              {s.builtWith.map((a) => (
                <li key={a.name} className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
                  <span className="text-bright">{a.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="h-3 rounded-r-sm bg-lime" style={{ width: `${Math.max(2, (a.n / maxAgent) * 80)}%` }} />
                    <span className="tabular-nums text-bright">{a.n}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <p className="mt-6 font-plex text-xs leading-relaxed text-lightgray">
        Posts are the X, LinkedIn, YouTube, Reddit, Hacker News and blog links in submitted projects. Likes and comments are public counts for {n(s.postsRead)} of {n(s.posts)} posts
        {s.engagementReadAt ? `, read ${clock(s.engagementReadAt)}` : ""}; the rest publish none or did not answer, so the true total is higher. Most engagement is likes plus comments across a project&apos;s posts. Built with counts a
        project once for each agent it names.
      </p>
    </main>
  );
}

/** One measure per day as bars from a zero baseline; the peak and the latest day carry their number. */
function DayBars({ title, total, days }: { title: string; total: number; days: { day: string; value: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  const peak = days.findIndex((d) => d.value === max);
  return (
    <section className={panel}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={label}>{title}</h2>
        <span className="font-plex text-xs text-lightgray">
          <span className="tabular-nums text-bright">{n(total)}</span> total
        </span>
      </div>
      <div role="img" aria-label={`${title}: ${days.map((d) => `${d.day} ${d.value}`).join(", ")}`} className="mt-4 flex h-36 items-end gap-0.5 border-b border-hairline">
        {days.map((d, i) => (
          <div key={d.day} title={`${d.day}: ${d.value}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
            {(i === peak || i === days.length - 1) && <span className="mb-1 font-plex text-xs tabular-nums text-bright">{d.value}</span>}
            <div className="w-full rounded-t-sm bg-lime" style={{ height: `${(d.value / max) * 80}%` }} />
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-1.5 flex gap-0.5 font-plex text-[11px] tabular-nums text-lightgray">
        {days.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 text-center">
            {i % 2 === 0 || i === days.length - 1 ? Number(d.day.slice(8)) : ""}
          </span>
        ))}
      </div>
      <p className="mt-1 text-center font-plex text-[11px] text-lightgray">November, India time</p>
    </section>
  );
}
