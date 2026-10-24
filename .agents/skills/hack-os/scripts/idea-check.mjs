#!/usr/bin/env node
// Checks the idea validator's JSON (references/idea-validator.md), recomputes the verdict from
// the scores (the model's own verdict is never trusted), and keeps the full result private in
// ~/.kanehack/os/idea-check.json (or the temp folder when Codex's sandbox blocks that). Prints only
// what the team may see, plus the verdict for routing, even when nothing could be saved.
//
//   node idea-check.mjs --file <validator-output.json>
//
// JSON on stdout; exit 0, or 2 when the file isn't valid validator output (nothing is saved).
import { readFileSync } from "node:fs";
import { writeNote } from "./os-dir.mjs";

const IDS = ["clear_idea", "eligible", "shippable_today", "openai_in_build", "kane_flows_named", "kane_feasible", "agent_kane_loop", "unique_kane_usage", "unique_in_market"];
const CORE = ["clear_idea", "eligible", "openai_in_build", "kane_flows_named", "kane_feasible"];
const SECTIONS = ["idea", "uniqueness", "kane", "final"];

const refuse = (msg) => {
  process.stderr.write(JSON.stringify({ error: `not valid validator output: ${msg}` }) + "\n");
  process.exit(2);
};

function parse(text) {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    refuse("not JSON");
  }
  if (!r || !Array.isArray(r.criteria) || r.criteria.length !== IDS.length) refuse(`needs exactly ${IDS.length} criteria`);
  r.criteria.forEach((c, i) => {
    if (c?.id !== IDS[i]) refuse(`criterion ${i + 1} must be ${IDS[i]}`);
    const nullable = c.id === "unique_in_market";
    if (!(Number.isInteger(c.score) && c.score >= 0 && c.score <= 3) && !(nullable && c.score === null))
      refuse(`${c.id} score must be 0-3${nullable ? " or null" : ""}`);
  });
  for (const s of SECTIONS) if (typeof r.comment?.[s] !== "string" || !r.comment[s].trim()) refuse(`comment.${s} is missing`);
  return r;
}

// The prompt's VERDICT rules. unique_in_market counts once scored: 0 (a shipped product already
// does it) means rethink, 1 (crowded, easy to copy) needs_work; null (not checked) never counts.
function verdict(criteria) {
  const score = Object.fromEntries(criteria.map((c) => [c.id, c.score]));
  if (CORE.some((id) => score[id] === 0) || score.shippable_today === 0 || score.unique_in_market === 0) return "rethink";
  const other = IDS.filter((id) => id !== "unique_in_market" && !CORE.includes(id));
  if (CORE.some((id) => score[id] === 1) || other.some((id) => score[id] === 0) || score.unique_in_market === 1) return "needs_work";
  return "ready";
}

const args = process.argv.slice(2);
const i = args.indexOf("--file");
if (i < 0 || !args[i + 1]) {
  process.stderr.write(JSON.stringify({ error: "usage: idea-check.mjs --file <validator-output.json>" }) + "\n");
  process.exit(2);
}
let text;
try {
  text = readFileSync(args[i + 1], "utf8");
} catch {
  refuse(`can't read ${args[i + 1]}`);
}
const r = parse(text);
const saved = { ...r, verdict: verdict(r.criteria), checked_at: new Date().toISOString() };

writeNote("idea-check.json", saved);
process.stdout.write(JSON.stringify({ verdict: saved.verdict, comment: Object.fromEntries(SECTIONS.map((s) => [s, r.comment[s]])) }) + "\n");
