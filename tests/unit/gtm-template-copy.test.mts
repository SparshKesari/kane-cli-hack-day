// The GTM kit's fallback launch copy (templateKit), used whenever the AI draft is unavailable.
// On event day (2026-10-24) it read "re-checks the call flows.. Our hackathon project" and
// "We built Atlas to voice agent flows re-verified by Kane…": the template added a period after
// text that already ended in one, and put "to" in front of a phrase that isn't a verb.
import { test } from "node:test";
import assert from "node:assert/strict";
import { templateKit } from "../../src/server/gtm.ts";
import type { PublicStory } from "../../src/components/ship-templates/model.ts";

function story(over: Partial<PublicStory> = {}): PublicStory {
  return {
    slug: "atlas",
    name: "Atlas",
    pitch: "Voice agent flows re-verified by Kane on every deploy.",
    creationType: "agent",
    problem: "Voice agents regress silently between deploys; nobody re-checks the call flows.",
    whatWeBuilt: "Voice agent with Kane-verified flows.",
    howItWorks: [],
    harness: { summary: "Kane replays every call flow on each deploy.", components: [], stages: [] },
    proof: [],
    impact: [],
    limitations: ["Only English calls are covered."],
    links: { github: "https://github.com/example/atlas", demo: null, repoCommit: null, shipPage: "https://kaneclihack.sh/ship/atlas" },
    team: [],
    visuals: [],
    badges: { shipped: false, kaneVerified: false },
    version: 1,
    publishedAt: null,
    hasDeck: true,
    preview: false,
    ...over,
  } as PublicStory;
}

const allText = (k: ReturnType<typeof templateKit>) => [k.x_post, ...k.thread, k.readme, k.alt_text, k.og_title, k.og_description, k.pitch];

test("no doubled periods when the team's text already ends a sentence", () => {
  const k = templateKit(story(), true);
  for (const t of allText(k)) assert.doesNotMatch(t, /[^.]\.\.(?!\.)|\.\s*\.(?=\s|$)|…\./, t);
  assert.equal(k.thread[0], "The problem: Voice agents regress silently between deploys; nobody re-checks the call flows. Our hackathon project Atlas attacks that gap.");
  assert.equal(k.thread[1], "What we created: Voice agent with Kane-verified flows. Short demo: https://kaneclihack.sh/ship/atlas");
  assert.match(k.thread[3], /Still open: Only English calls are covered\. Source:/);
});

test("text without a closing period still gets exactly one", () => {
  const k = templateKit(story({ problem: "Nobody re-checks the call flows", whatWeBuilt: "Voice agent with Kane-verified flows", limitations: ["English only"] }), true);
  assert.match(k.thread[0], /re-checks the call flows\. Our hackathon project/);
  assert.match(k.thread[1], /Kane-verified flows\. Short demo/);
  assert.match(k.thread[3], /Still open: English only\. Source:/);
});

test("the elevator pitch and OG description read as sentences", () => {
  const k = templateKit(story(), true);
  assert.equal(k.pitch, "We built Atlas: voice agent flows re-verified by Kane on every deploy. What makes it different: Kane replays every call flow on each deploy.");
  assert.equal(k.og_description, "Atlas: voice agent flows re-verified by Kane on every deploy. Explore the creation, Kane-powered validation workflow and evidence.");
  const bare = templateKit(story({ pitch: "Voice agent flows re-verified by Kane on every deploy" }), true);
  assert.match(bare.og_description, /every deploy\. Explore/);
});

test("names keep their capital letters mid-sentence", () => {
  const h = templateKit(story({ creationType: "validation_harness" }), true);
  assert.match(h.x_post, /Atlas uses Kane CLI: Kane replays every call flow on each deploy\. Demo, evidence and code:/);
  assert.doesNotMatch(allText(h).join("\n"), /\bkane\b/);
  assert.match(templateKit(story({ pitch: "AI agent that books meetings." }), true).x_post, /We built Atlas: AI agent that books meetings\./);
  assert.match(templateKit(story({ pitch: "Kane-checked voice agents." }), true).x_post, /We built Atlas: Kane-checked voice agents\./);
  assert.match(templateKit(story({ creationType: "validation_harness", harness: { summary: "", components: [], stages: [] } }), true).x_post, /Atlas uses Kane CLI to verify every change\./);
});

test("a verified claim and a visual's alt text don't double their punctuation", () => {
  const k = templateKit(
    story({
      proof: [{ claim: "Caught a broken transfer flow.", confidence: "verified", source: "kane", run_id: "KR-7", evidence_id: null, commit_sha: null, run: { status: "passed", finished_at: null, objective: null } }],
      visuals: [{ kind: "screenshot", src: "/ship/atlas/media/x.png", alt: "The call log after a run." }],
    }),
    true,
  );
  assert.match(k.x_post, /validation loop that caught a broken transfer flow\.\n/);
  assert.match(k.thread[3], /What we proved: Caught a broken transfer flow \(Kane run KR-7\)\./);
  assert.equal(k.alt_text, "Image of The call log after a run for Atlas.");
});
