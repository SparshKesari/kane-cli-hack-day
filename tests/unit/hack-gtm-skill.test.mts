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

test("no dotfiles in either skill folder (the bundle leaves them out, so CI's bundle-equals-source check fails)", () => {
  for (const skill of ["hack-os", "hack-gtm"]) {
    const dir = join(root, "plugin/skills", skill);
    for (const f of files(dir)) assert.ok(!f.split("/").some((part) => part.startsWith(".")), `${skill}/${f}`);
  }
});

test("no build output or dependencies ship in the bundle", () => {
  for (const f of files(SKILL)) assert.doesNotMatch(f, /(^|\/)(node_modules|out|dist|__pycache__)\/|\.(mp4|mp3|wav|pyc)$/, f);
});

const textFiles = () => files(SKILL).filter((f) => /\.(md|html)$/.test(f));

test("uses the event's own name, never a co-branded one", () => {
  for (const f of textFiles())
    for (const line of read(f).split("\n"))
      if (/x OpenAI Hack Day/i.test(line)) assert.match(line, /never/i, `${f}: ${line}`);
});

test("never sends readers to the evidence pack, which stays private", () => {
  for (const f of textFiles()) assert.doesNotMatch(read(f), /evidence serve|evidence pack link|evidence pack is in the repo/i, f);
});

test("runs its scripts from the skill folder, not the project's", () => {
  const cmds = [...read("SKILL.md").matchAll(/^(?:python3|bash) (\S+)/gm)].map((m) => m[1]);
  assert.ok(cmds.length >= 4, "SKILL.md shows the video commands");
  for (const c of cmds) assert.match(c, /^<skill>\/scripts\//, c);
});

test("never picks a paid or remote voice on its own", () => {
  assert.doesNotMatch(read("SKILL.md"), /OpenAI TTS, then edge-tts/);
  assert.match(read("SKILL.md"), /Ask before installing anything or spending money/);
});

test("hack-os hands off to it and the plugin lists both skills", () => {
  assert.match(readFileSync(join(root, "plugin/skills/hack-os/SKILL.md"), "utf8"), /\$hack-gtm/);
  const plugin = JSON.parse(readFileSync(join(root, "plugin/plugin.json"), "utf8"));
  assert.deepEqual([...plugin.skills].sort(), ["skills/hack-gtm", "skills/hack-os"]);
});
