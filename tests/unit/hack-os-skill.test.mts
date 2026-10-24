// Structural checks for the single hack-os skill: what ships, that its two copies match,
// and that its text only names real MCP tools, official hosts and safe commands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SKILL = join(root, "plugin/skills/hack-os");
const MIRROR = join(root, ".agents/skills/hack-os");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = () => walk(SKILL).map((p) => relative(SKILL, p)).sort();
const textFiles = () => files().filter((f) => /\.(md|ya?ml|mjs)$/.test(f));
const read = (f: string) => readFileSync(join(SKILL, f), "utf8");

test("frontmatter names hack-os with a usable description", () => {
  const md = read("SKILL.md");
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md starts with a --- frontmatter block");
  assert.match(m[1], /^name: hack-os$/m);
  const desc = m[1].match(/^description: "?(.*?)"?$/m)?.[1] ?? "";
  assert.ok(desc.length > 0 && desc.length <= 1024, `description length ${desc.length}`);
  assert.match(desc, /Kane CLI Hack Day/);
});

test("mirror in .agents/skills is identical", () => {
  const mirror = walk(MIRROR).map((p) => relative(MIRROR, p)).sort();
  assert.deepEqual(mirror, files());
  for (const f of files()) assert.ok(readFileSync(join(SKILL, f)).equals(readFileSync(join(MIRROR, f))), `${f} differs`);
});

test("only hack-os ships", () => {
  assert.deepEqual(readdirSync(join(root, "plugin/skills")).sort(), ["hack-os"]);
  assert.deepEqual(readdirSync(join(root, ".agents/skills")).filter((d) => d.startsWith("hack-")).sort(), ["hack-os"]);
});

test("every file SKILL.md points at exists", () => {
  const refs = [...read("SKILL.md").matchAll(/\b((?:references|scripts)\/[\w.-]+\.(?:md|mjs))\b/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, "SKILL.md names its reference files");
  for (const r of refs) assert.ok(existsSync(join(SKILL, r)), `${r} is missing`);
});

test("every MCP tool named in the skill is registered in src/server/mcp.ts", () => {
  const mcp = readFileSync(join(root, "src/server/mcp.ts"), "utf8");
  const real = new Set([...mcp.matchAll(/tool\(\s*"([a-z_]+)"/g)].map((m) => m[1]));
  assert.ok(real.has("participant_get_status"), "parsed the tool registry");
  const prefix = /^(participant|team|idea|help|submission|showcase|deck|event|activation|kane|milestone|readiness|harness|demo)_[a-z_]+$/;
  // `kanehack doctor --json` check names, which the setup guide quotes; not MCP tools.
  const doctorChecks = new Set(["kane_cli", "kane_skill"]);
  for (const f of textFiles().filter((f) => f.endsWith(".md")))
    for (const [, name] of read(f).matchAll(/`([a-z_]+)`/g))
      if (prefix.test(name) && !doctorChecks.has(name)) assert.ok(real.has(name), `${f} names unknown tool ${name}`);
});

test("only official hosts appear", () => {
  // www.testmuai.com: the official Kane CLI agent docs, linked from the event's idea validator.
  const allowed = new Set(["kaneclihack.sh", "www.kaneclihack.sh", "github.com", "www.testmuai.com"]);
  for (const f of textFiles())
    for (const [u] of read(f).matchAll(/https?:\/\/[^\s)>"'`\]]+/g)) {
      const host = new URL(u.replace(/[.,;:]+$/, "").replace(/[{}<>]/g, "x")).hostname;
      assert.ok(allowed.has(host), `${f} links to ${host}`);
    }
});

test("never tells the agent to print secrets", () => {
  for (const f of textFiles())
    for (const line of read(f).split("\n"))
      if (/kanehack token|mcp-headers/.test(line)) assert.match(line, /never|don't|do not/i, `${f}: ${line}`);
});

test("the routing table names every reference file", () => {
  const md = read("SKILL.md");
  for (const f of readdirSync(join(SKILL, "references"))) assert.ok(md.includes(`references/${f}`), `SKILL.md never routes to references/${f}`);
});
