"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useState, type ReactNode } from "react";
import { FormError, inputCls } from "@/components/forms/fields";
import Icon, { type IconName } from "../Icons";
import { PLATFORMS, type PlatformField } from "@/lib/online/links";
import { MIN_POSTS, formatIssues, missingForSubmit, type Issue } from "@/lib/online/required";
import { saveAction } from "./actions";
import Attachments from "./Attachments";
import type { FileRow } from "./attachment-actions";

// The project, the demo and the launch posts. Submitted with
// onSubmit + startTransition so a validation error never wipes what was typed.

// Larger type and taller boxes than the shared input style: this form is long.
const inp = `${inputCls} py-3 text-base leading-relaxed`;

const AGENTS = ["Claude Code", "Cursor", "Copilot", "Codex", "Windsurf", "Kiro", "Own MCP setup", "Other"];

export default function SubmitForm({ draft, submitted, disabled, defaultName, showcaseHref, attachments, uploadPrefix, version }: { draft: Record<string, string | null>; submitted: boolean; disabled: boolean; defaultName: string; showcaseHref: string; attachments: FileRow[]; uploadPrefix: string; version: number }) {
  const [state, action, pending] = useActionState(saveAction, null);
  const [about, setAbout] = useState(draft.project_description ?? "");
  const [pitch, setPitch] = useState(draft.one_line_pitch ?? "");
  const isSubmitted = state?.ok ? state.submitted : submitted;
  // Checked in the browser first, so an empty required field never costs a round trip.
  const [localIssues, setLocalIssues] = useState<Issue[] | null>(null);
  const issues = localIssues ?? (state && !state.ok ? state.issues : []);
  const errorMessage = localIssues?.length ? `${localIssues.length === 1 ? "1 thing needs" : `${localIssues.length} things need`} fixing. See the fields marked in red. Nothing was saved.` : state && !state.ok ? state.message : null;
  const issueFor = (path: string) => issues.filter((i) => i.path === path).map((i) => i.message).join(" ") || undefined;

  const post = (name: PlatformField, icon: IconName) => (
    <Field id={name} label={`${PLATFORMS[name].label} posts`} icon={icon} hint="Several? Separate with commas" error={issueFor(name)}>
      {(id) => <input id={id} name={name} inputMode="url" defaultValue={draft[name] ?? ""} placeholder={PLATFORMS[name].example} className={inp} />}
    </Field>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        const fd = new FormData(e.currentTarget);
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const intent = submitter?.value ?? "draft";
        fd.set("intent", intent);
        // Submitting (or editing something already submitted) needs every required field.
        {
          const values = Object.fromEntries([...fd].map(([k, v]) => [k, String(v)]));
          const missing = [...formatIssues(values), ...(intent === "submit" || isSubmitted ? missingForSubmit(values) : [])];
          if (missing.length) {
            setLocalIssues(missing);
            const first = missing[0].path === "launch" ? "x_url" : missing[0].path;
            const el = e.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`);
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
            el?.focus({ preventScroll: true });
            return;
          }
        }
        setLocalIssues(null);
        startTransition(() => action(fd));
      }}
      className="space-y-8"
    >
      {/* The version this form was loaded with: a teammate's newer save is never overwritten. */}
      <input type="hidden" name="version" value={state?.ok ? state.version : version} />
      <fieldset disabled={disabled} className="space-y-8 disabled:opacity-80">
        <Group n="01" title="Your project" note="What the judges see first.">
          <Field id="project_name" required label="Project name" error={issueFor("project_name")}>
            {(id) => <input id={id} name="project_name" defaultValue={draft.project_name ?? defaultName} maxLength={80} className={inp} />}
          </Field>
          <Field id="one_line_pitch" required label="One-liner" hint={`${pitch.length}/170`} error={issueFor("one_line_pitch")}>
            {(id) => <input id={id} name="one_line_pitch" value={pitch} onChange={(e) => setPitch(e.target.value)} maxLength={170} placeholder="What it does, in one sentence." className={inp} />}
          </Field>
          <Field id="project_description" required label="Project details" hint={`${about.length}/1500`} error={issueFor("project_description")}>
            {(id) => (
              <textarea
                id={id}
                name="project_description"
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                rows={6}
                maxLength={1500}
                placeholder="What you built, who it's for, and what Kane CLI is doing in the flow."
                className={inp}
              />
            )}
          </Field>
          <Field id="more_details" label="Anything else to add" hint="Optional" error={issueFor("more_details")}>
            {(id) => (
              <textarea id={id} name="more_details" defaultValue={draft.more_details ?? ""} rows={4} maxLength={4000} placeholder="How the agent and Kane CLI talk to each other, what Kane caught, how to run it, what's next." className={inp} />
            )}
          </Field>
          <Attachments initial={attachments} prefix={uploadPrefix} disabled={disabled} />
          <Field id="agent_used" required label="Agent used" error={issueFor("agent_used")}>
            {(id) => (
              <>
                <input id={id} name="agent_used" list={`${id}-agents`} defaultValue={draft.agent_used ?? ""} maxLength={80} placeholder="Claude Code, Cursor, Codex…" className={inp} />
                <datalist id={`${id}-agents`}>
                  {AGENTS.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </Group>

        <Group n="02" title="Show it" note="The demo, the code, and where it runs.">
          <Field id="video_url" icon="youtube" required label="YouTube demo video" hint="About 3 to 5 minutes" error={issueFor("video_url")}>
            {(id) => <input id={id} name="video_url" inputMode="url" defaultValue={draft.video_url ?? ""} placeholder="https://youtu.be/…" className={inp} />}
          </Field>
          <Field id="repo_url" icon="github" required label="GitHub URL" hint="Must be a public repo" error={issueFor("repo_url")}>
            {(id) => <input id={id} name="repo_url" inputMode="url" defaultValue={draft.repo_url ?? ""} placeholder="https://github.com/you/project" className={inp} />}
          </Field>
          <Field id="live_url" icon="link" label="Live URL" hint="Optional" error={issueFor("live_url")}>
            {(id) => <input id={id} name="live_url" inputMode="url" defaultValue={draft.live_url ?? ""} placeholder="https://your-app.vercel.app" className={inp} />}
          </Field>
        </Group>

        <Group n="03" title="Launch buzz *" note={`Required: at least ${MIN_POSTS} different public posts about your project. Paste the link to each post (not your profile). Every extra post earns brownie points.`}>
          <p className="font-plex text-sm text-lightgray">
            Not sure what to post?{" "}
            <Link href="/online/launch" target="_blank" className="text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
              Open the launch guide
            </Link>{" "}
            for hashtags, who to tag, and sample posts.
          </p>
          {issueFor("launch") && (
            <p role="alert" className="border-l-2 border-danger pl-3 font-plex text-sm text-danger">
              {issueFor("launch")}
            </p>
          )}
          {post("x_url", "x")}
          {post("linkedin_url", "linkedin")}
          {post("hn_url", "hackernews")}
          {post("reddit_url", "reddit")}
          <Field id="other_posts" icon="link" label="Posts anywhere else" hint="Blogs, dev.to, YouTube…" error={issueFor("other_posts")}>
            {(id) => <textarea id={id} name="other_posts" defaultValue={draft.other_posts ?? ""} rows={3} maxLength={1500} placeholder="Every extra post counts: blogs, follow-ups, threads…" className={inp} />}
          </Field>
        </Group>
      </fieldset>

      {!disabled && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-hairline bg-ink/95 px-4 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center gap-4">
            {!isSubmitted && (
              <button type="submit" value="draft" disabled={pending} className="inline-flex min-h-11 items-center border border-hairline px-5 font-plex text-sm text-bright hover:border-lime disabled:opacity-60">
                Save draft
              </button>
            )}
            <button type="submit" value="submit" disabled={pending} className="inline-flex min-h-11 items-center bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime disabled:cursor-wait disabled:opacity-60">
              {pending ? "Saving…" : isSubmitted ? "Update submission" : "Submit"}
            </button>
            {isSubmitted && (
              <Link href={showcaseHref} className="inline-flex min-h-11 items-center border border-hairline px-5 font-plex text-sm text-bright transition-colors hover:border-lime">
                View showcase page →
              </Link>
            )}
            <p role="status" aria-live="polite" className="font-plex text-sm text-lightgray">
              {localIssues?.length ? "Not sent yet." : state?.ok ? `${state.submitted ? `Submitted · receipt ${state.receipt}` : "Draft saved"} · ${state.when}` : isSubmitted ? "Submitted. You can still edit until the deadline." : "Not submitted yet."}
            </p>
          </div>
          {errorMessage && (
            <div className="mt-3 space-y-3">
              <FormError message={errorMessage} />
              {state && !state.ok && state.conflict && (
                <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-10 items-center border border-lime px-4 font-plex text-sm text-lime hover:bg-lime hover:text-ink">
                  Reload to see their changes
                </button>
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
    <section aria-labelledby={`g-${n}`} className="border border-hairline bg-surface/40 p-5 sm:p-8">
      <div className="mb-8 flex items-start gap-4 border-b border-dashed border-hairline pb-6">
        <span className="font-dots text-4xl leading-none font-black text-lime">{n}</span>
        <div>
          <h2 id={`g-${n}`} className="font-display text-2xl text-bright">{title}</h2>
          <p className="mt-1 max-w-xl font-plex text-sm leading-relaxed text-lightgray">{note}</p>
        </div>
      </div>
      <div className="space-y-7">{children}</div>
    </section>
  );
}

function Field({ id, label, hint, error, required, icon, children }: { id: string; label: string; hint?: ReactNode; error?: string; required?: boolean; icon?: IconName; children: (id: string) => ReactNode }) {
  const uid = `${useId()}-${id}`;
  return (
    <div className={error ? "[&_input]:border-danger [&_textarea]:border-danger" : undefined}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={uid} className="font-display text-base text-bright">
          {label}
          {required && (
            <span className="ml-1 text-lime" title="Required">
              *
            </span>
          )}
        </label>
        {hint && <span className="font-plex text-sm text-lightgray">{hint}</span>}
      </div>
      {icon ? (
        <div className="flex">
          {/* The platform's mark, joined to the left edge of the box. */}
          <span className="grid w-12 shrink-0 place-items-center border border-r-0 border-hairline bg-surface-2 text-bright">
            <Icon name={icon} className="h-5 w-5" />
          </span>
          {children(uid)}
        </div>
      ) : (
        children(uid)
      )}
      {error && <p role="alert" className="mt-2 font-plex text-sm text-danger">{error}</p>}
    </div>
  );
}
