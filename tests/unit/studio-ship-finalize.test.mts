// Ship Studio → Ship Page → finalize, found in the GTM end-to-end run on 2026-10-24 (no database):
//   - a Studio screenshot given as an https link loads as that link; only private uploads go
//     through /ship/{slug}/media, which serves nothing else
//   - finalize keeps the story the team approved in the Studio and only adds the submission's
//     screenshots and video, and links it left empty
//   - the Studio's "Repo commit" takes the full SHA its placeholder asks for
//   - a save error names the field, instead of only "Some fields need another look."
// `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankStory, storySchema } from "../../src/components/ship-templates/model.ts";
import { keepStudioStory, visualSrc, type ProjectStory } from "../../src/server/showcase.ts";
import { issueText } from "../../src/lib/issue-text.ts";

const SHA = "dcc7ea4ac3ceddc179a8c2eadbce13bf0602da14";

test("a Studio visual loads from its https link or site path; only private uploads use the media route", () => {
  assert.equal(visualSrc("kestrel", 7, "https://kh-evidence.s3.amazonaws.com/public/p7/a.png"), "https://kh-evidence.s3.amazonaws.com/public/p7/a.png");
  assert.equal(visualSrc("kestrel", 7, "/logos/kane.png"), "/logos/kane.png");
  assert.equal(visualSrc("kestrel", 7, "showcase/p7/shot-abc.png"), "/ship/kestrel/media/showcase/p7/shot-abc.png");
  // Never shown: not https, protocol-relative, script, and another project's upload path.
  for (const bad of ["http://127.0.0.1:9102/kh-evidence/a.png", "//evil.example/a.png", "javascript:alert(1)", "showcase/p8/shot.png"]) {
    assert.equal(visualSrc("kestrel", 7, bad), null, bad);
  }
});

function studioStory(): ProjectStory {
  const s = blankStory({ id: 7, slug: "kestrel", name: "Kestrel" }) as unknown as ProjectStory;
  return {
    ...s,
    project_name: "Kestrel",
    one_line_pitch: "A team task board the coding agent verifies with Kane before every change ships.",
    harness: { summary: "Kane replays the add-task flow.", components: ["kane-cli run"], stages: ["Codex change → Kane run → merge or block"] },
    proof: [{ claim: "Kane caught Buy milk disappearing after a reload.", confidence: "verified", source: "", run_id: "28", evidence_id: null, commit_sha: SHA }],
    links: { github: "https://github.com/example/kestrel", demo: "", repo_commit: "", ship_page: "/ship/kestrel" },
    visuals: [{ kind: "screenshot", approved: true, source: "https://kh-evidence.s3.amazonaws.com/public/p7/board.png", alt_text: "Board" }],
    team: [{ display_name: "Pat Q.", handle: null, publicly_credited: true }],
    consent_reviewed: true,
    status: "published",
  };
}

function submissionStory(): ProjectStory {
  return {
    ...studioStory(),
    project_name: "Demo Kestrel",
    one_line_pitch: "Kestrel: a task tracker verified by Kane.",
    harness: { summary: "QA harness", components: ["run", "sealed_evidence"], stages: [] },
    proof: [{ claim: "Kane run passed: add Buy milk", confidence: "verified", source: "kane_run:kanehack_cli", run_id: "28", evidence_id: null, commit_sha: SHA }],
    links: { github: "https://github.com/example/kestrel-fork", demo: "https://kestrel.example", repo_commit: `https://github.com/example/kestrel-fork/commit/${SHA}`, ship_page: "/ship/kestrel" },
    visuals: [
      { kind: "screenshot", approved: true, source: "showcase/p7/upload.png", alt_text: "Upload" },
      { kind: "screenshot", approved: true, source: "https://kh-evidence.s3.amazonaws.com/public/p7/board.png", alt_text: "Same board" },
      { kind: "video", approved: true, source: "https://kh-evidence.s3.amazonaws.com/public/p7/showcase.mp4", alt_text: "Demo video" },
    ],
    team: [
      { display_name: "Pat Q.", handle: null, publicly_credited: true },
      { display_name: "Kit Lowe", handle: null, publicly_credited: true },
    ],
  };
}

