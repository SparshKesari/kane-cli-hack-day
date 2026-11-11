"use client";

import { useActionState, useState } from "react";
import { FormError, Label, SubmitButton, inputCls } from "@/components/forms/fields";
import { slugify } from "@/lib/slug";
import { renameTeamAction, teamAction } from "./actions";

const MODES = [
  { id: "team", label: "Start a team", note: "You're the captain. Get a code to share." },
  { id: "join", label: "Join a team", note: "Your captain has the code." },
  { id: "solo", label: "Go solo", note: "Just you. Add teammates later if you like." },
] as const;
type Mode = (typeof MODES)[number]["id"];

export default function TeamForms() {
  const [mode, setMode] = useState<Mode>("team");
  const [name, setName] = useState("");
  const [state, action] = useActionState(teamAction, null);
  const slug = slugify(name);

  return (
    <form action={action} className="space-y-6">
      <fieldset>
        <legend className="mb-3 font-display text-base text-bright">How are you taking part?</legend>
        <div className="grid gap-px border border-dashed border-hairline bg-hairline sm:grid-cols-3">
          {MODES.map((m) => (
            <label key={m.id} className={`cursor-pointer p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lime ${mode === m.id ? "bg-lime text-ink" : "bg-ink hover:bg-surface"}`}>
              <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="sr-only" />
              <span className={`block font-display text-lg ${mode === m.id ? "" : "text-bright"}`}>{m.label}</span>
              <span className={`mt-1 block font-plex text-sm ${mode === m.id ? "" : "text-lightgray"}`}>{m.note}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "join" && (
        <div>
          <Label htmlFor="code">Team code</Label>
          <input id="code" name="code" required placeholder="KANE-XXXXXX" autoCapitalize="characters" className={`${inputCls} uppercase`} />
        </div>
      )}
      {mode === "team" && (
        <div>
          <Label htmlFor="name">Team name</Label>
          <input id="name" name="name" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          <p className="mt-2 font-plex text-sm text-lightgray">
            Your showcase page will be <span className="text-bright">/o/p/{slug || "your-team"}</span>. You can rename the team until you submit.
          </p>
        </div>
      )}
      {mode === "solo" && <p className="font-plex text-sm leading-relaxed text-lightgray">Nothing to name. If a teammate turns up later, share your code from the team page and you become a team.</p>}

      <FormError message={state?.error} />
      <SubmitButton className="min-h-11 w-full">{mode === "team" ? "Create team →" : mode === "join" ? "Join team →" : "Continue solo →"}</SubmitButton>
    </form>
  );
}

/** Captain only: rename the team (and with it the page address). */
export function RenameForm({ current }: { current: string }) {
  const [name, setName] = useState(current);
  const [state, action] = useActionState(renameTeamAction, null);
  return (
    <form action={action} className="space-y-3">
      <Label htmlFor="rename">Team name</Label>
      <div className="flex gap-2">
        <input id="rename" name="name" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        <SubmitButton pending="Saving…" className="shrink-0">Rename</SubmitButton>
      </div>
      <p className="font-plex text-sm text-lightgray">
        Page address becomes <span className="text-bright">/o/p/{slugify(name) || "your-team"}</span>.
      </p>
      <FormError message={state?.error} />
    </form>
  );
}
