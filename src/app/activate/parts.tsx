"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Label, inputCls } from "@/components/forms/fields";
import type { ActivationStepId } from "@/data/activation-steps";
import { claimPlanAction, codexCodeAction, retryTeamInvitesAction, tickAction, type ActState } from "./actions";

// Small client controls for the /activate checklist. Each posts a server
// action; the page re-renders from the database afterwards.

const primary = "inline-flex min-h-11 items-center justify-center gap-2 bg-bright px-4 py-2.5 font-plex text-sm text-ink transition-colors hover:bg-lime disabled:cursor-wait disabled:opacity-60";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 border border-hairline px-4 py-2.5 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime disabled:cursor-wait disabled:opacity-60";

function Submit({ className, pending, children }: { className: string; pending: ReactNode; children: ReactNode }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" disabled={busy} className={className}>
      {busy ? pending : children}
    </button>
  );
}

function Note({ state }: { state: ActState }) {
  if (!state?.message || state.ok) return null;
  return (
    <p role="alert" className="basis-full border-l-2 border-danger pl-3 font-plex text-sm text-danger">
      {state.message}
    </p>
  );
}

export function TickButton({ step, done, label = "Done" }: { step: ActivationStepId; done: boolean; label?: string }) {
  const [state, setState] = useState<ActState>(null);
  return (
    <form action={async () => setState(await tickAction(step, !done))} className="flex flex-wrap items-center gap-3">
      <Submit className={done ? secondary : primary} pending="Saving…">
        {done ? "Undo" : `✓ ${label}`}
      </Submit>
      <Note state={state} />
    </form>
  );
}

export function ClaimPlanButton({ retry, label }: { retry: boolean; label?: string }) {
  const [state, setState] = useState<ActState>(null);
  return (
    <form action={async (form) => setState(await claimPlanAction(form))} className="flex flex-wrap items-end gap-3">
      <div className="min-w-60 flex-1">
        <Label htmlFor="plan-pw" hint="New to TestMu AI? Choose one, 8+ characters">TestMu AI password</Label>
        <input id="plan-pw" name="password" type="password" required minLength={8} maxLength={255} autoComplete="new-password" className={`${inputCls} min-h-11`} />
      </div>
      <Submit className={primary} pending="Activating…">
        {label ?? (retry ? "Try again" : "Activate my plan")}
      </Submit>
      {state?.outcome === "in_progress" && <p className="basis-full font-plex text-sm text-lightgray">{state.message}</p>}
      {state && !state.outcome && <Note state={state} />}
    </form>
  );
}

export function GetCodeButton() {
  const [state, setState] = useState<ActState>(null);
  return (
    <form action={async () => setState(await codexCodeAction())} className="flex flex-wrap items-center gap-3">
      <Submit className={primary} pending="Getting your code…">
        Get my Codex credit code
      </Submit>
      <Note state={state} />
    </form>
  );
}

/** Captain: retry the team invites that failed. Teammates already added or invited are skipped. */
export function RetryTeamInvitesForm() {
  const [state, setState] = useState<ActState>(null);
  return (
    <form action={async (form) => setState(await retryTeamInvitesAction(form))} className="flex flex-wrap items-end gap-3" data-team-invites-retry>
      <div className="min-w-60 flex-1">
        <Label htmlFor="invite-pw" hint="Used once · never stored">Your TestMu AI password</Label>
        <input id="invite-pw" name="password" type="password" required minLength={8} maxLength={255} autoComplete="current-password" className={`${inputCls} min-h-11`} />
      </div>
      <Submit className={primary} pending="Inviting…">
        Retry team invites
      </Submit>
      <Note state={state} />
    </form>
  );
}
