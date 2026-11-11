import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MAX_TEAM, getMe, getMembers, getTeam, rosterLocked } from "@/lib/online/team";
import Steps from "../Steps";
import TeamForms, { RenameForm } from "./TeamForms";
import { leaveTeamAction, removeMemberAction } from "./actions";

export const metadata: Metadata = { title: "Your team" };

// Step 2: your team. Without one, pick solo / start / join. With one: the
// captain's code to share, who's in, and (for the captain) rename and remove.
// Everything here freezes once the team submits, or at the deadline.
export default function OnlineTeam() {
  return (
    <section className="container-page max-w-xl py-16">
      <Steps current={2} />
      <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading your team…</p>}>
        <Body />
      </Suspense>
    </section>
  );
}

const quiet = "font-plex text-sm text-lightgray underline decoration-hairline underline-offset-4 hover:text-danger";

async function Body() {
  const me = await getMe();
  if (!me) redirect("/o/login");
  const team = me.teamId === null ? null : await getTeam(me.teamId);

  if (!team) {
    return (
      <>
        <h1 className="font-display text-4xl text-bright">Register your team</h1>
        <p className="mb-8 mt-3 font-plex text-sm text-lightgray">Hi {me.name}. Solo or a team of up to {MAX_TEAM}. One submission per team.</p>
        <TeamForms />
      </>
    );
  }

  const [members, locked] = await Promise.all([getMembers(team.id), rosterLocked(team.id)]);
  const captain = team.captainId === me.id;
  const spaces = MAX_TEAM - members.length;

  return (
    <>
      <p className="font-pixel text-xs uppercase tracking-[0.15em] text-lime">{team.solo ? "Solo" : `Team · ${members.length} of ${MAX_TEAM}`}</p>
      <h1 className="mt-2 font-display text-4xl text-bright">{team.solo ? "You're building solo" : team.name}</h1>
      {locked && <p className="mt-4 border-l-2 border-lime pl-4 font-plex text-sm text-bright">{locked}</p>}

      {!locked && spaces > 0 && (
        <div className="mt-8 bg-lime p-6 text-[#0a0a0a]">
          <p className="font-pixel text-xs uppercase tracking-[0.18em]">{team.solo ? "Want teammates? Share your code" : captain ? "Your team code" : "Team code"}</p>
          <p className="mt-3 font-dots text-5xl leading-none font-black">{team.inviteCode}</p>
          <p className="mt-3 font-plex text-sm">
            {spaces} {spaces === 1 ? "place" : "places"} left. Teammates register themselves, choose &ldquo;Join a team&rdquo;, and enter it.
            {team.solo ? " Whoever's code is used is the team captain: that's you." : ""}
          </p>
        </div>
      )}

      <h2 className="mt-10 mb-2 font-pixel text-xs uppercase tracking-[0.15em] text-lightgray">Who&rsquo;s on it</h2>
      <ul className="border-t border-dashed border-hairline">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-4 border-b border-dashed border-hairline py-3 font-plex text-sm text-bright">
            <span>
              {m.name}
              {m.id === me.id && <span className="text-lightgray"> (you)</span>}
            </span>
            <span className="flex items-center gap-4">
              {m.id === team.captainId && <span className="border border-lime px-2 py-0.5 font-pixel text-xs uppercase tracking-[0.15em] text-lime">Captain</span>}
              {captain && !locked && m.id !== me.id && (
                <form action={removeMemberAction}>
                  <input type="hidden" name="member" value={m.id} />
                  <button type="submit" className={quiet}>
                    Remove
                  </button>
                </form>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 font-plex text-sm text-lightgray">The captain receives the prize for the team.</p>

      {captain && !locked && !team.solo && (
        <div className="mt-10">
          <RenameForm current={team.name} />
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
        <Link href="/o/start" className="inline-flex min-h-11 items-center bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime">
          Next: get set up →
        </Link>
        {!locked && (
          <form action={leaveTeamAction}>
            <button type="submit" className={quiet}>
              {members.length === 1 ? "Start over (choose again)" : captain ? "Leave team (the next member becomes captain)" : "Leave team"}
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 font-plex text-sm text-lightgray">
        Your showcase page, live once you submit: <span className="text-bright">/o/p/{team.slug}</span>
      </p>
    </>
  );
}
