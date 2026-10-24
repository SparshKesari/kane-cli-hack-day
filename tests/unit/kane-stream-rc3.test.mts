// Kane CLI 0.10.0-rc.3 emits a per-run `coverage` event before `run_end` (H-0007). Both parsers took
// the first `coverage` for a cover/gaps stream ("assurance"), ignored `run_end`, found no completion
// event and recorded every passing run as errored. A run opens with `run_start`; cover never emits it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideStatus, parseKaneStream } from "../../src/server/kane-ndjson.ts";
import { scan } from "../../packages/kanehack/lib/stream.mjs";

const lines = (...evs: object[]) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";

// The order rc.3's `kane-cli run … --agent` writes (dist: run_start, steps, the run's coverage, run_end).
const rc3Run = lines(
  { type: "run_start", mode: "agent", trace: "/tmp/kane/trace" },
  { type: "step", n: 1, action: "navigate", ok: true },
  { type: "coverage", status: "written", computed_by: "kane", coverage_version: 2, scope: "run", pct: 40, usecases: [], criteria: [] },
  { type: "run_end", status: "passed", one_liner: "passed: open the app", summary: "open the app", duration: 3.1 },
);
// `kane-cli cover --mode agent`: a coverage payload, then done. No run_start.
const coverStream = lines({ type: "coverage", source: "project", state: "computing" }, { type: "done", exit: 0 });

test("server: an rc.3 run with a coverage event before run_end is a run that passed", () => {
  const p = parseKaneStream(rc3Run);
  assert.equal(p.family, "run");
  assert.equal(p.terminal?.type, "run_end");
  assert.equal(decideStatus(0, !!p.terminal).status, "passed");
});

test("kanehack: the same rc.3 run is reported as a run with its completion event", () => {
  const s = scan(rc3Run);
  assert.equal(s.family, "run");
  assert.equal(s.terminal, "run_end");
  assert.equal(s.status, "passed");
});

test("a cover stream (no run_start) still parses as assurance on both sides", () => {
  assert.equal(parseKaneStream(coverStream).family, "assurance");
  assert.equal(scan(coverStream).family, "assurance");
});
