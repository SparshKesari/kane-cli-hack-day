import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "@/components/Account";
import FlowProgress from "@/components/FlowProgress";
import Button from "@/components/ui/Button";
import DegradedServiceAlert from "@/components/ui/DegradedServiceAlert";
import GreetingHeader from "@/components/ui/GreetingHeader";
import StatusPill from "@/components/ui/StatusPill";
import { isEnabled } from "@/lib/flags";
import { query } from "@/lib/db";
import { getPersonalMember } from "@/server/auth";
import { avatarSrc } from "@/server/avatar";
import { flowState, listOpenTeams, listPool, type PoolPerson, type PoolTeam } from "@/server/flow";
import { listIntros } from "@/server/match";
import { Panel, Stat, Tag } from "../team/blocks";
import { leavePoolAction } from "./actions";
import { IntroButtons, MatchProfileForm, RequestIntro } from "./parts";
import { trackLabel } from "@/data/hackday";

export const metadata: Metadata = { title: "Matchmaking" };

// The matchmaking round. In the pool you see everyone else looking (name,
// photo, skills, interests: never email or phone) and teams with open seats.
// Ask a team to join (any teammate can accept, and you're in), or ask a person
// for an intro (then one of you creates a team and invites the other). At the
// cut-off an organizer forms teams from whoever is left (/ops/matchmaking).
// Landing on a team by any route takes you out of the pool.

