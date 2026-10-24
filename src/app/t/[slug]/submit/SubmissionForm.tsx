"use client";

import { startTransition, useActionState, useId, useState, type ReactNode } from "react";
import { FormError, Label, inputCls } from "@/components/forms/fields";
import type { SubmissionDraft } from "@/server/submission";
import { saveDraftAction } from "./actions";

// The official submission form. One draft, saved as often as you like until
// finalize. Name, description, pitch and the GitHub repo are required; every
// link is optional. Fields from the earlier form stay in a saved draft (the
// save only changes what this form sends). Submitted with onSubmit +
// startTransition (not the form `action` prop) so a validation error never
// wipes what was typed.

export type RunOption = { id: number; label: string; status: string; tone: "verified" | "suspected" | "unverified"; toneLabel: string; commit: string | null; when: string };

type Props = {
  slug: string;
  projectSlug: string;
  projectId: number;
  draft: SubmissionDraft;
  runs: RunOption[];
  types: { value: string; label: string }[];
  components: { id: string; label: string }[];
  /** Locked, or viewed by an organizer: show the fields, no saving. */
  disabled: boolean;
};

const SEVERAL = "Several? Separate them with commas";

export default function SubmissionForm({ slug, draft, disabled }: Props) {
  const [state, action, pending] = useActionState(saveDraftAction.bind(null, slug), null);
  const [pitch, setPitch] = useState(draft.one_line_pitch ?? "");
  const issues = state && !state.ok ? ((state.error.details?.issues as { path: string; message: string }[] | undefined) ?? []) : [];
  const issueFor = (path: string) => issues.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message;
  const url = (name: "showcase_url" | "deck_url" | "video_url" | "hn_url", label: string, placeholder: string) => (
    <Field id={name} label={label} error={issueFor(name)}>
      {(id) => <input id={id} name={name} type="url" inputMode="url" defaultValue={draft[name] ?? ""} placeholder={placeholder} className={inputCls} />}
    </Field>
  );
  const urls = (name: "linkedin_posts" | "x_posts" | "blog_links", label: string, placeholder: string) => (
    <Field id={name} label={label} hint={SEVERAL} error={issueFor(name)}>
      {(id) => <textarea id={id} name={name} defaultValue={draft[name].join(", ")} rows={2} placeholder={placeholder} className={inputCls} />}
    </Field>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="space-y-12"
      aria-describedby="draft-status"
    >
      <fieldset disabled={disabled} className="space-y-12 disabled:opacity-80">
        <Group n="01" title="Your project" note="Required to finalize. If your team published a story in the Ship Studio, that stays your public page.">
          <Field id="project_name" label="Project name" error={issueFor("project_name")}>
            {(id) => <input id={id} name="project_name" defaultValue={draft.project_name ?? ""} maxLength={80} required className={inputCls} />}
          </Field>
          <Field id="one_line_pitch" label="One-liner pitch" hint={`${pitch.length}/170`} error={issueFor("one_line_pitch")}>
            {(id) => (
              <input
                id={id}
                name="one_line_pitch"
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                maxLength={170}
                placeholder="Ship the changes that deserve to ship."
                className={inputCls}
              />
            )}
          </Field>
          <Field id="project_description" label="Project description" error={issueFor("project_description")}>
            {(id) => <textarea id={id} name="project_description" defaultValue={draft.project_description ?? ""} rows={6} maxLength={3000} className={inputCls} />}
          </Field>
          <Field id="repo_url" label="GitHub repo URL" error={issueFor("repo_url")}>
            {(id) => <input id={id} name="repo_url" type="url" inputMode="url" defaultValue={draft.repo_url ?? ""} placeholder="https://github.com/you/project" className={inputCls} />}
          </Field>
        </Group>

        <Group n="02" title="Showcase and launch" note="Optional. Paste the live https links.">
          {url("showcase_url", "Showcase page", "https://…")}
          {urls("linkedin_posts", "LinkedIn post(s)", "https://www.linkedin.com/posts/…")}
          {urls("x_posts", "X post(s)", "https://x.com/you/status/…")}
          {urls("blog_links", "Blog link(s)", "https://…")}
          {url("deck_url", "Deck", "https://…")}
          {url("video_url", "Video", "YouTube, Loom or an https video")}
          {url("hn_url", "Hacker News post", "https://news.ycombinator.com/item?id=…")}
        </Group>
      </fieldset>

      {!disabled && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-hairline bg-ink/95 px-4 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-11 items-center justify-center bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime disabled:cursor-wait disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save draft"}
            </button>
            <p id="draft-status" role="status" aria-live="polite" className="font-plex text-xs text-lightgray">
              {state?.ok ? `Saved · ${state.receipt?.server_time ? new Date(state.receipt.server_time).toLocaleTimeString() : ""} (server time)` : "Not finalized. Save as often as you like."}
            </p>
          </div>
          {state && !state.ok && (
            <div className="mt-3 space-y-1">
              <FormError message={state.error.message} />
              {issues.length > 0 && (
                <ul className="pl-4 font-plex text-xs text-danger">
                  {issues.map((i) => (
                    <li key={i.path + i.message}>
                      {i.path || "form"}: {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </form>
  );
}

function Group({ n, title, note, children }: { n: string; title: string; note: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`g-${n}`} className="space-y-6 border-t border-dashed border-hairline pt-6">
      <div>
        <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">{n}</p>
        <h3 id={`g-${n}`} className="mt-1 font-display text-2xl text-bright">
          {title}
        </h3>
        <p className="mt-1 max-w-xl font-plex text-xs leading-relaxed text-lightgray">{note}</p>
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode }) {
  const uid = `${useId()}-${id}`;
  return (
    <div>
      <Label htmlFor={uid} hint={hint}>
        {label}
      </Label>
      {children(uid)}
      {error && (
        <p role="alert" className="mt-1 font-plex text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
