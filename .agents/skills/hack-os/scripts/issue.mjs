#!/usr/bin/env node
// Draft a GitHub issue on LambdaTest/kane-cli for a participant stuck with Kane CLI.
// Strips secrets, writes the cleaned body to a new private file, and says how to file it:
// with `gh` when it's signed in, otherwise a prefilled link for the browser. Files nothing.
//
//   node issue.mjs --title "<title>" --body-file <path>
//   → {"title","body_file","url","gh_ready","gh_argv"}
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const REPO = "LambdaTest/kane-cli";
const PREFIX = "[Hack Day] ";
const MAX_URL = 7500;

const args = process.argv.slice(2);
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const title0 = flag("--title");
const bodyFile = flag("--body-file");
if (!title0 || !bodyFile) {
  process.stderr.write(JSON.stringify({ error: 'Use: issue.mjs --title "<title>" --body-file <path>' }) + "\n");
  process.exit(2);
}

const home = homedir();
const redact = (s) =>
  s
    .split(home + "/").join("~/")
    .replace(/khk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(access[_-]?key|password|passwd|secret|token)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]");

const t = redact(title0.trim());
const title = t.startsWith(PREFIX) ? t : PREFIX + t;
const body = redact(readFileSync(bodyFile, "utf8"));
const out = join(mkdtempSync(join(tmpdir(), "hack-os-issue-")), "body.md");
writeFileSync(out, body, { mode: 0o600 });

const link = (b) => `https://github.com/${REPO}/issues/new?` + new URLSearchParams({ template: "agent-bug-report.md", title, body: b });
let url = link(body);
for (let n = body.length; url.length > MAX_URL && n > 0; n = Math.floor(n * 0.9))
  url = link(body.slice(0, n) + "\n\n…(truncated; full details in the issue body)");

const gh = spawnSync("gh", ["auth", "status"], { stdio: "ignore" });
const ghReady = gh.status === 0;
process.stdout.write(
  JSON.stringify({ title, body_file: out, url, gh_ready: ghReady, gh_argv: ghReady ? ["gh", "issue", "create", "-R", REPO, "--title", title, "--body-file", out] : null }) + "\n",
);
