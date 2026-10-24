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
// This machine's own secrets, wherever they appear: the pairing token and TestMu key kanehack saved,
// and the key environment variables.
const known = [process.env.KANEHACK_TOKEN, process.env.TESTMU_ACCESS_KEY, process.env.LT_ACCESS_KEY];
try {
  const c = JSON.parse(readFileSync(join(home, ".kanehack", "config.json"), "utf8"));
  known.push(c.token, c.testmu?.access_key);
} catch {}
// Patterns from packages/kanehack/lib/redact.mjs, plus the shapes Kane and kanehack commands print.
const SECRET_VALUE = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bkh[kpbh]_[A-Za-z0-9_-]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
];
const SECRET_KEY = /"([^"]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|cookie|credential)[^"]*)"\s*:\s*"[^"]*"/gi;
const redact = (text) => {
  let s = text;
  for (const v of known) if (typeof v === "string" && v.length >= 6) s = s.split(v).join("[redacted]");
  if (home.length > 1) s = s.split(home).join("~");
  s = s.replace(/[A-Za-z]:\\+Users\\+[^\\\s"']+/g, "~").replace(/\/(?:Users|home)\/[^/\s"']+/g, "~");
  for (const re of SECRET_VALUE) s = s.replace(re, "[redacted]");
  return s
    .replace(SECRET_KEY, (_m, key) => `"${key}":"[redacted]"`)
    .replace(/(--(?:access-key|api-key|password|passwd|secret|token|key))(\s+|=)\S+/gi, "$1$2[redacted]")
    .replace(/\b(bearer|basic)\s+\S+/gi, "$1 [redacted]")
    .replace(/(access[_-]?key|password|passwd|secret|token)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]");
};

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
