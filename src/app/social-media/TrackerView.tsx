"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Icon, { type IconName } from "../o/Icons";

// The interactive half of /social-media: search, filters, sorting, the per-team
// view and the CSV download. Everything here works on the rows the server
// already sent, so changing a filter is instant and asks nothing of the server.

export type Row = {
  event: "sf" | "online";
  team: string;
  project: string;
  projectHref: string | null;
  platform: "x" | "linkedin" | "hn" | "reddit" | "youtube" | "video" | "blog";
  url: string;
  /** ISO time the submission was last saved. */
  savedAt: string | null;
  /** Null when the platform publishes no numbers, or didn't answer. */
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** Whether this kind of link has public numbers at all. */
  countable: boolean;
};

const EVENTS = { online: "Online Hackathon", sf: "Hack Day SF" } as const;
const PLATFORMS: Record<Row["platform"], { label: string; icon: IconName }> = {
  x: { label: "X", icon: "x" },
  linkedin: { label: "LinkedIn", icon: "linkedin" },
  hn: { label: "Hacker News", icon: "hackernews" },
  reddit: { label: "Reddit", icon: "reddit" },
  youtube: { label: "YouTube", icon: "youtube" },
  video: { label: "Other video", icon: "link" },
  blog: { label: "Blog / other", icon: "link" },
};
const PLATFORM_KEYS = Object.keys(PLATFORMS) as Row["platform"][];

