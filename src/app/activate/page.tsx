import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import FlowProgress from "@/components/FlowProgress";
import Button from "@/components/ui/Button";
import CopyField from "@/components/ui/CopyField";
import GreetingHeader from "@/components/ui/GreetingHeader";
import StatusPill from "@/components/ui/StatusPill";
import { ACTIVATION_STEPS, CODEX_BY_EMAIL, PLAN_MESSAGES, TESTMU_SIGNUP_URL, type ActivationStepId } from "@/data/activation-steps";
import { getPersonalMember } from "@/server/auth";
import { claimsOffHere, getActivationView, planClaimedMessage, planErrorMessage, type ActivationView } from "@/server/event-activation";
import { flowState } from "@/server/flow";
import { teamSyncMessage } from "@/lib/testmu-team";
import { getTeamInfo } from "@/server/teams";
import { teamSyncStatus } from "@/server/testmu-team";
import { ClaimPlanButton, RetryTeamInvitesForm, TickButton } from "./parts";

export const metadata: Metadata = { title: "Activate", robots: { index: false } };

// Step 3 of the event-day flow, once you're on a team: three things to switch
// on, each with a Done tick that stays done. All three → "Next: set up Codex".
// A desk activation code (/activate?code=…) still works: it goes to sign-in.

export default function ActivatePage({ searchParams }: PageProps<"/activate">) {
  return (
    <main>
      <Suspense fallback={<FlowProgress stage={null} viewing="activate" />}>
        <Progress />
      </Suspense>
      <GreetingHeader greet={(n) => ({ dim: `Almost there, ${n}.`, bright: "Three switches." })} eyebrow="Activate" dim="Three switches," bright="Then you build." intro="Your TestMu AI account, your TestMu AI plan, and your OpenAI Codex credits. Tick each one when it's done." />
      <section className="py-12 sm:py-16">
        <div className="container-page max-w-3xl">
          <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading…</p>}>
            <Checklist searchParams={searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

async function Progress() {
  const m = await getPersonalMember();
  return <FlowProgress stage={m ? (await flowState(m.id)).stage : null} viewing="activate" />;
}

async function Checklist({ searchParams }: Pick<PageProps<"/activate">, "searchParams">) {
  const sp = await searchParams;
  const member = await getPersonalMember();
  if (!member) {
    const code = typeof sp.code === "string" ? sp.code : "";
    redirect(code ? `/passport/login?mode=code&code=${encodeURIComponent(code)}&next=/me` : "/passport/login?next=/activate");
  }
  // Not on a team yet, or the team isn't confirmed (locked) yet: back to that step.
  const flow = await flowState(member.id);
  if (!member.team_id || flow.stage === "team") redirect(flow.next);
  const view = await getActivationView(member.id);
  const step1 = view.ticks.has("testmu_signup");

  return (
    <div className="space-y-6" data-activation-done={view.done}>
      <ol className="space-y-6">
        {ACTIVATION_STEPS.map((s) => (
          <StepCard key={s.id} n={s.n} title={s.title} body={s.body} done={view.ticks.has(s.id)} highlight={s.id === "testmu_signup" && view.plan?.status === "not_registered"} id={s.id}>
            {s.id === "testmu_signup" && <SignupStep done={step1} />}
            {s.id === "testmu_plan" && <PlanStep view={view} email={member.email} />}
            {s.id === "codex_credits" && <CodexStep view={view} email={member.email} />}
          </StepCard>
        ))}
      </ol>
      {view.plan?.status === "claimed" && member.team_id && <TeamInvites memberId={member.id} teamId={member.team_id} />}

      {view.done ? (
        <div className="brackets border border-lime bg-lime-deep p-5">
          <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">All three done</p>
          <p className="mt-2 font-display text-2xl text-bright">You&apos;re activated.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button href="/setup" className="min-h-11">
              Next: set up Codex →
            </Button>
          </div>
        </div>
      ) : (
        <p className="font-plex text-xs text-lightgray">Stuck on a step? The help desk can sort it out, or open a ticket at /help.</p>
      )}
    </div>
  );
}

function StepCard({ id, n, title, body, done, highlight, children }: { id: ActivationStepId; n: string; title: string; body: string; done: boolean; highlight?: boolean; children: ReactNode }) {
  return (
    <li id={id} data-step={id} data-done={done} className={`scroll-mt-24 border p-5 sm:p-6 ${highlight ? "border-warning" : done ? "border-hairline" : "border-hairline"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Step {n}</p>
          <h2 className="mt-2 font-display text-xl text-bright sm:text-2xl">{title}</h2>
        </div>
        {done ? <StatusPill tone="neutral">Done</StatusPill> : highlight ? <StatusPill tone="pending">Do this first</StatusPill> : <StatusPill tone="accent">To do</StatusPill>}
      </div>
      <p className="mt-3 max-w-2xl font-plex text-sm text-lightgray">{body}</p>
      <div className="mt-5 space-y-4">{children}</div>
    </li>
  );
}

const linkCls = "inline-flex min-h-11 items-center justify-center gap-2 border border-hairline px-4 py-2.5 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime";

function SignupStep({ done }: { done: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a href={TESTMU_SIGNUP_URL} target="_blank" rel="noopener noreferrer" className={linkCls}>
        Open TestMu AI ↗
      </a>
      <TickButton step="testmu_signup" done={done} label="I’m registered" />
    </div>
  );
}

function PlanStep({ view, email }: { view: ActivationView; email: string }) {
  const plan = view.plan;
  if (plan?.status === "claimed") {
    return <p className="font-plex text-sm text-bright">{planClaimedMessage(plan)}</p>;
  }
  if (claimsOffHere()) {
    return <p className="font-plex text-sm text-lightgray">{PLAN_MESSAGES.previewOff}</p>;
  }
  return (
    <div className="space-y-3">
      {plan?.status === "not_registered" && (
        <div role="alert" className="space-y-3 border-l-2 border-warning pl-3">
          <p className="font-plex text-sm font-semibold text-warning">You’re not signed up on TestMu AI yet.</p>
          <p className="font-plex text-sm text-bright">
            Sign up with <span className="text-lime">{email}</span>. Your hack-day plan is already saved and switches on as soon as your account exists.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a href={TESTMU_SIGNUP_URL} target="_blank" rel="noopener noreferrer" className={linkCls}>
              Sign up on TestMu AI ↗
            </a>
            <span className="font-plex text-xs text-lightgray">Then come back and press Check again.</span>
          </div>
        </div>
      )}
      {plan?.status === "error" && (
        <p role="alert" className="border-l-2 border-danger pl-3 font-plex text-sm text-danger">
          {planErrorMessage(plan)}
        </p>
      )}
      <ClaimPlanButton retry={!!plan && plan.status !== "pending"} label={plan?.status === "not_registered" ? "Check again" : undefined} />
      <p className="font-plex text-xs text-lightgray">Uses the email on your profile ({email}). Change it on your profile if it isn&apos;t the one you use for TestMu AI. Your password goes straight to TestMu AI; we never store it.</p>
    </div>
  );
}

/** Step 3: the coupon comes by email. A code handed out here before the switch stays visible. */
function CodexStep({ view, email }: { view: ActivationView; email: string }) {
  return (
    <div className="space-y-4">
      <p className="font-plex text-sm text-bright">{CODEX_BY_EMAIL(email)}</p>
      {view.code && (
        <div className="brackets border border-lime bg-lime-deep p-4" data-codex-code="assigned">
          <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">Your OpenAI Codex code · only you see this</p>
          <p className="mt-2 break-all font-dots text-3xl leading-tight font-black text-bright sm:text-4xl">{view.code.code}</p>
          <CopyField value={view.code.code} className="mt-3" />
        </div>
      )}
      <TickButton step="codex_credits" done={view.ticks.has("codex_credits")} label="Credits enabled" />
    </div>
  );
}

/** The captain's TestMu AI team: each teammate's invite status, and a retry for the ones that failed. */
async function TeamInvites({ memberId, teamId }: { memberId: number; teamId: number }) {
  const team = await getTeamInfo({ id: teamId });
  if (!team || team.captain_id !== memberId || !team.locked) return null;
  const statuses = await teamSyncStatus(teamId);
  if (!statuses.length) return null;
  const left = statuses.filter((s) => !s.done).length;
  return (
    <section id="team-invites" className="border border-hairline p-5 sm:p-6" aria-labelledby="team-invites-title" data-team-invites={left ? "pending" : "done"}>
      <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Your TestMu AI team</p>
      <h2 id="team-invites-title" className="mt-2 font-display text-xl text-bright sm:text-2xl">
        {left ? `${left} ${left === 1 ? "teammate isn’t" : "teammates aren’t"} in your TestMu AI team yet` : "Everyone is in your TestMu AI team"}
      </h2>
      <ul className="mt-4 border-t border-dashed border-hairline">
        {statuses.map((s) => (
          <li key={s.member_id} className="border-b border-dashed border-hairline py-2.5 font-plex text-sm" data-member-invite={s.code ?? "pending"}>
            <span className={s.done ? "text-lime" : "text-warning"}>{s.done ? "■" : "□"}</span> <span className="text-bright">{s.name}</span>
            <span className="block text-xs text-lightgray">{teamSyncMessage(s.code, s.name)}</span>
          </li>
        ))}
      </ul>
      {left > 0 && (
        <div className="mt-5">
          <RetryTeamInvitesForm />
        </div>
      )}
    </section>
  );
}
