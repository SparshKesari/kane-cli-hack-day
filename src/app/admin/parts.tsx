"use client";

import { useActionState, useState } from "react";
import { FormError, Label, SubmitButton, inputCls } from "@/components/forms/fields";
import { adminLoginAction, resetLinkAction } from "./actions";

export function AdminLogin() {
  const [state, action] = useActionState(adminLoginAction, null);
  return (
    <form action={action} className="space-y-5">
      <div>
        <Label htmlFor="password">Organiser password</Label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} />
      </div>
      <FormError message={state?.error} />
      <SubmitButton pending="Checking…" className="min-h-11 w-full">
        Open organiser view
      </SubmitButton>
    </form>
  );
}

/** Makes a one-hour password reset link the organiser can send to a participant. */
export function ResetLinkButton({ participantId }: { participantId: number }) {
  const [state, action, pending] = useActionState(resetLinkAction.bind(null, participantId), null);
  const [copied, setCopied] = useState(false);
  if (state && "link" in state) {
    return (
      <span className="flex items-center gap-2">
        <input readOnly value={state.link} aria-label="Reset link" onFocus={(e) => e.currentTarget.select()} className="w-56 border border-hairline bg-surface px-2 py-1 font-plex text-xs text-bright" />
        <button
          type="button"
          className="text-lime underline underline-offset-4"
          onClick={async () => {
            await navigator.clipboard.writeText(state.link).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </span>
    );
  }
  return (
    <form action={action}>
      <button type="submit" disabled={pending} className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
        {pending ? "Making…" : "Reset link"}
      </button>
      {state && "error" in state && <span className="ml-2 text-danger">{state.error}</span>}
    </form>
  );
}