// The posts table's columns. Click a heading to sort by it, again to reverse, a third time to go back to most engagement.
const COLUMNS = [
  { key: "team", label: "Team / project", numeric: false },
  { key: "platform", label: "Platform", numeric: false },
  { key: "link", label: "Link", numeric: false },
  { key: "likes", label: "Likes", numeric: true },
  { key: "comments", label: "Comments", numeric: true },
  { key: "views", label: "Views", numeric: true },
  { key: "saved", label: "Saved (PT)", numeric: false },
] as const;
type SortKey = (typeof COLUMNS)[number]["key"];
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US"));
const score = (r: Row) => (r.likes ?? 0) + (r.comments ?? 0);
const teamKey = (r: Row) => `${r.event}:${r.team}`;
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date(iso)) : "—";
const short = (url: string) => {
  const u = new URL(url);
  const s = `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  return s.length > 52 ? `${s.slice(0, 51)}…` : s;
};

const label = "font-pixel text-[11px] uppercase tracking-[0.15em] text-lightgray";
const control = "min-h-11 border border-hairline bg-ink px-3 font-plex text-sm text-bright focus:border-lime";
const chip = (on: boolean) =>
  `inline-flex min-h-11 items-center gap-2 border px-3 font-plex text-sm transition-colors ${on ? "border-lime bg-lime-deep text-lime" : "border-hairline text-lightgray hover:border-lime hover:text-bright"}`;
const th = "border-b border-hairline bg-surface px-3 py-2.5 text-left font-pixel text-[11px] font-normal uppercase tracking-[0.15em] text-lightgray";
const td = "border-b border-dashed border-hairline px-3 py-3 align-top";

export default function TrackerView({ rows, readAt }: { rows: Row[]; readAt: string }) {
  const [q, setQ] = useState("");
  const [event, setEvent] = useState<"all" | Row["event"]>("all");
  const [platforms, setPlatforms] = useState<Set<Row["platform"]>>(new Set());
  const [team, setTeam] = useState("all");
  const [numbers, setNumbers] = useState<"any" | "with" | "engaged" | "none">("any");
  const [minLikes, setMinLikes] = useState(0);
  const [sort, setSort] = useState<Sort>(null);
  const [view, setView] = useState<"posts" | "teams">("posts");

  const inEvent = useMemo(() => rows.filter((r) => event === "all" || r.event === event), [rows, event]);
  const teams = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of inEvent) m.set(teamKey(r), r.project === r.team ? r.team : `${r.project} (${r.team})`);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [inEvent]);

  // Everything except the platform choice, so each platform chip can show how many it would add.
  const beforePlatform = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inEvent.filter(
      (r) =>
        (team === "all" || teamKey(r) === team) &&
        (!needle || `${r.team} ${r.project} ${r.url}`.toLowerCase().includes(needle)) &&
        (numbers === "any" || (numbers === "with" ? r.likes !== null || r.views !== null : numbers === "engaged" ? score(r) > 0 : r.likes === null && r.views === null)) &&
        (r.likes ?? 0) >= minLikes,
    );
  }, [inEvent, q, team, numbers, minLikes]);

  const shown = useMemo(() => {
    const list = beforePlatform.filter((r) => platforms.size === 0 || platforms.has(r.platform));
    const engagement = (a: Row, b: Row) => score(b) - score(a) || (b.views ?? 0) - (a.views ?? 0);
    if (!sort) return [...list].sort(engagement);
    const text: Partial<Record<SortKey, (r: Row) => string>> = {
      team: (r) => r.project.toLowerCase(),
      platform: (r) => PLATFORMS[r.platform].label.toLowerCase(),
      link: (r) => short(r.url).toLowerCase(),
      saved: (r) => r.savedAt ?? "",
    };
    const flip = sort.dir === "asc" ? 1 : -1;
    const pick = text[sort.key];
    return [...list].sort((a, b) => {
      if (pick) return flip * pick(a).localeCompare(pick(b)) || engagement(a, b);
      // Posts with no number always go last, whichever way the column is sorted.
      const [x, y] = [a[sort.key as "likes" | "comments" | "views"], b[sort.key as "likes" | "comments" | "views"]];
      if (x === null || y === null) return x === y ? engagement(a, b) : x === null ? 1 : -1;
      return flip * (x - y) || engagement(a, b);
    });
  }, [beforePlatform, platforms, sort]);

  const byTeam = useMemo(() => {
    const m = new Map<string, { key: string; event: Row["event"]; team: string; project: string; projectHref: string | null; posts: number; likes: number; comments: number; views: number; platforms: Set<Row["platform"]> }>();
    for (const r of shown) {
      const t = m.get(teamKey(r)) ?? { key: teamKey(r), event: r.event, team: r.team, project: r.project, projectHref: r.projectHref, posts: 0, likes: 0, comments: 0, views: 0, platforms: new Set() };
      t.posts++;
      t.likes += r.likes ?? 0;
      t.comments += r.comments ?? 0;
      t.views += r.views ?? 0;
      t.platforms.add(r.platform);
      m.set(t.key, t);
    }
    return [...m.values()].sort((a, b) => b.likes + b.comments - (a.likes + a.comments) || b.posts - a.posts);
  }, [shown]);

  const sum = (k: "likes" | "comments" | "views") => shown.reduce((t, r) => t + (r[k] ?? 0), 0);
  const withNumbers = shown.filter((r) => r.likes !== null || r.views !== null).length;
  const unanswered = shown.filter((r) => r.countable && r.likes === null && r.views === null).length;
  const filtered = q !== "" || event !== "all" || platforms.size > 0 || team !== "all" || numbers !== "any" || minLikes > 0;

  const reset = () => {
    setQ("");
    setEvent("all");
    setPlatforms(new Set());
    setTeam("all");
    setNumbers("any");
    setMinLikes(0);
  };
  // Numbers start highest first, text and dates start A–Z / oldest first… except "saved", which starts newest first.
  const sortBy = (key: SortKey, numeric: boolean) =>
    setSort((old) => {
      const first = numeric || key === "saved" ? "desc" : "asc";
      if (old?.key !== key) return { key, dir: first };
      return old.dir === first ? { key, dir: first === "asc" ? "desc" : "asc" } : null;
    });
  const togglePlatform = (p: Row["platform"]) =>
    setPlatforms((old) => {
      const next = new Set(old);
      if (!next.delete(p)) next.add(p);
      return next;
    });

  const download = () => {
    const cell = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    };
    const lines = [
      ["event", "team", "project", "platform", "url", "likes", "comments", "views", "saved_at"],
      ...shown.map((r) => [EVENTS[r.event], r.team, r.project, PLATFORMS[r.platform].label, r.url, r.likes, r.comments, r.views, r.savedAt]),
    ];
    const blob = new Blob([lines.map((l) => l.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "social-media-tracker.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="container-page py-10">
      {/* Totals for whatever is filtered in. */}
      <dl className="grid grid-cols-2 gap-px border border-hairline bg-hairline lg:grid-cols-5">
        {(
          [
            ["Posts", shown.length, false],
            ["Teams", byTeam.length, false],
            ["Likes / reactions", sum("likes"), true],
            ["Comments / replies", sum("comments"), true],
            ["YouTube views", sum("views"), true],
          ] as const
        ).map(([name, value, accent]) => (
          <div key={name} className="bg-ink p-4 sm:p-5">
            <dt className={label}>{name}</dt>
            <dd className={`mt-1 font-dots text-4xl font-black sm:text-5xl ${accent ? "text-lime" : "text-bright"}`}>{n(value)}</dd>
          </div>
        ))}
      </dl>

      {/* Filters. */}
      <section aria-label="Filters" className="mt-6 border border-hairline bg-surface p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block">
            <span className={label}>Search</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Team, project or link" className={`${control} mt-2 w-full placeholder:text-lightgray`} />
          </label>
          <label className="block">
            <span className={label}>Team</span>
            <select value={team} onChange={(e) => setTeam(e.target.value)} className={`${control} mt-2 w-full`}>
              <option value="all">All teams ({teams.length})</option>
              {teams.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Engagement</span>
            <select value={numbers} onChange={(e) => setNumbers(e.target.value as typeof numbers)} className={`${control} mt-2 w-full`}>
              <option value="any">Any</option>
              <option value="with">Has numbers</option>
              <option value="engaged">At least 1 like or comment</option>
              <option value="none">No numbers</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>Minimum likes</span>
            <select value={minLikes} onChange={(e) => setMinLikes(Number(e.target.value))} className={`${control} mt-2 w-full`}>
              {[0, 1, 5, 10, 25, 50].map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "No minimum" : `${v}+`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className={`${label} mr-1 w-full sm:w-20`}>Event</span>
          {(["all", "online", "sf"] as const).map((e) => (
            <button key={e} type="button" aria-pressed={event === e} onClick={() => { setEvent(e); setTeam("all"); }} className={chip(event === e)}>
              {e === "all" ? "Both" : EVENTS[e]}
              <span className="tabular-nums text-bright">{e === "all" ? rows.length : rows.filter((r) => r.event === e).length}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`${label} mr-1 w-full sm:w-20`}>Platform</span>
          {PLATFORM_KEYS.map((p) => {
            const count = beforePlatform.filter((r) => r.platform === p).length;
            return (
              <button key={p} type="button" aria-pressed={platforms.has(p)} onClick={() => togglePlatform(p)} className={chip(platforms.has(p))}>
                <Icon name={PLATFORMS[p].icon} className="h-3.5 w-3.5" />
                {PLATFORMS[p].label}
                <span className="tabular-nums text-bright">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* View switch, result line, actions. */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="View" className="inline-flex border border-hairline">
            {(["posts", "teams"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`min-h-11 px-4 font-plex text-sm ${view === v ? "bg-lime text-ink" : "text-lightgray hover:text-bright"}`}>
                {v === "posts" ? "Posts" : "By team"}
              </button>
            ))}
          </div>
          <p aria-live="polite" className="font-plex text-sm text-lightgray">
            <span className="text-bright">{shown.length}</span> of {rows.length} posts · <span className="text-bright">{withNumbers}</span> with numbers
            {unanswered > 0 && ` · ${unanswered} didn't answer`}
            {view === "posts" && ` · sorted by ${sort ? `${COLUMNS.find((c) => c.key === sort.key)?.label.toLowerCase()} ${sort.dir === "asc" ? "↑" : "↓"}` : "most engagement"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filtered && (
            <button type="button" onClick={reset} className="min-h-11 px-3 font-plex text-sm text-lightgray underline decoration-hairline underline-offset-4 hover:text-bright">
              Clear filters
            </button>
          )}
          <button type="button" onClick={download} disabled={shown.length === 0} className="min-h-11 border border-lime px-4 font-plex text-sm text-lime hover:bg-lime hover:text-ink disabled:opacity-40">
            Download CSV
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 border border-dashed border-hairline px-4 py-12 text-center font-plex text-sm text-lightgray">No posts match these filters.</p>
      ) : view === "posts" ? (
        <div className="mt-4 max-h-[75vh] overflow-auto border border-hairline">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 font-plex text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                {COLUMNS.map((c) => {
                  const active = sort?.key === c.key ? sort.dir : null;
                  return (
                    <th key={c.key} scope="col" aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"} className={`${th.replace("px-3 py-2.5", "p-0")} ${c.numeric ? "text-right" : ""}`}>
                      <button
                        type="button"
                        onClick={() => sortBy(c.key, c.numeric)}
                        title={`Sort by ${c.label}`}
                        className={`inline-flex min-h-11 w-full items-center gap-1.5 px-3 uppercase tracking-[0.15em] hover:text-bright ${c.numeric ? "justify-end" : ""} ${active ? "text-lime" : ""}`}
                      >
                        {c.label}
                        <span aria-hidden className={active ? "" : "opacity-40"}>
                          {active === "asc" ? "↑" : active === "desc" ? "↓" : "↕"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.event}:${r.url}`} className="hover:bg-surface">
                  <td className={td}>
                    <ProjectName href={r.projectHref} name={r.project} />
                    <div className="mt-0.5 text-xs text-lightgray">
                      {r.team !== r.project && `${r.team} · `}
                      {EVENTS[r.event]}
                    </div>
                  </td>
                  <td className={`${td} whitespace-nowrap text-bright`}>
                    <span className="inline-flex items-center gap-2">
                      <Icon name={PLATFORMS[r.platform].icon} className="h-3.5 w-3.5 text-lightgray" />
                      {PLATFORMS[r.platform].label}
                    </span>
                  </td>
                  <td className={`${td} break-all`}>
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                      {short(r.url)}
                    </a>
                  </td>
                  {(["likes", "comments", "views"] as const).map((k) => (
                    <td key={k} className={`${td} text-right whitespace-nowrap tabular-nums ${r[k] ? "text-bright" : "text-lightgray"}`}>
                      {n(r[k])}
                    </td>
                  ))}
                  <td className={`${td} whitespace-nowrap text-lightgray`}>{when(r.savedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 max-h-[75vh] overflow-auto border border-hairline">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 font-plex text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th scope="col" className={`${th} w-12 text-right`}>#</th>
                <th scope="col" className={th}>Team / project</th>
                <th scope="col" className={th}>Platforms</th>
                <th scope="col" className={`${th} text-right`}>Posts</th>
                <th scope="col" className={`${th} text-right`}>Likes</th>
                <th scope="col" className={`${th} text-right`}>Comments</th>
                <th scope="col" className={`${th} text-right`}>Views</th>
              </tr>
            </thead>
            <tbody>
              {byTeam.map((t, i) => (
                <tr key={t.key} className="hover:bg-surface">
                  <td className={`${td} text-right tabular-nums text-lightgray`}>{i + 1}</td>
                  <td className={td}>
                    <ProjectName href={t.projectHref} name={t.project} />
                    <div className="mt-0.5 text-xs text-lightgray">
                      {t.team !== t.project && `${t.team} · `}
                      {EVENTS[t.event]}
                    </div>
                  </td>
                  <td className={td}>
                    <span className="flex flex-wrap gap-2 text-lightgray">
                      {PLATFORM_KEYS.filter((p) => t.platforms.has(p)).map((p) => (
                        <span key={p} title={PLATFORMS[p].label} className="inline-flex items-center gap-1.5 border border-hairline px-2 py-0.5 text-xs">
                          <Icon name={PLATFORMS[p].icon} className="h-3 w-3" />
                          {PLATFORMS[p].label}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    <button type="button" onClick={() => { setTeam(t.key); setView("posts"); }} aria-label={`Show ${t.project}'s ${t.posts} posts`} className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                      {t.posts}
                    </button>
                  </td>
                  <td className={`${td} text-right tabular-nums text-bright`}>{n(t.likes)}</td>
                  <td className={`${td} text-right tabular-nums text-bright`}>{n(t.comments)}</td>
                  <td className={`${td} text-right tabular-nums text-bright`}>{n(t.views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 font-plex text-xs leading-relaxed text-lightgray">
        Posts are read live from the submissions (read {readAt}). Engagement comes from each platform&apos;s public page and refreshes about once an hour. Blogs other than dev.to and other video hosts publish no counts, and a
        removed or private post shows &ldquo;—&rdquo;.
      </p>
    </div>
  );
}

function ProjectName({ href, name }: { href: string | null; name: string }) {
  return href ? (
    <Link href={href} className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
      {name}
    </Link>
  ) : (
    <span className="text-bright">{name}</span>
  );
}
