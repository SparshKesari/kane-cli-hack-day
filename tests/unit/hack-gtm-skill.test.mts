// Structural checks for the hack-gtm launch-kit skill, shipped next to hack-os in one bundle:
// its two copies match, what its SKILL.md names exists, and hack-os and the plugin point at it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const SKILL = join(root, "plugin/skills/hack-gtm");
const MIRROR = join(root, ".agents/skills/hack-gtm");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const files = (dir: string) => walk(dir).map((p) => relative(dir, p)).sort();
const read = (f: string) => readFileSync(join(SKILL, f), "utf8");

test("frontmatter names hack-gtm with a usable description", () => {
  const m = read("SKILL.md").match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, "SKILL.md starts with a --- frontmatter block");
  assert.match(m[1], /^name: hack-gtm$/m);
  const desc = m[1].match(/^description: "?(.*?)"?$/m)?.[1] ?? "";
  assert.ok(desc.length > 0 && desc.length <= 1024, `description length ${desc.length}`);
});

test("mirror in .agents/skills is identical", () => {
  assert.deepEqual(files(MIRROR), files(SKILL));
  for (const f of files(SKILL)) assert.ok(readFileSync(join(SKILL, f)).equals(readFileSync(join(MIRROR, f))), `${f} differs`);
});

test("every file SKILL.md points at exists", () => {
  const refs = [...read("SKILL.md").matchAll(/\b((?:references|scripts|assets)\/[\w./-]+\.(?:md|py|html|sh|tsx?))\b/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, "SKILL.md names its files");
  for (const r of refs) assert.ok(existsSync(join(SKILL, r)), `${r} is missing`);
});

test("no build output or dependencies ship in the bundle", () => {
  for (const f of files(SKILL)) assert.doesNotMatch(f, /(^|\/)(node_modules|out|dist|__pycache__)\/|\.(mp4|mp3|wav|pyc)$/, f);
});

test("hack-os hands off to it and the plugin lists both skills", () => {
  assert.match(readFileSync(join(root, "plugin/skills/hack-os/SKILL.md"), "utf8"), /\$hack-gtm/);
  const plugin = JSON.parse(readFileSync(join(root, "plugin/plugin.json"), "utf8"));
  assert.deepEqual([...plugin.skills].sort(), ["skills/hack-gtm", "skills/hack-os"]);
});
