// hack-gtm's video scripts: what reaches a public video from an evidence pack and a brief.
// Credentials typed in plain English are redacted, unfinished drafts never render, captions end
// on a whole phrase, and a brief the script can't read is reported instead of silently ignored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = fileURLToPath(new URL("../../plugin/skills/hack-gtm/scripts/", import.meta.url));
const STORYBOARD = join(SCRIPTS, "evidence_to_storyboard.py");
const python = spawnSync("python3", ["--version"]).status === 0;
const opts = { skip: python ? false : "python3 is not installed" };

function py(args: string[], input?: string) {
  const r = spawnSync("python3", ["-B", ...args], { input, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const redact = (texts: string[]): string[] => {
  const r = py(["-c", "import json, sys; sys.path.insert(0, sys.argv[1]); from evidence_to_storyboard import redact; print(json.dumps([redact(t) for t in json.load(sys.stdin)]))", SCRIPTS], JSON.stringify(texts));
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out);
};

test("credentials written in plain English are redacted", opts, () => {
  const cases: [string, string][] = [
    ["Log in with password hunter2pass", "Log in with password [redacted]"],
    ["Sign in as demo@shop.test with password Abc123!", "Sign in as [redacted] with password [redacted]"],
    ["Enter the password 'Abc123!' and submit", "Enter the password '[redacted]' and submit"],
    ["Type 'secret_sauce' into the password field", "Type '[redacted]' into the password field"],
    ["Fill the password field with Abc123!", "Fill the password field with [redacted]"],
    ["use pin 4242 and OTP 918273", "use pin [redacted] and OTP [redacted]"],
    ["pin: 4242", "pin: [redacted]"],
    ["Enter verification code 551234.", "Enter verification code [redacted]."],
    ["type 'correct horse battery' as the password", "type '[redacted]' as the password"],
    ["Type 'it\u2019s a secret' in the password field", "Type '[redacted]' in the password field"],
    ["Enter the code 123456 from the email", "Enter the code [redacted] from the email"],
    ["Log in with user demo and pass Secret99", "Log in with user demo and pass [redacted]"],
    ["credentials: admin / hunter2", "credentials: [redacted]"],
    ["enter password (hunter2)", "enter password ([redacted])"],
  ];
  assert.deepEqual(redact(cases.map((c) => c[0])), cases.map((c) => c[1]));
});

test("login steps that name the password field but carry no value are left alone", opts, () => {
  const plain = [
    "Click the password field",
    "Assert 'Wrong password' error is shown",
    "Check the password is masked",
    "Open the Forgot password link",
    "Enter password and press Sign in",
    "Pin 3 items to the board",
    "Type 'standard_user' into the username field",
    "Type 'Hello' into the code editor",
    "Check the status code 200",
    "The run should pass",
  ];
  assert.deepEqual(redact(plain), plain);
});

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "hack-gtm-"));
  return { dir, out: join(dir, "video"), brief: join(dir, "brief.md"), pack: join(dir, "pass.evidence") };
}

// A sealed pack holds run.yaml plus tests/<id>/{test.md,result.yaml,steps/<n>/step.json}.
function makePack(path: string, objective: string, steps: { title: string; status: string }[]) {
  const r = py(["-c", `
import json, sys, zipfile
spec = json.load(sys.stdin)
with zipfile.ZipFile(spec["path"], "w") as z:
    z.writestr("run.yaml", "title: Listly smoke\\nstatus: passed\\nduration: 12s\\n")
    z.writestr("tests/t1/test.md", spec["objective"])
    z.writestr("tests/t1/result.yaml", "verdict: passed\\n")
    for i, step in enumerate(spec["steps"], 1):
        z.writestr("tests/t1/steps/%02d-step/step.json" % i, json.dumps(step))
`], JSON.stringify({ path, objective, steps }));
  assert.equal(r.code, 0, r.err);
}

const FULL_BRIEF = `project: Listly
pitch: Shared shopping lists that never lose an item
hook: Ever bought milk twice?
problem: Families text lists and forget half of them
who: Busy parents
solution: One list, synced, with reminders
why: From five texts to one list
openai: GPT-5 sorts items by aisle
openai_narration: GPT sorts every item by aisle as you type it.
ship_url: https://kaneclihack.sh/ship/listly
`;

const STEPS = [
  { title: "Open the todo app", status: "done" },
  { title: "Log in with password hunter2pass", status: "done" },
  { title: "Add 'Buy milk' to the list", status: "done" },
  { title: "Assert the banner shows the count of all open items in the header today", status: "done" },
];

function storyboard(brief: string | null, extra: string[] = []) {
  const sb = sandbox();
  makePack(sb.pack, "Log in as demo with password hunter2pass, add Buy milk and check it shows in the list", STEPS);
  if (brief !== null) writeFileSync(sb.brief, brief);
  const r = py([STORYBOARD, sb.pack, ...(brief !== null ? ["--brief", sb.brief] : []), ...extra, "--out", sb.out]);
  const file = join(sb.out, "storyboard.json");
  return { ...r, sb, story: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null };
}

type Scene = { id: string; body?: string; narration?: string; links?: string[] };
const scene = (story: { scenes: Scene[] }, id: string) => story.scenes.find((s) => s.id === id);

test("a password in the run objective never reaches the storyboard or the pack summary", opts, () => {
  const r = storyboard(FULL_BRIEF);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(JSON.stringify(r.story), /hunter2pass/);
  assert.match(scene(r.story, "objective")!.body!, /password \[redacted\]/);
  assert.doesNotMatch(readFileSync(join(r.sb.out, "pack-summary.json"), "utf8"), /hunter2pass/);
});

