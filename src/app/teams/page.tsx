import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatusPill from "@/components/ui/StatusPill";
import { trackLabel } from "@/data/hackday";
import { getPersonalMember } from "@/server/auth";
import { listPool } from "@/server/flow";
import { listTeamDirectory, teamlessCounts } from "@/server/teams";
import { Panel, Stat, StateLine, Tag } from "../team/blocks";

export const metadata: Metadata = {
  title: "Teams",
  description:
    "Every team at Kane CLI Hack Day, and how many builders are still without one.",
};

// Every team formed so far: name, track, size, state and open seats, never member names.
// People without a team are a count. Names of people looking show only to signed-in
// participants, and only for those who said yes to teammate matching (the list /match shows).

const rows = "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

export default function TeamsPage() {
  return (
    <main className="[overflow-wrap:anywhere]">
      <PageHeader
        eyebrow="Teams"
        dim="Who's building"
        bright="with whom."
        intro={
          <p>
            Every team formed so far, and how many builders are still without
            one. Team names and sizes only: nobody is named here who didn&apos;t
            ask to be.
          </p>
        }
        jumps={[
          { href: "#teams", label: "Teams" },
          { href: "#looking", label: "Without a team" },
        ]}
      />
      <Suspense
        fallback={
          <p className="container-page py-16 font-plex text-sm text-lightgray">
            Loading teams…
          </p>
        }
      >
        <Directory />
      </Suspense>
    </main>
  );
}

async function Directory() {
  // Request-time: the sign-in check reads the clock, which Cache Components won't prerender.
  await connection();
  const [all, counts, viewer] = await Promise.all([
    listTeamDirectory(),
    teamlessCounts(),
    getPersonalMember(),
  ]);
  const teams = all.filter((t) => t.member_count > 0);
  const onTeams = teams.reduce((n, t) => n + t.member_count, 0);
  const pool = viewer ? await listPool(viewer.id) : [];

  return (
    <div className="container-page space-y-12 py-12">
      <div className="grid grid-cols-3 gap-3">
        <Stat value={teams.length} label="Teams" />
        <Stat value={onTeams} label="Builders on teams" />
        <Stat value={counts.total} label="Without a team" />
      </div>

      <Panel
        id="teams"
        title="Teams"
        aside={<p className="font-plex text-xs text-lightgray">Oldest first</p>}
      >
        {teams.length ? (
          <ul className={rows}>
            {teams.map((t) => {
              const open =
                !t.locked && t.recruiting_open
                  ? Math.max(0, t.cap - t.member_count)
                  : 0;
              return (
                <li key={t.slug} className="border border-hairline p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-display text-lg text-bright">
                      {t.name}
                    </h3>
                    <StateLine state={t.state} locked={t.locked} />
                  </div>
                  <p className="mt-1 font-plex text-xs text-lightgray">
                    {trackLabel(t.track)} · {t.member_count}/{t.cap}{" "}
                    {t.member_count === 1 ? "builder" : "builders"}
                    {t.is_solo ? " · solo" : ""}
                  </p>
                  {open > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <StatusPill tone="accent">
                        {open === 1 ? "1 open seat" : `${open} open seats`}
                      </StatusPill>
                      {t.seeking_skills.slice(0, 6).map((s) => (
                        <Tag key={s}>{s}</Tag>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="font-plex text-sm text-lightgray">No teams yet.</p>
        )}
      </Panel>

      <Panel id="looking" title="Without a team">
        <div className="max-w-2xl space-y-3 font-plex text-sm leading-relaxed text-lightgray">
          <p>
            <span className="text-bright">{counts.total}</span>{" "}
            {counts.total === 1 ? "builder has" : "builders have"} no team yet;{" "}
            <span className="text-bright">{counts.matching}</span>{" "}
            {counts.matching === 1 ? "is" : "are"} in teammate matching.
          </p>
          <p>
            Looking for teammates?{" "}
            <Link
              href="/match"
              className="text-lime underline-offset-4 hover:underline"
            >
              Matchmaking
            </Link>{" "}
            shows who&apos;s looking and the teams with open seats.
          </p>
          {!viewer && (
            <p>
              Participants see who&apos;s in teammate matching here once
              they&apos;re signed in on this device.
            </p>
          )}
        </div>
        {viewer && pool.length > 0 && (
          <ul className={`${rows} mt-6`}>
            {pool.map((p) => (
              <li key={p.member_id} className="border border-hairline p-4">
                <h3 className="font-display text-base text-bright">{p.name}</h3>
                {p.skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.skills.slice(0, 6).map((s) => (
                      <Tag key={s}>{s}</Tag>
                    ))}
                  </div>
                )}
                {p.interests.length > 0 && (
                  <p className="mt-2 font-plex text-xs text-lightgray">
                    Into {p.interests.slice(0, 4).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
