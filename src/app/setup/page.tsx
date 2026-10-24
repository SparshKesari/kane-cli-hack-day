import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import CopyField from "@/components/ui/CopyField";
import GreetingHeader from "@/components/ui/GreetingHeader";
import StatusPill from "@/components/ui/StatusPill";
import { CONNECT, INSTALL, PAIR, PROVE, SKILL_GROUPS, type Cmd } from "@/data/agent-setup";
import { getMember } from "@/server/auth";
import { listBearerTokens } from "@/server/pairing";
import { getPassport } from "@/server/passport";
import OnToIdea from "./OnToIdea";

export const metadata: Metadata = {
  title: "Set up your agent",
  description: "Install the kanehack helper, pair your machine, connect Codex, and use the hack day skills.",
};

// The agent path through the day (T-PLG-01..04): install → pair → connect →
// skills → a first reported run. Public; a signed-in participant also sees
// whether this has happened for them yet. Commands live in src/data/agent-setup.ts.

const eyebrow = "font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray";

export default function SetupPage() {
  return (
    <main>
      <GreetingHeader
        greet={(n) => ({ dim: `${n}, your agent,`, bright: "on the team." })}
        eyebrow="Setup"
        dim="Your agent,"
        bright="on the team."
        intro="Install one small helper, pair it with your passport, and connect Codex. Then Codex can do the day with you: team, idea, Kane runs, help and submission."
        jumps={[
          { href: "#install", label: "1 · Install" },
          { href: "#pair", label: "2 · Sign in" },
          { href: "#connect", label: "3 · Connect" },
          { href: "#skills", label: "4 · Skills" },
          { href: "#prove", label: "5 · Prove it" },
        ]}
      />
      <div className="container-page pt-8">
        <Suspense fallback={null}>
          <YourStatus />
        </Suspense>
      </div>
      <Step id="install" n="01" title="Install the helper" body="Checks your machine, installs kanehack and the two hack-day skills ($hack-os and $hack-gtm), and makes kanehack a command. It asks before installing anything and never uses sudo.">
        <Cmds cmds={INSTALL} />
      </Step>
      <Step id="pair" n="02" title="Sign this machine in" body="Links kanehack to your passport so your runs and requests count for you and your team. Type your password in your own terminal, once; Codex never sees it.">
        <Cmds cmds={PAIR} />
      </Step>
      <Step id="connect" n="03" title="Connect your agent" body="Points your agent at the event server, so the skills can read your status, record runs and open help tickets as you.">
        <Cmds cmds={CONNECT} />
      </Step>
      <Step id="skills" n="04" title="Use the skill" body="Type $hack-os in Codex, or just ask in your own words. /skills lists it.">
        <div className="grid gap-10 lg:grid-cols-2">
          {SKILL_GROUPS.map((g) => (
            <div key={g.phase}>
              <p className={eyebrow}>{g.phase}</p>
              <ul className="mt-3 divide-y divide-dashed divide-hairline border-y border-dashed border-hairline">
                {g.skills.map((s) => (
                  <li key={s.name} className="space-y-1 py-4">
                    <p className="font-mono text-sm text-bright">{s.name}</p>
                    <p className="font-plex text-sm text-lightgray">{s.does}</p>
                    <p className="font-plex text-xs text-lightgray">
                      Try: <span className="text-bright">“{s.ask}”</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 max-w-3xl font-plex text-xs text-lightgray">
          Kane CLI syntax comes from the official Kane CLI skill (<code className="text-bright">npx @testmuai/kane-cli-skill</code>). Publishing a Ship Page and taking your selfie stay with
          you in the browser; your agent hands you the link.
        </p>
      </Step>
      <Step id="prove" n="05" title="Prove it works" body="Send one Kane run through kanehack. If it shows up on your team's Proof tab, you're set.">
        <Cmds cmds={PROVE} />
        <p className="mt-4 font-plex text-sm text-lightgray">
          No terminal or agent? Everything works in the browser too:{" "}
          <Link href="/passport" className="text-bright underline underline-offset-4 hover:text-lime">
            your passport
          </Link>{" "}
          and your team hub.
        </p>
      </Step>
    </main>
  );
}

function Step({ id, n, title, body, children }: { id: string; n: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-dashed border-hairline py-12 sm:py-16">
      <div className="container-page grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div>
          <p className={eyebrow}>Step {n}</p>
          <h2 className="mt-2 font-display text-2xl tracking-[-0.02em] text-bright sm:text-3xl">{title}</h2>
          <p className="mt-3 font-plex text-sm text-lightgray">{body}</p>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

function Cmds({ cmds }: { cmds: Cmd[] }) {
  return (
    <ul className="space-y-5">
      {cmds.map((c) => (
        <li key={c.label} className="space-y-2">
          <p className="font-plex text-sm text-bright">{c.label}</p>
          <CopyField value={c.value} />
          {c.note && <p className="font-plex text-xs text-lightgray">{c.note}</p>}
        </li>
      ))}
    </ul>
  );
}

/** For a signed-in participant: is a machine signed in (→ on to the Idea tab), and has a run been reported yet? */
async function YourStatus() {
  const member = await getMember();
  if (!member) {
    return (
      <p className="font-plex text-sm text-lightgray">
        <Link href="/passport/login?next=/setup" className="text-bright underline underline-offset-4 hover:text-lime">
          Sign in
        </Link>{" "}
        to see your progress through these steps.
      </p>
    );
  }
  const [tokens, p] = await Promise.all([listBearerTokens(member.id), getPassport(member.id)]);
  const paired = tokens.length > 0;
  const proven = p.kane_runs > 0;
  return (
    <div className="flex flex-wrap items-center gap-3 border border-hairline bg-surface p-4" data-setup-paired={paired} data-setup-runs={p.kane_runs}>
      <p className="font-plex text-sm text-bright">Your setup</p>
      {paired ? <StatusPill tone="neutral">Paired · {tokens.length} device{tokens.length === 1 ? "" : "s"}</StatusPill> : <StatusPill tone="pending">Not paired yet</StatusPill>}
      {proven ? (
        <StatusPill tone="neutral">
          {p.kane_runs} team run{p.kane_runs === 1 ? "" : "s"} on record
        </StatusPill>
      ) : (
        <StatusPill tone="unverified">No runs reported yet</StatusPill>
      )}
      {p.team && (
        <Link href={`/t/${p.team.slug}/proof`} className="ml-auto font-plex text-sm text-bright underline underline-offset-4 hover:text-lime">
          Your team&apos;s Proof tab →
        </Link>
      )}
      {p.team && (
        <div className="basis-full">
          <OnToIdea ideaUrl={`/t/${p.team.slug}/idea`} done={paired} />
        </div>
      )}
    </div>
  );
}
