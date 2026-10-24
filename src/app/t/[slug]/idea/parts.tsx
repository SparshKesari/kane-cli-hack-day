"use client";

import { useActionState, useState } from "react";
import { Label, SubmitButton, Toggle, inputCls } from "@/components/forms/fields";
import { ActionNote } from "@/app/team/ui";
import { saveIdeaAction, submitIdeaAction, validateIdeaAction, type IdeaFormState, type SubmitIdeaState, type ValidateState } from "./actions";

export function IdeaForm({
  slug,
  defaults,
  disabled,
}: {
  slug: string;
  defaults: { title: string; app_type: string; private_description: string; kane_plan: string; extra_info: string; public_summary: string; discovery_opt_in: boolean; project_type: string };
  disabled: boolean;
}) {
  const [state, action] = useActionState<IdeaFormState, FormData>(saveIdeaAction.bind(null, slug), null);
  return (
    <form action={action} className="space-y-6">
      <fieldset disabled={disabled} className="space-y-6 disabled:opacity-60">
        <div>
          <Label htmlFor="i-title" hint="Product name">
            What are you building?
          </Label>
          <input id="i-title" name="title" required maxLength={120} defaultValue={defaults.title} className={inputCls} placeholder="e.g. Ledger" />
        </div>
        <div>
          <Label htmlFor="i-type">What type of app is it?</Label>
          <input id="i-type" name="app_type" maxLength={120} defaultValue={defaults.app_type} className={inputCls} placeholder="Web App, Mobile App, others" />
        </div>
        <div>
          <Label htmlFor="i-desc">Description</Label>
          <p className="mb-2 font-plex text-sm text-lightgray">Give us the gist in a few lines: what it does, who the users are, and what problem or gap it solves.</p>
          <textarea
            id="i-desc"
            name="private_description"
            maxLength={4000}
            rows={6}
            defaultValue={defaults.private_description}
            className={inputCls}
            placeholder={"What it does: …\nWho the users are: …\nWhat problem or gap it solves: …"}
          />
        </div>
        <div>
          <Label htmlFor="i-kane">How are you planning to use Kane CLI?</Label>
          <textarea
            id="i-kane"
            name="kane_plan"
            maxLength={4000}
            rows={4}
            defaultValue={defaults.kane_plan}
            className={inputCls}
            placeholder="e.g. Codex runs Kane CLI after every change, reads the report and fixes what it finds. We save the tests in the repo and replay them before we submit."
          />
        </div>
        <div>
          <Label htmlFor="i-extra" hint="Optional">
            Anything else you want to share?
          </Label>
          <textarea id="i-extra" name="extra_info" maxLength={4000} rows={3} defaultValue={defaults.extra_info} className={inputCls} />
        </div>
        {/* Kept as they are: the old sharing choice and project-type field aren't asked here any more. */}
        <input type="hidden" name="project_type" value={defaults.project_type} />
        <input type="hidden" name="public_summary" value={defaults.public_summary} />
        {defaults.discovery_opt_in && <input type="hidden" name="discovery_opt_in" value="on" />}
      </fieldset>
      <p className="font-plex text-xs text-lightgray">Shared with your team and the organizers only. Anyone on the team can edit it; each save is a new revision.</p>
      <ActionNote state={state} ok="Saved as a new revision." />
      {!disabled && (
        <SubmitButton pending="Saving…" className="min-h-11">
          Save idea
        </SubmitButton>
      )}
    </form>
  );
}

export function ValidateForm({ slug, disabled }: { slug: string; disabled: boolean }) {
  const [state, action] = useActionState<ValidateState, FormData>(validateIdeaAction.bind(null, slug), null);
  return (
    <form action={action} className="space-y-3">
      <Toggle
        name="use_ai"
        label="Use AI for this check"
        defaultChecked
        description="Sends your title and description to the AI model through the Vercel AI Gateway for this check only. Off = rule-based check, nothing leaves our server."
      />
      <ActionNote state={state} ok="Checked." />
      <SubmitButton pending="Checking… (up to a minute)" className={`min-h-11 ${disabled ? "pointer-events-none opacity-50" : ""}`}>
        Validate idea
      </SubmitButton>
    </form>
  );
}

/** Lock and submit: shown once the saved idea has been validated. */
export function SubmitIdeaForm({ slug }: { slug: string }) {
  const [state, action] = useActionState<SubmitIdeaState, FormData>(submitIdeaAction.bind(null, slug), null);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <label className="flex min-h-11 cursor-pointer items-start gap-3 font-plex text-sm text-bright">
        <input type="checkbox" name="confirm" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--lime)]" />
        <span>This is the idea we&apos;re building. Lock it for the whole team; it can&apos;t be edited after this.</span>
      </label>
      <ActionNote state={state} ok="Locked." />
      <SubmitButton pending="Locking…" className={`min-h-11 ${confirmed ? "" : "pointer-events-none opacity-50"}`}>
        Lock and submit idea
      </SubmitButton>
    </form>
  );
}
