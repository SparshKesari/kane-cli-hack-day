// hack-os/scripts/issue.mjs: drafts a GitHub issue on LambdaTest/kane-cli for a stuck
// participant, with secrets stripped, and says whether `gh` can file it or a link is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../plugin/skills/hack-os/scripts/issue.mjs", import.meta.url));

/** PATH holding only a fake `gh` (exit code chosen) or nothing at all. */
function pathWithGh(authExit: number | null) {
  const dir = mkdtempSync(join(tmpdir(), "hackos-gh-"));
  if (authExit !== null) {
    writeFileSync(join(dir, "gh"), `#!/bin/sh\n[ "$1 $2" = "auth status" ] && exit ${authExit}\nexit 1\n`);
    chmodSync(join(dir, "gh"), 0o755);
  }
  return dir;
}

type Draft = { title: string; body_file: string; url: string; gh_ready: boolean; gh_argv: string[] | null };

function draft(title: string, body: string, PATH = pathWithGh(null)): Promise<{ code: number | null; json: Draft; err: string }> {
  const f = join(mkdtempSync(join(tmpdir(), "hackos-issue-")), "body.md");
  writeFileSync(f, body);
  return new Promise((done) => {
    const p = spawn(process.execPath, [SCRIPT, "--title", title, "--body-file", f], { env: { ...process.env, PATH } });
    let out = "", err = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (err += b));
    p.on("close", (code) => {
      let json = {} as Draft;
      try { json = JSON.parse(out); } catch {}
      done({ code, json, err });
    });
  });
}

test("prefixes the title once", async () => {
  assert.equal((await draft("kane-cli run hangs", "x")).json.title, "[Hack Day] kane-cli run hangs");
  assert.equal((await draft("[Hack Day] kane-cli run hangs", "x")).json.title, "[Hack Day] kane-cli run hangs");
});

test("redacts secrets from title and body", async () => {
  const body = [
    "token khk_abc123XYZ in output",
    "Authorization: Bearer xyz.789",
    "LT_ACCESS_KEY=supersecret123",
    "password: hunter22",
    "mail me at ana@example.com",
    `${homedir()}/projects/orbit/app.ts failed`,
  ].join("\n");
  const r = await draft("ana@example.com sees khk_abc123XYZ", body);
  assert.equal(r.code, 0, r.err);
  const all = r.json.title + readFileSync(r.json.body_file, "utf8") + decodeURIComponent(r.json.url);
  for (const raw of ["khk_abc123XYZ", "xyz.789", "supersecret123", "hunter22", "ana@example.com", homedir() + "/"]) assert.ok(!all.includes(raw), `leaked ${raw}`);
  assert.match(readFileSync(r.json.body_file, "utf8"), /~\/projects\/orbit\/app\.ts/);
  assert.match(readFileSync(r.json.body_file, "utf8"), /LT_ACCESS_KEY=\[redacted\]/);
});

test("link uses the repo's bug template and stays under 7500 characters", async () => {
  const r = await draft("long log", "line of log output\n".repeat(2000));
  const u = new URL(r.json.url);
  assert.equal(u.origin + u.pathname, "https://github.com/LambdaTest/kane-cli/issues/new");
  assert.equal(u.searchParams.get("template"), "agent-bug-report.md");
  assert.ok(r.json.url.length <= 7500, `url is ${r.json.url.length}`);
  assert.match(u.searchParams.get("body") ?? "", /truncated/);
  assert.equal(readFileSync(r.json.body_file, "utf8").split("\n").length, 2001, "the body file keeps everything");
});

test("without a signed-in gh it gives the link only", async () => {
  for (const PATH of [pathWithGh(null), pathWithGh(1)]) {
    const r = await draft("t", "b", PATH);
    assert.equal(r.json.gh_ready, false);
    assert.equal(r.json.gh_argv, null);
  }
});

test("with a signed-in gh it gives the exact gh command", async () => {
  const r = await draft("t", "b", pathWithGh(0));
  assert.equal(r.json.gh_ready, true);
  assert.deepEqual(r.json.gh_argv, ["gh", "issue", "create", "-R", "LambdaTest/kane-cli", "--title", "[Hack Day] t", "--body-file", r.json.body_file]);
});

test("missing arguments are a usage error", async () => {
  const r = await new Promise<number | null>((done) => spawn(process.execPath, [SCRIPT, "--title", "x"]).on("close", done));
  assert.equal(r, 2);
});
