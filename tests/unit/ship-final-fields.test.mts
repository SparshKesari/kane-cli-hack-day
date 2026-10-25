// The Ship Page from the final submission form (since 2026-10-24 16:40 PT): a team that
// submits without the Ship Studio still gets its description on the page, and every link the
// form asks for (showcase page, deck, LinkedIn, X, blog, Hacker News) under "Also submitted".
// No database. `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { storySchema } from "../../src/components/ship-templates/model.ts";
import { buildStory, submissionExtras, withSubmittedDescription } from "../../src/server/showcase.ts";
import { EMPTY_DRAFT } from "../../src/server/submission.ts";

const story = (draft: Partial<typeof EMPTY_DRAFT>) =>
  buildStory({ projectId: 7, slug: "kestrel", draft: { ...EMPTY_DRAFT, project_name: "Kestrel", ...draft }, runs: [], credited: [], status: "published" });

test("the final form's project description is the page's 'what we built'", () => {
  assert.equal(story({ project_description: "A harness that checks checkout flows." }).what_we_built, "A harness that checks checkout flows.");
  // An older draft keeps its own text.
  assert.equal(story({ what_we_built: "Older text", project_description: null }).what_we_built, "Older text");
});

test("a description longer than the story allows is cut at a word, and the story still validates", () => {
  const long = "word ".repeat(700).trim(); // 3,499 characters
  const s = story({ project_description: long });
  assert.ok(s.what_we_built.length <= 2000, String(s.what_we_built.length));
  assert.match(s.what_we_built, /word…$/);
  const r = storySchema.safeParse(s);
  assert.ok(r.success, JSON.stringify(r.success ? null : r.error.issues.slice(0, 2)));
});

test("the final form's links are all listed under 'Also submitted', once each", () => {
  const x = submissionExtras({
    ...EMPTY_DRAFT,
    showcase_url: "https://kestrel.dev",
    deck_url: "https://docs.google.com/presentation/d/abc",
    linkedin_posts: ["https://www.linkedin.com/posts/a"],
    x_posts: ["https://x.com/a/status/1", "https://x.com/a/status/1"],
    blog_links: ["https://dev.to/a/kestrel"],
    hn_url: "https://news.ycombinator.com/item?id=1",
  });
  assert.ok(x);
  assert.equal(x.showcase_url, "https://kestrel.dev");
  assert.equal(x.deck_url, "https://docs.google.com/presentation/d/abc");
  assert.deepEqual(x.blog_links, ["https://dev.to/a/kestrel"]);
  assert.deepEqual(x.social_links, ["https://www.linkedin.com/posts/a", "https://x.com/a/status/1", "https://news.ycombinator.com/item?id=1"]);
  // A draft with none of them has no "Also submitted" block.
  assert.equal(submissionExtras(EMPTY_DRAFT), null);
});

test("a page published before this fix shows the finalized submission's description; nothing else changes", () => {
  const frozen = story({}); // finalized from the new form before its description reached the story
  assert.equal(frozen.what_we_built, "");
  const draft = { ...EMPTY_DRAFT, project_description: "What the team wrote." };
  assert.equal(withSubmittedDescription(frozen, draft, new Date()).what_we_built, "What the team wrote.");
  // Not finalized (or withdrawn): the draft never reaches a public page.
  assert.equal(withSubmittedDescription(frozen, draft, null).what_we_built, "");
  // A story with its own text keeps it.
  const own = story({ what_we_built: "Studio text" });
  assert.equal(withSubmittedDescription(own, draft, new Date()), own);
});
