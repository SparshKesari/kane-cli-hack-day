// scripts/idea-check.mjs: recomputes the idea validator's verdict from its scores, keeps the
// full result private and hands back only what the team may see.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../plugin/skills/hack-os/scripts/idea-check.mjs", import.meta.url));
const IDS = ["clear_idea", "eligible", "shippable_today", "openai_in_build", "kane_flows_named", "kane_feasible", "agent_kane_loop", "unique_kane_usage", "unique_in_market"];
const COMMENT = { idea: "STRONG. For QA leads.", uniqueness: "DISTINCT. Nothing close.", kane: "SOLID. Add replay.", final: "Build it as is. Start with the login flow." };

type Scores = Partial<Record<(typeof IDS)[number], number | null>>;
/** A validator result with every criterion at 2 unless overridden, and the model's own (ignored) verdict. */
function result(scores: Scores = {}, extra: Record<string, unknown> = {}) {
  return {
    verdict: "rethink",
    headline: "h",
    criteria: IDS.map((id) => ({ id, score: id in scores ? scores[id] : 2, note: "n" })),
    comment: COMMENT,
    ...extra,
  };
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "hackos-idea-"));
  return { dir, state: join(dir, "os", "state.json"), saved: join(dir, "os", "idea-check.json") };
}

function check(sb: { dir: string; state: string }, body: unknown): Promise<{ code: number | null; out: string; stderr: string }> {
  const file = join(sb.dir, "validator.json");
  writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
  return new Promise((done) => {
    const p = spawn(process.execPath, [SCRIPT, "--file", file], { env: { ...process.env, KANEHACK_OS_STATE: sb.state, KANEHACK_OS_FALLBACK: join(sb.dir, "fallback") } });
    let out = "", err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("close", (code) => done({ code, out, stderr: err }));
  });
}

const verdictOf = async (scores: Scores) => {
  const r = await check(sandbox(), result(scores));
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.out).verdict;
};

test("a plan with every core criterion at 2 or more is ready, whatever the model said", async () => {
  assert.equal(await verdictOf({ unique_in_market: null }), "ready");
});

test("a core criterion at 1 makes it needs_work", async () => {
  assert.equal(await verdictOf({ kane_flows_named: 1 }), "needs_work");
});

test("no agent and Kane loop, or no unique Kane usage, makes it needs_work", async () => {
  assert.equal(await verdictOf({ agent_kane_loop: 0 }), "needs_work");
  assert.equal(await verdictOf({ unique_kane_usage: 0 }), "needs_work");
});

test("a core criterion at 0, or nothing shippable today, means rethink", async () => {
  assert.equal(await verdictOf({ openai_in_build: 0 }), "rethink");
  assert.equal(await verdictOf({ shippable_today: 0 }), "rethink");
  assert.equal(await verdictOf({ clear_idea: 0, kane_flows_named: 1 }), "rethink");
});

test("an idea a shipped product already does means rethink, even with a strong plan", async () => {
  // The scores a plain todo app got on 2026-10-24: everything else 2 or 3.
  const todo = { clear_idea: 2, eligible: 2, shippable_today: 3, openai_in_build: 3, kane_flows_named: 3, kane_feasible: 3, agent_kane_loop: 2, unique_kane_usage: 2, unique_in_market: 0 };
  assert.equal(await verdictOf(todo), "rethink");
  assert.equal(await verdictOf({ unique_in_market: 0 }), "rethink");
});

test("a crowded idea whose difference is easy to copy is needs_work", async () => {
  assert.equal(await verdictOf({ unique_in_market: 1 }), "needs_work");
});

test("market uniqueness that wasn't checked, or a clear wedge, doesn't hold an idea back", async () => {
  assert.equal(await verdictOf({ unique_in_market: null }), "ready");
  assert.equal(await verdictOf({ unique_in_market: 2 }), "ready");
  assert.equal(await verdictOf({ unique_in_market: 3 }), "ready");
});

test("malformed validator output is refused and nothing is saved", async () => {
  const bad: unknown[] = [
    "not json",
    { ...result(), criteria: result().criteria.slice(0, 8) },
    { ...result(), criteria: [...result().criteria].reverse() },
    result({ eligible: 4 }),
    result({ eligible: 1.5 }),
    result({ kane_feasible: null }),
    result({}, { comment: { ...COMMENT, final: undefined } }),
  ];
  for (const body of bad) {
    const sb = sandbox();
    const r = await check(sb, body);
    assert.equal(r.code, 2, `accepted ${JSON.stringify(body).slice(0, 80)}`);
    assert.match(r.stderr, /validator output/);
    assert.equal(existsSync(sb.saved), false);
  }
});

test("keeps the full result private and prints only the verdict and the comment", async () => {
  const sb = sandbox();
  const r = await check(sb, result({ unique_kane_usage: 3 }));
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.out);
  assert.deepEqual(Object.keys(out).sort(), ["comment", "verdict"]);
  assert.deepEqual(out.comment, COMMENT);
  const saved = JSON.parse(readFileSync(sb.saved, "utf8"));
  assert.equal(saved.verdict, "ready");
  assert.equal(saved.criteria[7].score, 3);
  assert.ok(saved.checked_at);
  assert.equal(statSync(sb.saved).mode & 0o777, 0o600);
});

// Codex's default sandbox can't write outside the project: ~/.kanehack/os fails with EPERM. The
// check crashed there with a stack trace and printed nothing, so the person never saw the feedback.
test("a home folder it can't write to still shows the feedback, and keeps the result in the temp fallback", async () => {
  const sb = sandbox();
  const locked = join(sb.dir, "locked");
  mkdirSync(locked);
  chmodSync(locked, 0o500);
  const fallback = join(sb.dir, "tmp-fallback");
  const file = join(sb.dir, "validator.json");
  writeFileSync(file, JSON.stringify(result()));
  const r = await new Promise<{ code: number | null; out: string; stderr: string }>((done) => {
    const p = spawn(process.execPath, [SCRIPT, "--file", file], { env: { ...process.env, KANEHACK_OS_STATE: join(locked, "os", "state.json"), KANEHACK_OS_FALLBACK: fallback } });
    let out = "", err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("close", (code) => done({ code, out, stderr: err }));
  });
  chmodSync(locked, 0o700);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.out).comment, COMMENT);
  assert.equal(JSON.parse(readFileSync(join(fallback, "idea-check.json"), "utf8")).verdict, "ready");
});
