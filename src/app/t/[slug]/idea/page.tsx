import type { Metadata } from "next";
import DegradedServiceAlert from "@/components/ui/DegradedServiceAlert";
import StatusPill from "@/components/ui/StatusPill";
import { formatEventTime, getEvent } from "@/lib/event";
import { isEnabled } from "@/lib/flags";
import { getIdea, latestAssessment, isSubmitted, listRevisions } from "@/server/ideas";
import { Panel } from "@/app/team/blocks";
import Hub, { type HubContext } from "../hub";
import IdeaChecklist, { AdvisoryBanner, AssessmentPill } from "./checklist";
import { IdeaForm, SubmitIdeaForm, ValidateForm } from "./parts";

export const metadata: Metadata = { title: "Idea" };

// Idea lab: the private idea with revisions and the advisory validator. Once
// the saved idea is validated the team can lock and submit it (then: go hack);
// otherwise it freezes at the idea lock.

export default function IdeaTab({ params }: PageProps<"/t/[slug]/idea">) {
  return (
    <Hub params={params} tab="idea">
      {(ctx) => <IdeaLab {...ctx} />}
    </Hub>
  );
}

async function IdeaLab({ team, me }: HubContext) {
  const [idea, event, on] = await Promise.all([getIdea(team.id), getEvent(), isEnabled("idea")]);
  if (!idea) return null;
  const [latest, revisions] = await Promise.all([latestAssessment(idea.id), listRevisions(idea.id)]);
  // Validation itself adds a revision, so any later revision is an edit the check hasn't seen.
  const stale = !!latest && latest.revision < idea.revision;
  const submitted = isSubmitted(idea);
  // Submitted ideas are read-only in the site (Codex can still save: ideas never lock).
  const canEdit = !!me && !idea.locked && !submitted;
  const slug = team.slug;
  // Saved, and the validator has seen this version.
  const canSubmit = canEdit && idea.revision > 0 && !!latest && !stale;

  return (
    <section className="py-10 sm:py-14">
      <div className="container-page space-y-10">
        {submitted && (
          <div className="brackets border border-lime bg-lime-deep p-6 sm:p-8">
            <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">Idea submitted</p>
            <p className="mt-3 font-dots text-4xl leading-none font-black text-bright sm:text-5xl">Go hack.</p>
            <p className="mt-4 max-w-xl font-plex text-sm leading-relaxed text-lightgray">
              “{idea.title}” is your team&apos;s idea. Build it with Codex and run Kane CLI as you go: a failed run that finds a bug, then the green rerun, is the proof judges look for.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-4">
          {idea.locked && <StatusPill tone="pending">Frozen{idea.frozen_at ? ` at ${formatEventTime(idea.frozen_at, event)}` : ""}</StatusPill>}
        </div>

        {!on && (
          <DegradedServiceAlert state="degraded" system="Idea lab">
            The validator here is switched off. You can still save your idea, and check it with $hack-os in Codex.
          </DegradedServiceAlert>
        )}

        <div className="grid gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]">
          <div className="space-y-8" id="idea-form">
            <Panel title="Your idea" aside={<span className="font-plex text-xs text-lightgray">Revision {idea.revision || "—"}</span>}>
              <IdeaForm
                slug={slug}
                disabled={!canEdit}
                defaults={{
                  // A new idea row starts with the team name as its title; don't show that as an answer.
                  title: idea.revision === 0 && idea.title.trim() === team.name.trim() ? "" : idea.title,
                  app_type: idea.app_type,
                  private_description: idea.private_description,
                  kane_plan: idea.kane_plan,
                  extra_info: idea.extra_info,
                  public_summary: idea.public_summary ?? "",
                  discovery_opt_in: idea.discovery_opt_in,
                  project_type: idea.project_type,
                }}
              />
              {!me && <p className="mt-3 font-plex text-xs text-lightgray">Viewing as organizer: read-only.</p>}
            </Panel>

            {revisions.length > 0 && (
              <Panel title="Revisions">
                <ol className="border-t border-dashed border-hairline">
                  {revisions.map((r) => (
                    <li key={r.revision} className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-hairline py-2 font-plex text-xs text-lightgray">
                      <span>
                        <span className="text-bright">r{r.revision}</span> · {r.title} · {r.actor ?? "—"}
                      </span>
                      <span className="flex items-center gap-2">
                        {r.verdict && <span>checked ({r.generator === "llm" ? "AI" : "rules"})</span>}
                        {formatEventTime(r.created_at, event)}
                      </span>
                    </li>
                  ))}
                </ol>
              </Panel>
            )}
          </div>

          <div className="space-y-8">
            <Panel title="Idea Validator" aside={<AssessmentPill verdict={idea.qualification} assessment={latest?.assessment ?? null} />}>
              {latest ? (
                <IdeaChecklist assessment={latest.assessment} stale={stale} />
              ) : (
                <div className="space-y-3">
                  <AdvisoryBanner />
                  <p className="font-plex text-sm text-lightgray">Feedback on your idea, its uniqueness and your Kane CLI plan, from the same validator $hack-os uses in Codex. Save your idea, then validate here.</p>
                </div>
              )}
              {canEdit && on && (
                <div className="mt-6 border-t border-dashed border-hairline pt-6">
                  <ValidateForm slug={slug} disabled={false} />
                </div>
              )}
            </Panel>

            {canSubmit && (
              <Panel title="Lock and submit">
                <p className="mb-4 font-plex text-sm leading-relaxed text-lightgray">
                  Happy with it? Submit it as your team&apos;s idea and start building. You can keep editing and re-validating until you submit.
                </p>
                <SubmitIdeaForm slug={slug} />
              </Panel>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
