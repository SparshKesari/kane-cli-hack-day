"use client";

import { useMemo, useState, useTransition } from "react";
import { Toggle } from "@/components/forms/fields";
import StatusPill from "@/components/ui/StatusPill";
import { CONFIDENCES, CREATION_LABEL, CREATION_TYPES, type Story } from "@/components/ship-templates/model";
import { reviewStory, type EvidenceOption, type RunOption } from "@/components/ship-templates/review";
import { issueText } from "@/lib/issue-text";
import { saveStoryAction } from "./actions";
import { Field, IconButton, ListField, Panel, ResultLine, Select, newKey } from "./fields";

// The story editor (T-SHIP-01/02). Every field of project-story.schema.json,
// a live claim/evidence review against this project's real Kane runs and
// evidence, and a save that creates a new immutable version. The server
// re-runs the same review and refuses forged "verified" claims.

export type Person = { id: number; name: string; handle: string | null; creditConsent: boolean; mentionConsent: boolean };
export type VersionSummary = { version: number; createdAt: string; createdBy: string | null; reviewedAt: string | null; content: Story };

const CONF_LABEL = { verified: "Verified (bound to evidence)", participant_reported: "Team-reported", unverified: "Unverified" } as const;

export default function StoryEditor({
  slug,
  initial,
  initialVersion,
  people,
  sources,
  versions,
  canWrite,
}: {
  slug: string;
  initial: Story;
  initialVersion: number;
  people: Person[];
  sources: { runs: RunOption[]; evidence: EvidenceOption[] };
  versions: VersionSummary[];
  canWrite: boolean;
}) {
  const [story, setStory] = useState<Story>(initial);
  const [version, setVersion] = useState(initialVersion);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; receipt?: string } | null>(null);
  const [pending, start] = useTransition();
  const review = useMemo(() => reviewStory(story, sources), [story, sources]);

  const update = (patch: Partial<Story>) => {
    setStory((s) => ({ ...s, ...patch }));
    setDirty(true);
  };
  const credited = new Map(story.team.map((t) => [t.display_name.toLowerCase(), t.publicly_credited]));

  const save = () =>
    start(async () => {
      const r = await saveStoryAction(slug, story, version, newKey());
      if (r.ok) {
        setVersion(r.data.version);
        setStory(r.data.content);
        setDirty(false);
        setResult({ ok: true, message: `Saved as version ${r.data.version}.`, receipt: r.receipt?.id });
      } else {
        setResult({ ok: false, message: issueText(r.error) });
      }
    });

  const load = (v: VersionSummary) => {
    setStory(v.content);
    setDirty(true);
    setResult({ ok: true, message: `Loaded version ${v.version} into the editor. Save to make it the latest (a new version; history is kept).` });
  };

  const runOptions = [{ value: "", label: "No run" }, ...sources.runs.map((r) => ({ value: r.id, label: `Run ${r.id} · ${r.status}${r.sourceVerified ? " · source-verified" : " · reported"}${r.objective ? ` · ${r.objective.slice(0, 40)}` : ""}` }))];
  const evOptions = [{ value: "", label: "No evidence" }, ...sources.evidence.map((e) => ({ value: e.id, label: `Evidence ${e.id} · ${e.kind} · ${e.sha}${e.verified ? " · verified" : ""}` }))];

  return (
    <div className="container-page pb-32">
      <fieldset disabled={!canWrite} className="min-w-0">
        <Panel eyebrow="01 · The creation" title="What you made" intro="Plain facts. This text is public once you publish; keep private idea notes out of it.">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Project name" value={story.project_name} max={120} onChange={(v) => update({ project_name: v })} />
            <Select label="Creation type" value={story.creation_type} options={CREATION_TYPES.map((c) => ({ value: c, label: CREATION_LABEL[c] }))} onChange={(v) => update({ creation_type: v })} />
            <div className="md:col-span-2">
              <Field label="One-line pitch (outcome)" value={story.one_line_pitch} max={170} onChange={(v) => update({ one_line_pitch: v })} placeholder="Who it's for and what changes for them." />
            </div>
            <Field label="Problem" multiline rows={4} value={story.problem} max={1200} onChange={(v) => update({ problem: v })} />
            <Field label="What we built" multiline rows={4} value={story.what_we_built} max={2000} onChange={(v) => update({ what_we_built: v })} />
            <div className="md:col-span-2">
              <ListField label="How it works" values={story.how_it_works} max={8} onChange={(v) => update({ how_it_works: v })} placeholder="One step of the real journey" addLabel="Add step" />
            </div>
          </div>
        </Panel>

        <Panel eyebrow="02 · The harness" title="How Kane checks it" intro="Name only components you actually used.">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Harness summary" multiline value={story.harness.summary} max={600} onChange={(v) => update({ harness: { ...story.harness, summary: v } })} />
            </div>
            <ListField label="Stages" values={story.harness.stages} max={8} itemMax={120} onChange={(v) => update({ harness: { ...story.harness, stages: v } })} placeholder="e.g. Code change" addLabel="Add stage" />
            <ListField label="Components" values={story.harness.components} max={10} itemMax={120} onChange={(v) => update({ harness: { ...story.harness, components: v } })} placeholder="e.g. Kane CLI testrun" addLabel="Add component" />
          </div>
        </Panel>

        <Panel
          id="review"
          eyebrow="03 · Claim / evidence review"
          title="Proof"
          intro={
            <>
              A claim is <strong className="text-verified">✓ VERIFIED</strong> only when it is bound to a source-verified Kane run or verified evidence from this project. A failing run is a suspected detection, not a confirmed bug. Numbers without verified evidence block publishing.
            </>
          }
          aside={
            <div className="flex flex-wrap gap-2">
              <StatusPill tone="verified">{review.proof.filter((p) => p.state === "verified").length} Verified</StatusPill>
              <StatusPill tone="unverified">{review.proof.filter((p) => p.state === "reported" || p.state === "unverified").length} Unverified</StatusPill>
              {review.proof.some((p) => p.blocking) && <StatusPill tone="danger">{review.proof.filter((p) => p.blocking).length} Blocking</StatusPill>}
            </div>
          }
        >
          {sources.runs.length === 0 && sources.evidence.length === 0 && (
            <p className="mb-4 border-l-2 border-hairline pl-3 font-plex text-sm text-lightgray">
              No Kane runs or evidence are recorded for this project yet. Report runs from the Proof tab of your hub; until then claims can only be team-reported or unverified.
            </p>
          )}
          <ol className="space-y-4">
            {story.proof.map((p, i) => {
              const r = review.proof[i];
              const set = (patch: Partial<Story["proof"][number]>) => update({ proof: story.proof.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <li key={i} className="brackets border border-hairline p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-pixel text-[10px] tracking-[0.2em] text-lightgray uppercase">Proof {i + 1}</p>
                    <div className="flex items-center gap-2">
                      <ReviewPill state={r?.state ?? "unverified"} />
                      <IconButton label={`Remove proof ${i + 1}`} onClick={() => update({ proof: story.proof.filter((_, j) => j !== i) })}>
                        ✕
                      </IconButton>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <Field label="Claim" value={p.claim} max={280} onChange={(v) => set({ claim: v })} placeholder="What Kane showed, in one sentence" />
                    </div>
                    <Select label="Confidence" value={p.confidence} options={CONFIDENCES.map((c) => ({ value: c, label: CONF_LABEL[c] }))} onChange={(v) => set({ confidence: v })} />
                    <Field label="Source" value={p.source} max={300} onChange={(v) => set({ source: v })} placeholder="Who observed it, where" />
                    <Select label="Kane run" value={p.run_id ?? ""} options={runOptions} onChange={(v) => set({ run_id: v || null, commit_sha: p.commit_sha ?? sources.runs.find((x) => x.id === v)?.commitSha ?? null })} />
                    <Select label="Evidence artifact" value={p.evidence_id ?? ""} options={evOptions} onChange={(v) => set({ evidence_id: v || null })} />
                    <Field label="Commit SHA" value={p.commit_sha ?? ""} max={64} onChange={(v) => set({ commit_sha: v || null })} placeholder="Optional" />
                  </div>
                  {r && <p className={`mt-3 font-plex text-xs ${r.blocking ? "text-danger" : "text-lightgray"}`}>{r.note}</p>}
                </li>
              );
            })}
          </ol>
          {story.proof.length < 12 && (
            <button
              type="button"
              onClick={() => update({ proof: [...story.proof, { claim: "", confidence: "unverified", source: "", run_id: null, evidence_id: null, commit_sha: null }] })}
              className="mt-4 inline-flex min-h-11 items-center border border-dashed border-hairline px-3 font-plex text-sm text-lightgray hover:border-lime hover:text-lime"
            >
              + Add proof claim
            </button>
          )}
        </Panel>

        <Panel eyebrow="04 · Outcome" title="Impact" intro="A number is shown only with a source and a baseline. Otherwise the claim reads as qualitative.">
          <ol className="space-y-4">
            {story.impact.map((im, i) => {
              const r = review.impact[i];
              const set = (patch: Partial<Story["impact"][number]>) => update({ impact: story.impact.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
              return (
                <li key={i} className="brackets border border-hairline p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-pixel text-[10px] tracking-[0.2em] text-lightgray uppercase">
                      Impact {i + 1} · {r?.measured ? "measured" : "qualitative"}
                    </p>
                    <IconButton label={`Remove impact ${i + 1}`} onClick={() => update({ impact: story.impact.filter((_, j) => j !== i) })}>
                      ✕
                    </IconButton>
                  </div>
                  <div className="mt-3 grid gap-4 md:grid-cols-4">
                    <div className="md:col-span-4">
                      <Field label="Claim" value={im.claim} max={280} onChange={(v) => set({ claim: v })} />
                    </div>
                    <Field label="Measure" type="number" value={im.measure === null ? "" : String(im.measure)} onChange={(v) => set({ measure: num(v) })} />
                    <Field label="Unit" value={im.unit ?? ""} max={40} onChange={(v) => set({ unit: v || null })} placeholder="min, %, runs" />
                    <Field label="Baseline" type="number" value={im.baseline === null ? "" : String(im.baseline)} onChange={(v) => set({ baseline: num(v) })} />
                    <Field label="Source" value={im.source ?? ""} max={300} onChange={(v) => set({ source: v || null })} placeholder="How it was measured" />
                  </div>
                  {r && <p className="mt-3 font-plex text-xs text-lightgray">{r.note}</p>}
                </li>
              );
            })}
          </ol>
          {story.impact.length < 8 && (
            <button
              type="button"
              onClick={() => update({ impact: [...story.impact, { claim: "", measure: null, unit: null, baseline: null, source: null }] })}
              className="mt-4 inline-flex min-h-11 items-center border border-dashed border-hairline px-3 font-plex text-sm text-lightgray hover:border-lime hover:text-lime"
            >
              + Add outcome
            </button>
          )}
          <div className="mt-8">
            <ListField label="Limitations (what isn't verified yet)" values={story.limitations} max={8} onChange={(v) => update({ limitations: v })} addLabel="Add limitation" />
          </div>
        </Panel>

        <Panel eyebrow="05 · Links and media" title="Where to look">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="GitHub repository" value={story.links.github} max={500} placeholder="https://github.com/…" onChange={(v) => update({ links: { ...story.links, github: v } })} />
            <Field label="Live demo" value={story.links.demo} max={500} placeholder="https://…" onChange={(v) => update({ links: { ...story.links, demo: v } })} />
            <Field label="Repo commit" value={story.links.repo_commit} max={200} placeholder="Full SHA or commit URL" onChange={(v) => update({ links: { ...story.links, repo_commit: v } })} />
            <Field label="Ship Page" value={story.links.ship_page || `/ship/${slug}`} disabled onChange={() => {}} hint="Set by the server" />
          </div>
          <div className="mt-8 space-y-4">
            <p className="font-pixel text-[10px] tracking-[0.2em] text-lightgray uppercase">Visuals (real captures only)</p>
            {story.visuals.map((v, i) => {
              const set = (patch: Partial<Story["visuals"][number]>) => update({ visuals: story.visuals.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className="grid gap-4 border border-hairline p-4 md:grid-cols-[10rem_1fr_1fr_auto]">
                  <Field label="Kind" value={v.kind} max={40} onChange={(x) => set({ kind: x })} placeholder="screenshot" />
                  <Field label="Source (https or /path)" value={v.source} max={500} onChange={(x) => set({ source: x })} />
                  <Field label="Alt text" value={v.alt_text ?? ""} max={300} onChange={(x) => set({ alt_text: x })} />
                  <div className="flex items-end gap-2">
                    <Toggle name={`visual-${i}`} label="Approved" checked={v.approved} onChange={(on) => set({ approved: on })} />
                    <IconButton label={`Remove visual ${i + 1}`} onClick={() => update({ visuals: story.visuals.filter((_, j) => j !== i) })}>
                      ✕
                    </IconButton>
                  </div>
                </div>
              );
            })}
            {story.visuals.length < 12 && (
              <button
                type="button"
                onClick={() => update({ visuals: [...story.visuals, { kind: "screenshot", approved: false, source: "", alt_text: "" }] })}
                className="inline-flex min-h-11 items-center border border-dashed border-hairline px-3 font-plex text-sm text-lightgray hover:border-lime hover:text-lime"
              >
                + Add visual
              </button>
            )}
          </div>
        </Panel>

        <Panel eyebrow="06 · Team and consent" title="Who is credited" intro="Each person decides for themselves. Credit needs their own consent on file; an @handle appears only if they agreed to be mentioned.">
          <ul className="divide-y divide-hairline border-y border-hairline">
            {people.map((p) => {
              const on = credited.get(p.name.toLowerCase()) ?? false;
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-plex text-sm text-bright">
                      {p.name}
                      {p.handle && p.mentionConsent && <span className="ml-2 text-lightgray">@{p.handle}</span>}
                    </p>
                    <p className="font-plex text-xs text-lightgray">
                      {p.creditConsent ? "Consent to public credit is on file." : "No consent to public credit on file. They can opt in from their own account."}
                    </p>
                  </div>
                  <Toggle
                    name={`credit-${p.id}`}
                    label="Credit publicly"
                    checked={on && p.creditConsent}
                    disabled={!p.creditConsent}
                    onChange={(v) =>
                      update({
                        team: people.map((x) => ({
                          display_name: x.name,
                          handle: x.mentionConsent ? x.handle : null,
                          publicly_credited: x.id === p.id ? v : (credited.get(x.name.toLowerCase()) ?? false),
                        })),
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
          <div className="mt-6">
            <Toggle
              name="consent_reviewed"
              label="We reviewed consent for everyone credited and pictured"
              description="Required to publish. Anyone pictured in a visual must have agreed to it separately."
              checked={story.consent_reviewed}
              onChange={(v) => update({ consent_reviewed: v })}
            />
          </div>
        </Panel>
      </fieldset>

      {versions.length > 0 && (
        <Panel eyebrow="History" title="Versions" intro="Versions are immutable. Loading one copies it into the editor; saving makes a new version.">
          <ul className="divide-y divide-hairline border-y border-hairline">
            {versions.map((v) => (
              <li key={v.version} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="font-plex text-sm text-bright">
                  v{v.version} <span className="text-lightgray">· {new Date(v.createdAt).toLocaleString()} · {v.createdBy ?? "unknown"}</span>
                  {v.reviewedAt && <span className="ml-2 font-pixel text-[10px] tracking-[0.2em] text-lightgray uppercase">Published</span>}
                </span>
                {canWrite && (
                  <button type="button" onClick={() => load(v)} className="inline-flex min-h-11 items-center px-3 font-plex text-sm text-lightgray underline-offset-4 hover:text-lime hover:underline">
                    Load into editor
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {canWrite && (
        <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-ink/95 backdrop-blur">
          <div className="container-page flex flex-wrap items-center gap-3 py-3">
            <p className="font-plex text-xs text-lightgray">
              {version ? `Version ${version}` : "Not saved yet"}
              {dirty && <span className="ml-2 text-warning">· unsaved changes</span>}
              {review.saveErrors.length > 0 && <span className="ml-2 text-danger">· {review.saveErrors.length} to fix before saving</span>}
            </p>
            <div className="min-w-0 flex-1">{result && <ResultLine ok={result.ok} message={result.message} receipt={result.receipt} />}</div>
            <button
              type="button"
              onClick={save}
              disabled={pending || review.saveErrors.length > 0}
              className="inline-flex min-h-11 items-center bg-bright px-5 font-plex text-sm text-ink transition-colors hover:bg-lime disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save new version"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewPill({ state }: { state: string }) {
  if (state === "verified") return <StatusPill tone="verified">Verified</StatusPill>;
  if (state === "blocked") return <StatusPill tone="danger">Blocked</StatusPill>;
  if (state === "reported") return <StatusPill tone="unverified">Team-reported</StatusPill>;
  return <StatusPill tone="unverified" />;
}
