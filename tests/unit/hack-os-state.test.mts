// hack-os/scripts/state.mjs: the skill's small private state file (build checkpoint,
// filed help issues) and the "is there a newer skill?" check against install.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../plugin/skills/hack-os/scripts/state.mjs", import.meta.url));

/** A copy of the script inside a throwaway hack-os folder, with an optional installed version. */
function sandbox(bundleVersion?: string) {
  const dir = mkdtempSync(join(tmpdir(), "hackos-state-"));
  const skill = join(dir, "hack-os");
  mkdirSync(join(skill, "scripts"), { recursive: true });
  cpSync(SCRIPT, join(skill, "scripts/state.mjs"));
  if (bundleVersion) writeFileSync(join(skill, ".bundle-version"), bundleVersion + "\n");
  return { script: join(skill, "scripts/state.mjs"), state: join(dir, "os", "state.json") };
}

type Out = { version?: number; build?: string | null; help_issues?: string[]; updated_at?: string | null; current?: string; latest?: string | null; update?: boolean | null; error?: string };

function run(sb: { script: string; state: string }, ...args: string[]): Promise<{ code: number | null; json: Out; stderr: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, [sb.script, ...args], { env: { ...process.env, KANEHACK_OS_STATE: sb.state, KANEHACK_OS_ALLOW_LOCAL: "1" } });
    let out = "", err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("close", (code) => {
      let json: Out = {};
      try { json = JSON.parse(out); } catch {}
      done({ code, json, stderr: err });
    });
  });
}

const serve = (body: string) =>
  new Promise<Server>((ok) => {
    const s = createServer((req, res) => {
      if (req.url === "/install.sh") res.end(body);
      else { res.statusCode = 404; res.end(); }
    });
    s.listen(0, "127.0.0.1", () => ok(s));
  });

test("get on a missing file returns an empty state", async () => {
  const r = await run(sandbox(), "get");
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, { version: 1, build: null, help_issues: [], updated_at: null });
});

test("set-build then get round-trips", async () => {
  const sb = sandbox();
  assert.equal((await run(sb, "set-build", "building")).json.build, "building");
  const r = await run(sb, "get");
  assert.equal(r.json.build, "building");
  assert.match(String(r.json.updated_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await run(sb, "set-build", "nope")).code, 2);
});

test("state file is 0600 and its folder 0700", async () => {
  const sb = sandbox();
  await run(sb, "set-build", "ready");
  assert.equal(statSync(sb.state).mode & 0o777, 0o600);
  assert.equal(statSync(join(sb.state, "..")).mode & 0o777, 0o700);
});

test("add-issue keeps Kane CLI issues and rejects other repos", async () => {
  const sb = sandbox();
  const url = "https://github.com/LambdaTest/kane-cli/issues/412";
  assert.deepEqual((await run(sb, "add-issue", url)).json.help_issues, [url]);
  assert.deepEqual((await run(sb, "add-issue", url)).json.help_issues, [url], "no duplicates");
  const bad = await run(sb, "add-issue", "https://github.com/evil/kane-cli/issues/1");
  assert.equal(bad.code, 2);
  assert.deepEqual((await run(sb, "get")).json.help_issues, [url]);
});

test("check-version reports an update when the site is newer", async () => {
  const s = await serve('#!/bin/sh\nKANEHACK_VERSION="0.1.10"\n');
  try {
    const site = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    const r = await run(sandbox("0.1.9"), "check-version", "--site", site);
    assert.equal(r.code, 0);
    assert.deepEqual(r.json, { current: "0.1.9", latest: "0.1.10", update: true });
    const same = await run(sandbox("0.1.10"), "check-version", "--site", site);
    assert.equal(same.json.update, false);
  } finally {
    s.close();
  }
});

test("check-version with the site unreachable is not an error", async () => {
  const s = await serve("");
  const port = (s.address() as AddressInfo).port;
  await new Promise((ok) => s.close(ok));
  const r = await run(sandbox("0.1.9"), "check-version", "--site", `http://127.0.0.1:${port}`);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, { current: "0.1.9", latest: null, update: null, error: "unreachable" });
});

test("check-version refuses a non-official site unless local testing is allowed", async () => {
  const sb = sandbox("0.1.9");
  const r = await new Promise<number | null>((done) =>
    spawn(process.execPath, [sb.script, "check-version", "--site", "https://evil.example"], { env: { ...process.env, KANEHACK_OS_STATE: sb.state } }).on("close", done),
  );
  assert.equal(r, 2);
});