test("step captions end on a whole phrase", opts, () => {
  const r = storyboard(FULL_BRIEF);
  assert.equal(r.code, 0, r.err);
  assert.equal(scene(r.story, "pass-step-3")!.narration, "Step 3, Add 'Buy milk' to the list.");
  assert.equal(scene(r.story, "pass-step-4")!.narration, "Step 4, Assert the banner shows the count of all open items...");
});

test("a complete brief drafts a storyboard with no placeholders, no empty demo and no missing links", opts, () => {
  const r = storyboard(FULL_BRIEF);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(JSON.stringify(r.story), /TODO/);
  assert.equal(scene(r.story, "demo"), undefined, "no demo screenshots, so no demo scene");
  assert.deepEqual(scene(r.story, "outro")!.links, ["https://kaneclihack.sh/ship/listly"]);
  assert.match(r.out, /placeholders left: none/);
});

test("a --brief path that doesn't exist is an error, not an empty brief", opts, () => {
  const sb = sandbox();
  makePack(sb.pack, "Open the app", STEPS.slice(0, 1));
  const r = py([STORYBOARD, sb.pack, "--brief", join(sb.dir, "launch", "brief.md"), "--out", sb.out]);
  assert.equal(r.code, 2);
  assert.match(r.err, /brief\.md/);
  assert.equal(existsSync(join(sb.out, "storyboard.json")), false);
});

test("an unfilled template or a missing brief is reported, and its scenes stay marked to fill", opts, () => {
  const template = "project: \nhook: (one sentence a stranger would stop for; opens the video)\nproblem: (who hits it, how often, what it costs)\n";
  for (const brief of [template, "Listly is a shared list app.\n", null]) {
    const r = storyboard(brief);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /hook/, `stderr names the missing fields for ${JSON.stringify(brief)}`);
    assert.doesNotMatch(JSON.stringify(r.story), /one sentence a stranger/);
    assert.match(scene(r.story, "open")!.narration!, /^TODO narration:/);
    assert.match(r.out, /placeholders left in \d+ scenes: open,/);
  }
});

const BRAND = { accent: "#7CF2C4", bg: "#0B0F14", credit: "Built with OpenAI. Tested with Kane CLI." };
function videoDir(body: string) {
  const sb = sandbox();
  mkdirSync(sb.out, { recursive: true });
  const story = { project: "Listly", fps: 30, width: 320, height: 180, captions: true, brand: BRAND,
    scenes: [{ id: "problem", kind: "card", seconds: 0.2, title: "The problem", body, narration: "Families forget half the list." }] };
  writeFileSync(join(sb.out, "storyboard.json"), JSON.stringify(story));
  return sb;
}

test("the ffmpeg renderer refuses a storyboard that still has placeholders", opts, () => {
  const sb = videoDir("TODO: one sentence");
  const mp4 = join(sb.out, "showcase.mp4");
  const r = py([join(SCRIPTS, "render_ffmpeg.py"), join(sb.out, "storyboard.json"), "--out", mp4]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /placeholder.*problem/s);
  assert.equal(existsSync(mp4), false);
  // Positive control: the same storyboard, filled in, gets past the check. It then renders,
  // or, without Pillow, stops at the Pillow import, which comes after the check.
  const ok = videoDir("Families text lists and forget half of them");
  const okMp4 = join(ok.out, "showcase.mp4");
  const r2 = py([join(SCRIPTS, "render_ffmpeg.py"), join(ok.out, "storyboard.json"), "--out", okMp4]);
  assert.doesNotMatch(r2.err, /placeholder/);
  assert.ok((r2.code === 0 && existsSync(okMp4)) || /Pillow is required/.test(r2.err), r2.err);
});

test("a placeholder anywhere in the storyboard counts, whatever the scene", opts, () => {
  const story = { project: "Listly", pitch: "TODO: one line", brand: BRAND, scenes: [
    { id: "open", kind: "title", title: "Listly", narration: "Ever bought milk twice?" },
    { id: "demo", kind: "demo", images: ["a.png"], narration: "TODO narration: walk through the demo" },
    { id: "outro", kind: "outro", links: ["TODO: ship page"], narration: "Listly." },
  ] };
  const r = py(["-c", "import json, sys; sys.path.insert(0, sys.argv[1]); from evidence_to_storyboard import placeholder_scenes; print(json.dumps(placeholder_scenes(json.load(sys.stdin))))", SCRIPTS], JSON.stringify(story));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), ["demo", "outro", "pitch"]);
});

test("the Remotion renderer refuses placeholders before it sets anything up", opts, () => {
  const sb = videoDir("TODO: one sentence");
  const dest = join(sb.dir, "remotion");
  // An npm that refuses, so a regression fails here instead of installing Remotion and Chrome.
  const bin = join(sb.dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "npm"), "#!/bin/sh\necho 'npm must not run' >&2\nexit 97\n", { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH ?? ""}` };
  const r = spawnSync("sh", [join(SCRIPTS, "remotion", "render.sh"), sb.out, "--dest", dest], { encoding: "utf8", env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /placeholder.*problem/s);
  assert.equal(existsSync(dest), false);
});

test("the ffmpeg renderer never paints setup instructions into a frame", () => {
  assert.doesNotMatch(readFileSync(join(SCRIPTS, "render_ffmpeg.py"), "utf8"), /add demo screenshots/);
});