test("finalize keeps the Studio story's text and proof, and adds only the submission's new media and empty links", () => {
  const studio = studioStory();
  const out = keepStudioStory(studio, submissionStory());
  assert.equal(out.project_name, "Kestrel");
  assert.equal(out.one_line_pitch, studio.one_line_pitch);
  assert.deepEqual(out.harness, studio.harness);
  assert.deepEqual(out.proof, studio.proof);
  // The Studio's GitHub link stands; the demo and commit it left empty come from the submission.
  assert.equal(out.links.github, "https://github.com/example/kestrel");
  assert.equal(out.links.demo, "https://kestrel.example");
  assert.equal(out.links.repo_commit, `https://github.com/example/kestrel-fork/commit/${SHA}`);
  assert.deepEqual(
    out.visuals.map((v) => v.source),
    ["https://kh-evidence.s3.amazonaws.com/public/p7/board.png", "showcase/p7/upload.png", "https://kh-evidence.s3.amazonaws.com/public/p7/showcase.mp4"],
  );
  // Credits follow the consent check finalize just ran, as before.
  assert.deepEqual(out.team.map((t) => t.display_name), ["Pat Q.", "Kit Lowe"]);
  assert.equal(out.status, "published");
});

test("finalize never puts more than 12 visuals in the story", () => {
  const studio = studioStory();
  studio.visuals = Array.from({ length: 12 }, (_, i) => ({ kind: "screenshot", approved: true, source: `https://cdn.example/${i}.png`, alt_text: "" }));
  assert.equal(keepStudioStory(studio, submissionStory()).visuals.length, 12);
});

const parseLinks = (links: Record<string, string>) => storySchema.safeParse({ ...blankStory({ id: 7, slug: "kestrel", name: "Kestrel" }), links: { ...blankStory({ id: 7, slug: "kestrel", name: "Kestrel" }).links, ...links } });

test("Repo commit takes the full SHA and turns it into the commit link on the GitHub repository", () => {
  const r = parseLinks({ github: "https://github.com/example/kestrel", repo_commit: SHA.toUpperCase() });
  assert.ok(r.success, JSON.stringify(!r.success && r.error.issues));
  assert.equal(r.data.links.repo_commit, `https://github.com/example/kestrel/commit/${SHA}`);
  const url = parseLinks({ repo_commit: `https://gitlab.example/kestrel/-/commit/${SHA}` });
  assert.ok(url.success);
  assert.equal(url.data.links.repo_commit, `https://gitlab.example/kestrel/-/commit/${SHA}`);
});

test("a SHA without a GitHub repository, or a short SHA, is refused on the Repo commit field with what to do", () => {
  for (const [links, says] of [
    [{ repo_commit: SHA }, /GitHub repository/],
    [{ github: "https://gitlab.example/kestrel", repo_commit: SHA }, /GitHub repository/],
    [{ github: "https://github.com/example/kestrel", repo_commit: "dcc7ea4" }, /full commit URL|40-character/],
  ] as const) {
    const r = parseLinks(links);
    assert.equal(r.success, false, JSON.stringify(links));
    const issue = !r.success && r.error.issues.find((i) => i.path.join(".") === "links.repo_commit");
    assert.ok(issue, JSON.stringify(!r.success && r.error.issues));
    assert.match(issue.message, says);
  }
});

test("a save error shows each issue with its field; a message already shown isn't repeated", () => {
  // A schema failure: the message is generic, and the only issue says what is wrong.
  assert.equal(
    issueText({ message: "Some fields need another look.", details: { issues: [{ path: "links.repo_commit", message: "Must be an https:// link" }] } }),
    "Some fields need another look. links repo commit: Must be an https:// link",
  );
  // A review failure: the message is the first issue, which already names its proof claim.
  assert.equal(
    issueText({ message: "Proof 1: needs a run.", details: { issues: [{ path: "proof", message: "Proof 1: needs a run." }, { path: "proof", message: "Proof 2: needs a source." }] } }),
    "Proof 1: needs a run. Proof 2: needs a source.",
  );
  assert.equal(issueText({ message: "Visual 1: bad.", details: { issues: [{ path: "visuals.0.source", message: "Required" }] } }), "Visual 1: bad. visuals 1 source: Required");
  assert.equal(issueText({ message: "Try again." }), "Try again.");
});
