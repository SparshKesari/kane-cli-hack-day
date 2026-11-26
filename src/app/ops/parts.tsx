"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { inputCls } from "@/components/forms/fields";
import { adminLogout, toggleRegistration } from "./actions";

/** Shown to signed-out visitors on any /ops page. Sign-in lives at /ops/login. */
export function AdminLogin({ next = "/ops" }: { next?: string }) {
  return (
    <div className="max-w-sm space-y-4">
      <p className="font-plex text-sm text-lightgray">Staff only. Sign in with your staff email and one-time code.</p>
      <Link
        href={`/ops/login?next=${encodeURIComponent(next)}`}
        className="inline-flex min-h-11 items-center bg-bright px-4 py-2.5 font-plex text-sm text-ink transition-colors hover:bg-lime"
      >
        Staff sign in →
      </Link>
    </div>
  );
}

export function AdminBar({ registrationOpen }: { registrationOpen: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={toggleRegistration.bind(null, !registrationOpen)}>
        <button
          type="submit"
          className={`border px-3 py-2 font-plex text-xs transition-colors ${
            registrationOpen ? "border-lime text-lime hover:bg-lime-deep" : "border-red-400 text-red-300 hover:bg-red-950"
          }`}
        >
          Registration {registrationOpen ? "open · close it" : "closed · reopen it"}
        </button>
      </form>
      <Link href="/ops/nudges" className="border border-hairline px-3 py-2 font-plex text-xs text-bright hover:border-lime hover:text-lime">
        Nudges
      </Link>
      <a href="/ops/export?type=teams" className="border border-hairline px-3 py-2 font-plex text-xs text-bright hover:border-lime hover:text-lime">
        Teams CSV
      </a>
      <a href="/ops/export?type=members" className="border border-hairline px-3 py-2 font-plex text-xs text-bright hover:border-lime hover:text-lime">
        Members CSV
      </a>
      <a href="/ops/export?type=final" className="border border-lime px-3 py-2 font-plex text-xs text-lime hover:bg-lime-deep">
        Final attendees + projects CSV
      </a>
      <form action={adminLogout}>
        <button type="submit" className="px-1 py-2 font-plex text-xs text-lightgray hover:text-bright">
          Sign out
        </button>
      </form>
    </div>
  );
}

export type TeamRow = {
  slug: string;
  name: string;
  track: string;
  isSolo: boolean;
  members: string[];
  done: number;
  total: number;
  shipped: boolean;
  lastActivity: string;
  photos: { team: boolean; consented: number; declined: number; selfies: number; socials: number; members: number; gallery: number };
};

type Filter = "all" | "shipped" | "not-shipped" | "solo" | "no-photo" | "no-consent";

export function TeamsTable({ rows, tracks }: { rows: TeamRow[]; tracks: string[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [track, setTrack] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (track && r.track !== track) return false;
      if (filter === "shipped" && !r.shipped) return false;
      if (filter === "not-shipped" && r.shipped) return false;
      if (filter === "solo" && !r.isSolo) return false;
      if (filter === "no-photo" && r.photos.team) return false;
      if (filter === "no-consent" && r.photos.consented === r.photos.members) return false;
      if (!needle) return true;
      return r.name.toLowerCase().includes(needle) || r.members.some((m) => m.toLowerCase().includes(needle));
    });
  }, [rows, q, filter, track]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team or member" aria-label="Search" className={inputCls} />
        <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Track" className={inputCls}>
          <option value="">All tracks</option>
          {tracks.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter" className={inputCls}>
          <option value="all">All teams</option>
          <option value="shipped">Shipped minimum</option>
          <option value="not-shipped">Missing items</option>
          <option value="solo">Solo only</option>
          <option value="no-photo">No team photo</option>
          <option value="no-consent">Not everyone consented</option>
        </select>
      </div>

      <p className="font-plex text-xs text-lightgray">
        Showing {shown.length} of {rows.length}
      </p>

      <div className="overflow-x-auto border border-hairline">
        <table className="w-full min-w-[880px] text-left font-plex text-sm">
          <thead className="border-b border-hairline bg-surface font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">
            <tr>
              <th className="px-3 py-3 font-normal">Team</th>
              <th className="px-3 py-3 font-normal">Track</th>
              <th className="px-3 py-3 font-normal">Members</th>
              <th className="px-3 py-3 font-normal">Progress</th>
              <th className="px-3 py-3 font-normal">Photos</th>
              <th className="px-3 py-3 font-normal">Last active</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.slug} className="border-b border-dashed border-hairline align-top last:border-0">
                <td className="px-3 py-3">
                  <Link href={`/ops/t/${r.slug}`} className="text-bright hover:text-lime">
                    {r.name}
                  </Link>
                  <span className="block text-xs text-lightgray">
                    /t/{r.slug}
                    {r.isSolo && " · solo"}
                  </span>
                </td>
                <td className="px-3 py-3 text-lightgray">{r.track}</td>
                <td className="px-3 py-3 text-lightgray">{r.members.join(", ")}</td>
                <td className="px-3 py-3">
                  <span className={r.shipped ? "text-lime" : "text-bright"}>
                    {r.done}/{r.total}
                  </span>
                  {r.shipped && <span className="ml-2 text-xs text-lime">shipped</span>}
                </td>
                <td className="px-3 py-3">
                  <PhotoBadges p={r.photos} />
                </td>
                <td className="px-3 py-3 text-lightgray">{r.lastActivity}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-lightgray">
                  No teams match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ on, children, title }: { on: boolean; children: ReactNode; title: string }) {
  return (
    <span title={title} className={`border px-1.5 py-0.5 text-[11px] ${on ? "border-lime text-lime" : "border-hairline text-lightgray"}`}>
      {children}
    </span>
  );
}

function PhotoBadges({ p }: { p: TeamRow["photos"] }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge on={p.team} title="Team group photo">
        {p.team ? "photo" : "no photo"}
      </Badge>
      <Badge on={p.members > 0 && p.consented === p.members} title={`Said yes to photos and posts${p.declined ? ` · ${p.declined} said no` : ""}`}>
        consent {p.consented}/{p.members}
      </Badge>
      <Badge on={p.members > 0 && p.selfies === p.members} title="Members with a selfie">
        selfies {p.selfies}/{p.members}
      </Badge>
      <Badge on={p.members > 0 && p.socials === p.members} title="Members with LinkedIn or X">
        socials {p.socials}/{p.members}
      </Badge>
      <Badge on={p.gallery > 0} title="Event gallery photos">
        gallery {p.gallery}
      </Badge>
    </span>
  );
}
