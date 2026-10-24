import type { Metadata } from "next";
import { Panel } from "./fields";
import PublishPanel from "./PublishPanel";
import Studio, { type StudioCtx } from "./shell";
import StoryEditor from "./StoryEditor";
import {
  consentCheck,
  getLatestPublished,
  getProofSources,
  getStory,
  getTeamPeople,
  listStoryVersions,
  reviewStory,
  seedStory,
} from "@/server/story";

export const metadata: Metadata = { title: "Ship studio", robots: { index: false } };

// /studio/[slug]: the story editor, its live claim review and the publish
// approval. Team-only (see shell.tsx).

export default function StudioStoryPage({ params }: PageProps<"/studio/[slug]">) {
  return (
    <Studio params={params} tab="">
      {(ctx) => <StoryTab ctx={ctx} />}
    </Studio>
  );
}

async function StoryTab({ ctx }: { ctx: StudioCtx }) {
  const { project } = ctx;
  const [people, sources, latest, versions, published] = await Promise.all([
    getTeamPeople(project.team_id),
    getProofSources(project.id),
    getStory(project.id),
    listStoryVersions(project.id),
    getLatestPublished(project.id, "ship_page"),
  ]);
  const story = latest?.content ?? (await seedStory(project, people));
  const review = reviewStory(story, sources);
  const consent = consentCheck(story, people);

  return (
    <>
      <StoryEditor
        slug={ctx.slug}
        initial={story}
        initialVersion={latest?.version ?? 0}
        people={people}
        sources={sources}
        versions={versions.slice(0, 12).map((v) => ({ version: v.version, createdAt: v.createdAt, createdBy: v.createdBy, reviewedAt: v.reviewedAt, content: v.content }))}
        canWrite={ctx.canWrite}
      />
      <div className="container-page pb-40">
        <Panel
          id="publish"
          eyebrow="07 · Publish"
          title="Approve the public Ship Page"
          intro={
            <>
              Publishing makes the <strong className="text-bright">last saved version</strong> public at /ship/{ctx.slug} and records who approved it and who consented. It doesn&apos;t change your official submission, and finalizing keeps this story as your page, adding only the submission&apos;s screenshots and video. Save first if you have unsaved edits.
            </>
          }
        >
          {ctx.canWrite ? (
            <PublishPanel
              slug={ctx.slug}
              version={latest?.version ?? 0}
              blockers={review.publishBlockers}
              consentMissing={consent.missing}
              credited={consent.credited.map((c) => c.name)}
              publishedVersion={published?.version ?? null}
            />
          ) : (
            <p className="font-plex text-sm text-lightgray">Read-only: only team members can publish.</p>
          )}
          {review.warnings.length > 0 && (
            <ul className="mt-6 space-y-1 font-plex text-xs text-lightgray">
              {review.warnings.map((w, i) => (
                <li key={i}>! {w}</li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
