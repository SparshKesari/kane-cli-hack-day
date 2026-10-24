"use client";

import { upload } from "@vercel/blob/client";
import { startTransition, useActionState, useId, useRef, useState, type ReactNode } from "react";
import { FormError, Label, inputCls } from "@/components/forms/fields";
import StatusPill from "@/components/ui/StatusPill";
import type { SubmissionDraft } from "@/server/submission";
import { saveDraftAction } from "./actions";

// The official submission form. One draft, saved as often as you like until
// finalize; every field maps to the canonical project story the showcase and
// deck are built from. Submitted with onSubmit + startTransition (not the
// form `action` prop) so a validation error never wipes what was typed.

export type RunOption = { id: number; label: string; status: string; tone: "verified" | "suspected" | "unverified"; toneLabel: string; commit: string | null; when: string };

const MAX_SHOTS = 6;

export default function SubmissionForm({
  slug,
  projectSlug,
  projectId,
  draft,
  runs,
  types,
  components,
  disabled,
}: {
  slug: string;
  projectSlug: string;
  projectId: number;
  draft: SubmissionDraft;
  runs: RunOption[];
  types: { value: string; label: string }[];
  components: { id: string; label: string }[];
  /** Locked, or viewed by an organizer: show the fields, no saving. */
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(saveDraftAction.bind(null, slug), null);
  const [shots, setShots] = useState(draft.screenshots);
  const [pitch, setPitch] = useState(draft.one_line_pitch ?? "");
  const issues = state && !state.ok ? ((state.error.details?.issues as { path: string; message: string }[] | undefined) ?? []) : [];
  const issueFor = (path: string) => issues.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message;

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
        <Group n="01" title="The creation" note="What you made, in your own words. This is the top of your public showcase page, unless your team published a story in the Ship Studio: that story stays, and your screenshots and video are added to it.">
          <Field id="project_name" label="Project name" error={issueFor("project_name")}>
            {(id) => <input id={id} name="project_name" defaultValue={draft.project_name ?? ""} maxLength={80} required className={inputCls} />}
          </Field>
          <Field id="project_type" label="Project type" error={issueFor("project_type")}>
            {(id) => (
              <select key={draft.project_type} id={id} name="project_type" defaultValue={draft.project_type} className={inputCls}>
                {types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id="one_line_pitch" label="One-line pitch" hint={`${pitch.length}/170`} error={issueFor("one_line_pitch")}>
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
          <Field id="problem" label="Problem" error={issueFor("problem")}>
            {(id) => <textarea id={id} name="problem" defaultValue={draft.problem ?? ""} rows={3} maxLength={1500} className={inputCls} />}
          </Field>
          <Field id="what_we_built" label="What we built" error={issueFor("what_we_built")}>
            {(id) => <textarea id={id} name="what_we_built" defaultValue={draft.what_we_built ?? ""} rows={4} maxLength={2000} className={inputCls} />}
          </Field>
          <Field id="how_it_works" label="How it works" hint="One step per line, up to 8" error={issueFor("how_it_works")}>
            {(id) => <textarea id={id} name="how_it_works" defaultValue={draft.how_it_works.join("\n")} rows={4} className={inputCls} />}
          </Field>
        </Group>

        <Group n="02" title="The harness" note="How Kane verifies what you built, and which parts of Kane you used.">
          <Field id="harness_summary" label="Harness description" error={issueFor("harness_summary")}>
            {(id) => <textarea id={id} name="harness_summary" defaultValue={draft.harness_summary ?? ""} rows={4} maxLength={1500} className={inputCls} />}
          </Field>
          <fieldset>
            <legend className="mb-2 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Kane components used</legend>
            <div className="grid gap-x-6 sm:grid-cols-2">
              {components.map((c) => (
                <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 font-plex text-sm text-bright">
                  <input type="checkbox" name="kane_components" value={c.id} defaultChecked={draft.kane_components.includes(c.id)} className="h-4 w-4 accent-[var(--lime)]" />
                  {c.label}
                </label>
              ))}
            </div>
            {issueFor("kane_components") && <p className="mt-1 font-plex text-xs text-danger">{issueFor("kane_components")}</p>}
          </fieldset>
          <fieldset>
            <legend className="mb-2 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">4-step harness flow</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <label key={i} className="flex items-center gap-3">
                  <span className="w-6 shrink-0 font-dots text-lg text-lightgray" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="sr-only">Stage {i + 1}</span>
                  <input
                    name={`harness_stage_${i}`}
                    defaultValue={draft.harness_stages[i] ?? ""}
                    maxLength={80}
                    placeholder={["Make a change", "Choose what matters", "Run Kane, read evidence", "Ship or iterate"][i]}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        </Group>

        <Group n="03" title="Source and demo" note="The exact revision judges will look at, and how to see it running.">
          <Field id="repo_url" label="Repository URL" error={issueFor("repo_url")}>
            {(id) => <input id={id} name="repo_url" type="url" inputMode="url" defaultValue={draft.repo_url ?? ""} placeholder="https://github.com/you/project" className={inputCls} />}
          </Field>
          <Field id="commit_sha" label="Commit SHA" hint="git rev-parse HEAD" error={issueFor("commit_sha")}>
            {(id) => (
              <input
                id={id}
                name="commit_sha"
                defaultValue={draft.commit_sha ?? ""}
                pattern="[0-9a-fA-F]{40}"
                title="The full 40-character commit SHA"
                spellCheck={false}
                autoComplete="off"
                className={`${inputCls} font-mono`}
              />
            )}
          </Field>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field id="demo_url" label="Live demo URL" error={issueFor("demo_url")}>
              {(id) => <input id={id} name="demo_url" type="url" inputMode="url" defaultValue={draft.demo_url ?? ""} placeholder="https://…" className={inputCls} />}
            </Field>
            <Field id="run_command" label="…or run command" error={issueFor("run_command")}>
              {(id) => <input id={id} name="run_command" defaultValue={draft.run_command ?? ""} placeholder="npx your-tool" spellCheck={false} className={`${inputCls} font-mono`} />}
            </Field>
          </div>
        </Group>

        <Group n="04" title="Evidence" note="Link the Kane runs you reported from a paired machine. A failing run counts as a detection, not a confirmed bug.">
          {runs.length ? (
            <fieldset>
              <legend className="mb-2 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Kane runs for this project</legend>
              <ul className="divide-y divide-dashed divide-hairline border-y border-dashed border-hairline">
                {runs.map((r) => (
                  <li key={r.id}>
                    <label className="flex min-h-11 cursor-pointer flex-wrap items-center gap-3 py-2 font-plex text-sm">
                      <input type="checkbox" name="kane_run_ids" value={r.id} defaultChecked={draft.kane_run_ids.includes(r.id)} className="h-4 w-4 accent-[var(--lime)]" />
                      <span className="min-w-0 flex-1 text-bright">{r.label}</span>
                      <StatusPill tone={r.tone}>{r.toneLabel}</StatusPill>
                      <span className="w-full pl-7 text-xs text-lightgray sm:w-auto sm:pl-0">
                        {r.when}
                        {r.commit && <> · {r.commit.slice(0, 7)}</>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : (
            <p className="border-l-2 border-hairline pl-3 font-plex text-sm text-lightgray">
              No Kane runs reported for this project yet. Report one with <code className="text-bright">kanehack report</code> from the Proof tab, or paste report links below (shown as participant reported).
            </p>
          )}
          <Field id="evidence_refs" label="Run report / evidence links" hint="One https link per line" error={issueFor("evidence_refs")}>
            {(id) => <textarea id={id} name="evidence_refs" defaultValue={draft.evidence_refs.join("\n")} rows={3} className={inputCls} />}
          </Field>
        </Group>

        <Group n="05" title="Media" note="Real captures only. Screenshots stay private until your showcase is published.">
          <Screenshots projectSlug={projectSlug} projectId={projectId} shots={shots} setShots={setShots} slug={slug} disabled={disabled} />
          <Field id="video_url" label="Demo video URL" hint="YouTube, Loom or an https video" error={issueFor("video_url")}>
            {(id) => <input id={id} name="video_url" type="url" inputMode="url" defaultValue={draft.video_url ?? ""} placeholder="https://…" className={inputCls} />}
          </Field>
        </Group>

        <Group n="06" title="Outcome" note="Numbers need a source, or they show as qualitative. Limitations are required: honest gaps score better than hidden ones.">
          <fieldset className="space-y-4">
            <legend className="mb-2 font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Measured impact (up to 3)</legend>
            {[0, 1, 2].map((i) => {
              const row = draft.impact[i];
              return (
                <div key={i} className="grid gap-2 border-l border-hairline pl-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                  <input name={`impact_claim_${i}`} defaultValue={row?.claim ?? ""} maxLength={200} aria-label={`Impact ${i + 1}: claim`} placeholder="Claim, e.g. regression time per PR" className={inputCls} />
                  <input name={`impact_measure_${i}`} defaultValue={row?.measure ?? ""} inputMode="decimal" aria-label={`Impact ${i + 1}: measured value`} placeholder="Value" className={inputCls} />
                  <input name={`impact_unit_${i}`} defaultValue={row?.unit ?? ""} maxLength={30} aria-label={`Impact ${i + 1}: unit`} placeholder="Unit" className={inputCls} />
                  <input name={`impact_baseline_${i}`} defaultValue={row?.baseline ?? ""} inputMode="decimal" aria-label={`Impact ${i + 1}: baseline`} placeholder="Baseline" className={inputCls} />
                  <input
                    name={`impact_source_${i}`}
                    defaultValue={row?.source ?? ""}
                    maxLength={300}
                    aria-label={`Impact ${i + 1}: source`}
                    placeholder="Source (run id, link, how measured)"
                    className={`${inputCls} sm:col-span-4`}
                  />
                </div>
              );
            })}
            {issueFor("impact") && <p className="font-plex text-xs text-danger">{issueFor("impact")}</p>}
          </fieldset>
          <Field id="limitations" label="Known limitations" hint="One per line" error={issueFor("limitations")}>
            {(id) => <textarea id={id} name="limitations" defaultValue={draft.limitations.join("\n")} rows={3} className={inputCls} />}
          </Field>
        </Group>

        <Group n="07" title="Links" note="Optional. Devpost and your posts about the build.">
          <Field id="devpost_url" label="Devpost project" error={issueFor("devpost_url")}>
            {(id) => <input id={id} name="devpost_url" type="url" inputMode="url" defaultValue={draft.devpost_url ?? ""} placeholder="https://devpost.com/software/…" className={inputCls} />}
          </Field>
          <Field id="social_links" label="Social posts" hint="One https link per line" error={issueFor("social_links")}>
            {(id) => <textarea id={id} name="social_links" defaultValue={draft.social_links.join("\n")} rows={3} className={inputCls} />}
          </Field>
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

const mediaUrl = (projectSlug: string, path: string) => `/ship/${projectSlug}/media/${path.split("/").map(encodeURIComponent).join("/")}`;

function Screenshots({
  slug,
  projectSlug,
  projectId,
  shots,
  setShots,
  disabled,
}: {
  slug: string;
  projectSlug: string;
  projectId: number;
  shots: { path: string; alt: string }[];
  setShots: (fn: (s: { path: string; alt: string }[]) => { path: string; alt: string }[]) => void;
  disabled: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      for (const f of Array.from(files).slice(0, MAX_SHOTS - shots.length)) {
        if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is over 10 MB.`);
        const ext = (f.type.split("/")[1] ?? "png").replace("jpeg", "jpg");
        const res = await upload(`showcase/p${projectId}/shot.${ext}`, f, {
          access: "private",
          handleUploadUrl: `/t/${slug}/submit/upload`,
          contentType: f.type,
        });
        setShots((s) => [...s, { path: res.pathname, alt: "" }]);
      }
    } catch (e) {
      setError((e as Error).message || "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">
        Screenshots · {shots.length}/{MAX_SHOTS}
      </p>
      {shots.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {shots.map((s, i) => (
            <li key={s.path} className="brackets border border-hairline bg-surface p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- private blob served through an auth-checked route */}
              <img src={mediaUrl(projectSlug, s.path)} alt={s.alt || `Screenshot ${i + 1}`} className="aspect-video w-full bg-surface-2 object-contain" />
              <input type="hidden" name="screenshot_path" value={s.path} />
              <input
                name="screenshot_alt"
                value={s.alt}
                onChange={(e) => setShots((all) => all.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                maxLength={200}
                aria-label={`Screenshot ${i + 1}: describe it for screen readers`}
                placeholder="Describe what it shows (alt text)"
                className={`${inputCls} mt-2`}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => setShots((all) => [all[i], ...all.filter((_, j) => j !== i)])}
                  className="min-h-11 border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime disabled:opacity-40"
                >
                  {i === 0 ? "Cover image" : "Make cover"}
                </button>
                <button
                  type="button"
                  onClick={() => setShots((all) => all.filter((_, j) => j !== i))}
                  className="min-h-11 px-3 font-plex text-xs text-lightgray hover:text-danger"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!disabled && shots.length < MAX_SHOTS && (
        <div>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="sr-only" tabIndex={-1} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          <button
            type="button"
            disabled={busy}
            onClick={() => file.current?.click()}
            className="inline-flex min-h-11 items-center border border-dashed border-lightgray/60 px-4 font-plex text-sm text-bright transition-colors hover:border-lime hover:text-lime disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Add screenshots"}
          </button>
          <p className="mt-1 font-plex text-xs text-lightgray">PNG, JPEG, WebP or GIF, up to 10 MB each. Removing one here takes effect when you save.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="font-plex text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