export default function MatchPage({ searchParams }: PageProps<"/match">) {
  return (
    <main>
      <Suspense fallback={<FlowProgress stage={null} viewing="team" />}>
        <Progress />
      </Suspense>
      <GreetingHeader greet={(n) => ({ dim: `Hi ${n},`, bright: "Find your people." })} eyebrow="Matchmaking" dim="Find your people," bright="Then build." intro="Everyone here is looking for a team. Ask to join a team with open seats, or ask a person for an intro. Still on your own at the cut-off? An organizer will put a team together." />
      <Suspense fallback={<p className="container-page py-16 font-plex text-sm text-lightgray">Loading the pool…</p>}>
        <Pool searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Progress() {
  const m = await getPersonalMember();
  return <FlowProgress stage={m ? (await flowState(m.id)).stage : null} viewing="team" />;
}

async function Pool({ searchParams }: Pick<PageProps<"/match">, "searchParams">) {
  const [on, member, sp] = await Promise.all([isEnabled("match"), getPersonalMember(), searchParams]);
  if (!member) {
    return (
      <section className="py-12">
        <div className="container-page max-w-xl space-y-4 font-plex text-sm text-lightgray">
          <p>Build your profile and say yes to matchmaking to see who&apos;s looking.</p>
          <div className="flex flex-wrap gap-3">
            <Button href="/register" className="min-h-11">
              Start here →
            </Button>
            <Button href="/passport/login?next=/match" variant="secondary" className="min-h-11">
              Sign in
            </Button>
          </div>
        </div>
      </section>
    );
  }
  const state = await flowState(member.id);
  if (state.teamSlug) redirect(state.next);
  if (state.stage !== "pool") redirect(state.stage === "team" ? "/team" : "/register");

  if (!on) {
    return (
      <div className="container-page py-10">
        <DegradedServiceAlert state="degraded" system="Matchmaking" manualRoute="/help" manualLabel="Ask at the help desk">
          Matchmaking is paused right now. Invite codes still work on your Team page; staff keep a list of people looking for a team.
        </DegradedServiceAlert>
      </div>
    );
  }

  const [allPeople, allTeams, intros, [mine]] = await Promise.all([
    listPool(member.id),
    listOpenTeams(member.id),
    listIntros(member.id),
    query<{ skills: string[]; interests: string[] }>("select coalesce(skills, '{}') as skills, coalesce(interests, '{}') as interests from members where id = $1", [member.id]),
  ]);
  // Skill filter (?skill=react,python): people with any of them, teams looking for any of them.
  const picked = (typeof sp.skill === "string" ? sp.skill : "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const has = (list: string[]) => list.some((s) => picked.includes(s.toLowerCase()));
  const people = picked.length ? allPeople.filter((p) => has(p.skills)) : allPeople;
  const teams = picked.length ? allTeams.filter((t) => has(t.seeking_skills)) : allTeams;
  const counts = new Map<string, number>();
  for (const s of [...allPeople.flatMap((p) => p.skills), ...allTeams.flatMap((t) => t.seeking_skills)]) counts.set(s.toLowerCase(), (counts.get(s.toLowerCase()) ?? 0) + 1);
  const skillChips = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30);
  const mySkills = new Set(mine.skills.map((s) => s.toLowerCase()));
  const href = (s: string) => {
    const next = picked.includes(s) ? picked.filter((x) => x !== s) : [...picked, s];
    return next.length ? `/match?skill=${encodeURIComponent(next.join(","))}` : "/match";
  };
  const incoming = intros.filter((i) => i.direction === "incoming" && i.status === "proposed");
  const outgoing = intros.filter((i) => i.direction === "outgoing");

  return (
    <section className="py-10 sm:py-14" data-in-pool="true">
      <div className="container-page grid gap-12 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="space-y-10">
          <section className={`space-y-4 border-2 p-5 sm:p-6 ${mine.skills.length ? "border-hairline" : "border-lime bg-lime-deep"}`} aria-labelledby="your-skills">
            <div>
              <h2 id="your-skills" className="font-display text-2xl text-bright">
                {mine.skills.length ? "Your skills and interests" : "First, add your skills"}
              </h2>
              <p className="mt-1 font-plex text-sm text-lightgray">
                {mine.skills.length === 0
                  ? "Teams with open seats look for specific skills. Add yours so they can find you, and so we can show you the best matches."
                  : mine.skills.length < 3
                    ? "Add a few more: more skills mean better matches."
                    : "Teams and people see these. Add more to show up in more searches."}
              </p>
            </div>
            <MatchProfileForm skills={mine.skills} interests={mine.interests} />
          </section>

          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Stat value={people.length + 1} label="In the pool (with you)" />
            <Stat value={teams.reduce((n, t) => n + t.open_seats, 0)} label="Open seats" />
          </div>

          {skillChips.length > 0 && (
            <div className="space-y-3" data-skill-filter>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Filter by skill</p>
                {picked.length > 0 && (
                  <Link href="/match" className="font-plex text-sm text-bright underline underline-offset-4 hover:text-lime">
                    Clear filter
                  </Link>
                )}
              </div>
              <ul className="flex flex-wrap gap-2">
                {skillChips.map(([s, n]) => {
                  const on = picked.includes(s);
                  return (
                    <li key={s}>
                      <Link
                        href={href(s)}
                        scroll={false}
                        aria-pressed={on}
                        className={`inline-flex min-h-9 items-center gap-1.5 border px-3 py-1 font-plex text-sm transition-colors ${on ? "border-lime bg-lime-deep text-lime" : "border-hairline text-bright hover:border-lime"}`}
                      >
                        {on && <span aria-hidden="true">✓</span>}
                        {s} <span className="text-xs text-lightgray">{n}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {picked.length > 0 && (
                <p className="font-plex text-sm text-lightgray">
                  Showing {people.length} {people.length === 1 ? "person" : "people"} and {teams.length} {teams.length === 1 ? "team" : "teams"} with {picked.join(" or ")}.
                </p>
              )}
            </div>
          )}

          <Panel title="Teams with open seats" aside={<span className="font-plex text-xs text-lightgray">{teams.length}</span>}>
            {teams.length === 0 ? (
              <p className="font-plex text-sm text-lightgray">{picked.length ? "No team with open seats is looking for those skills." : "No team has open seats right now."}</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {teams.map((t) => (
                  <TeamCard key={t.team_id} t={t} mySkills={mySkills} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="People looking" aside={<span className="font-plex text-xs text-lightgray">{people.length}</span>}>
            {people.length === 0 ? (
              <p className="font-plex text-sm text-lightgray">{picked.length ? "Nobody in the pool has those skills yet." : "Nobody else yet. People appear here as they finish their profile."}</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {people.map((p) => (
                  <PersonCard key={p.member_id} p={p} picked={picked} />
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-10">
          <Panel title="Requests for you">
            {incoming.length === 0 ? (
              <p className="font-plex text-sm text-lightgray">None yet.</p>
            ) : (
              <ul className="border-t border-dashed border-hairline">
                {incoming.map((i) => (
                  <li key={i.id} className="space-y-2 border-b border-dashed border-hairline py-3 font-plex text-sm">
                    <p className="text-bright">{i.from_team ? <><span className="text-lime">{i.from_team}</span> invites you to join their team <span className="text-lightgray">(from {i.other})</span></> : <>From {i.other}</>}</p>
                    {i.message && <p className="text-xs text-lightgray">“{i.message}”</p>}
                    <IntroButtons introId={i.id} incoming />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Your requests">
            {outgoing.length === 0 ? (
              <p className="font-plex text-sm text-lightgray">None yet.</p>
            ) : (
              <ul className="border-t border-dashed border-hairline">
                {outgoing.map((i) => (
                  <li key={i.id} className="space-y-2 border-b border-dashed border-hairline py-3 font-plex text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-bright">To {i.other}</span>
                      <IntroPill status={i.status} />
                    </div>
                    {i.status === "accepted" && i.contact && (
                      <p className="text-xs text-lightgray">
                        Find {i.contact.name}
                        {i.contact.table ? ` at table ${i.contact.table}` : " in the room"}. One of you creates a team on the Team page and invites the other.
                      </p>
                    )}
                    {i.status === "proposed" && <IntroButtons introId={i.id} incoming={false} />}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Have a team after all?">
            <form action={leavePoolAction} className="space-y-3">
              <p className="font-plex text-xs text-lightgray">Leave the pool to create a team or join one with an invite code.</p>
              <button type="submit" className="inline-flex min-h-11 items-center border border-hairline px-4 py-2 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime">
                Leave the pool → Team page
              </button>
            </form>
          </Panel>
        </aside>
      </div>
    </section>
  );
}

function IntroPill({ status }: { status: string }) {
  if (status === "proposed") return <StatusPill tone="pending">Waiting</StatusPill>;
  if (status === "accepted") return <Tag className="border-bright text-bright">Accepted</Tag>;
  return <Tag>{status}</Tag>;
}

function Tags({ items, highlight }: { items: string[]; highlight?: (s: string) => boolean }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <li key={s} className={`border px-2 py-0.5 font-plex text-xs ${highlight?.(s) ? "border-lime text-lime" : "border-hairline text-lightgray"}`}>
          {s}
        </li>
      ))}
    </ul>
  );
}

function TeamCard({ t, mySkills }: { t: PoolTeam; mySkills: Set<string> }) {
  const youAdd = t.seeking_skills.filter((s) => mySkills.has(s.toLowerCase()));
  return (
    <li className="brackets flex flex-col gap-3 border border-hairline p-5">
      <div className="flex items-center justify-between gap-2 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">
        <span>Team · {trackLabel(t.track)}</span>
        <span>
          {t.open_seats} open {t.open_seats === 1 ? "seat" : "seats"}
        </span>
      </div>
      <p className="font-display text-xl text-bright">{t.name}</p>
      {t.summary_public && <p className="font-plex text-sm text-lightgray">{t.summary_public}</p>}
      {t.seeking_skills.length > 0 && (
        <div className="space-y-1">
          <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Looking for</p>
          <Tags items={t.seeking_skills} highlight={(s) => mySkills.has(s.toLowerCase())} />
          {youAdd.length > 0 && <p className="font-plex text-sm text-lime">You have {youAdd.join(", ")}</p>}
        </div>
      )}
      <div className="mt-auto pt-2">{t.intro === "proposed" || t.intro === "accepted" ? <IntroPill status={t.intro} /> : <RequestIntro target={{ team: t.team_id }} label="Ask to join" />}</div>
    </li>
  );
}

function PersonCard({ p, picked }: { p: PoolPerson; picked: string[] }) {
  return (
    <li className="flex flex-col gap-3 border border-hairline p-5" data-pool-member={p.member_id}>
      <div className="flex items-center gap-3">
        <Avatar name={p.name} src={p.photo ? avatarSrc(p.member_id, p.photo) : null} size={44} />
        <p className="font-display text-xl text-bright">{p.name}</p>
      </div>
      {p.skills.length > 0 && (
        <div className="space-y-1">
          <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Skills</p>
          <Tags items={p.skills} highlight={(s) => picked.includes(s.toLowerCase())} />
        </div>
      )}
      {p.interests.length > 0 && (
        <div className="space-y-1">
          <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Interests</p>
          <Tags items={p.interests} />
        </div>
      )}
      <div className="mt-auto pt-2">{p.intro === "proposed" || p.intro === "accepted" ? <IntroPill status={p.intro} /> : <RequestIntro target={{ member: p.member_id }} />}</div>
    </li>
  );
}
