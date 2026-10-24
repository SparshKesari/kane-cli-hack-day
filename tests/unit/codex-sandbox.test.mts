// Codex's default sandbox has no network and can't write ~/.kanehack, and some approval policies
// never offer the escalation: kanehack register then fails with ENOTFOUND and nothing can retry it.
// The installer says it lets the sandbox reach both; the skill sends people back to it when they're stuck.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the installer's Codex question says it opens Codex's sandbox to the network and ~/.kanehack", () => {
  for (const file of ["public/install.sh", "public/install.ps1"]) assert.match(readFileSync(file, "utf8"), /Connect \S+ to the event server and let its sandbox reach the network and ~\/\.kanehack/, file);
});

test("hack-os: when this session can't escalate, the person reruns the installer and starts a new Codex session", () => {
  for (const base of ["plugin/skills", ".agents/skills"]) {
    const md = readFileSync(`${base}/hack-os/SKILL.md`, "utf8");
    assert.match(md, /approval policy/, base);
    assert.match(md, /curl -fsSL https:\/\/kaneclihack\.sh\/install\.sh \| sh/, base);
    assert.match(md, /new Codex session/, base);
  }
});
