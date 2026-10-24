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
  const r = spawnSync("python3", ["-B", ...args], { input, encoding: "utf8", env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" } });
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

type Scene = { id: string; body?: string; narration?: string; links?: string[]; seconds?: number };
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
  assert.match(r.err, /placeholder[\s\S]*problem/);
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
  const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, NODE_ENV: "test" as const };
  const r = spawnSync("sh", [join(SCRIPTS, "remotion", "render.sh"), sb.out, "--dest", dest], { encoding: "utf8", env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /placeholder[\s\S]*problem/);
  assert.equal(existsSync(dest), false);
});

test("the ffmpeg renderer never paints setup instructions into a frame", () => {
  assert.doesNotMatch(readFileSync(join(SCRIPTS, "render_ffmpeg.py"), "utf8"), /add demo screenshots/);
});

// ---- The GTM flow fixes: real Kane CLI pack format, voice, renderer audio and layout ----

const PY = process.env.HACK_GTM_PYTHON ?? "python3";
const pillow = spawnSync(PY, ["-c", "import PIL"]).status === 0;
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const withFfmpeg = { skip: python && ffmpeg ? false : "python3 and ffmpeg are needed" };
const withPillow = { skip: pillow && ffmpeg ? false : `set HACK_GTM_PYTHON to a Python with Pillow (and install ffmpeg)` };

function run(cmd: string, args: string[], o: { cwd?: string; path?: string; input?: string } = {}) {
  const env = { PATH: `${o.path ? o.path + ":" : ""}${process.env.PATH ?? ""}`, NODE_ENV: "test" as const };
  const r = spawnSync(cmd, args, { cwd: o.cwd, input: o.input, encoding: "utf8", env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

// The layout Kane CLI 0.10 writes and validates (evidence schema 0.1): run.yaml's status is the
// pack's lifecycle (finalized/aborted) and the counts are in totals; result.yaml carries the
// verdict and the steps; step folders are <ordinal>-<id> with no zero padding.
type RealStep = { id: string; status: string; kind?: string; expected?: string; failure?: string };
function makeRealPack(path: string, o: { status: "passed" | "failed"; runStatus?: string; steps: RealStep[] }) {
  const failed = o.steps.filter((s) => s.status === "failed").length;
  const r = py(["-c", `
import json, sys, zipfile
spec = json.load(sys.stdin)
with zipfile.ZipFile(spec["path"], "w") as z:
    z.writestr("run.yaml", "\\n".join([
        'evidence: "0.1"', "run_id: run-7", "status: " + spec["runStatus"], "title: Listly smoke",
        'started: "2026-10-24T17:00:00Z"', 'ended: "2026-10-24T17:00:41Z"', "totals:",
        "  tests: 1", "  passed: %d" % (spec["status"] == "passed"), "  failed: %d" % (spec["status"] == "failed"),
        "  broken: 0", "  skipped: 0", ""]))
    z.writestr("tests/t1/test.md", "---\\nid: t1\\n---\\nOpen Listly and check Buy milk is in the list\\n")
    lines = ['evidence: "0.1"', "test: t1", "status: " + spec["status"], "duration_ms: 41000", "steps:"]
    for i, s in enumerate(spec["steps"], 1):
        lines += ["  - id: " + s["id"], "    ordinal: %d" % i, "    status: " + s["status"]]
        if s.get("kind"): lines.append("    kind: " + s["kind"])
        if s.get("expected"): lines.append("    expected: " + json.dumps(s["expected"]))
        folder = "tests/t1/steps/%d-%s/" % (i, s["id"])
        z.writestr(folder + "step.json", json.dumps({"action_id": "a%d" % i, "screenshot": "screenshot.jpg"}))
        z.writestr(folder + "screenshot.jpg", b"\\xff\\xd8\\xff\\xe0 not really a jpeg")
        if s.get("failure"):
            z.writestr(folder + "failure.yaml", "\\n".join([
                "step: " + s["id"], "status: failed", "title: " + s["failure"], "error:",
                "  message: |", "    Expected Buy milk in the task list", "    but the list was empty", ""]))
    z.writestr("tests/t1/result.yaml", "\\n".join(lines) + "\\n")
`], JSON.stringify({ path, status: o.status, runStatus: o.runStatus ?? "finalized", steps: o.steps }));
  assert.equal(r.code, 0, r.err);
  return failed;
}

const TEN: RealStep[] = Array.from({ length: 10 }, (_, i) => ({ id: `step-${i + 1}`, status: "passed", kind: "action" }));
TEN[9] = { id: "check-list", status: "passed", kind: "assert", expected: "Buy milk is in the list" };

function realStoryboard(pack: string, args: string[] = [], flags: string[] = []) {
  const out = join(pack, "..", "video");
  const r = run("python3", ["-B", ...flags, STORYBOARD, pack, "--brief", join(pack, "..", "brief.md"), ...args, "--out", out]);
  const file = join(out, "storyboard.json");
  return { ...r, out, story: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null };
}

test("a real passing Kane CLI pack shows PASSED, its steps in order, a duration and readable labels", opts, () => {
  const sb = sandbox();
  writeFileSync(sb.brief, FULL_BRIEF);
  makeRealPack(sb.pack, { status: "passed", steps: TEN });
  const r = realStoryboard(sb.pack);
  assert.equal(r.code, 0, r.err);
  const verdict = scene(r.story, "verdict") as Scene & { status: string; totals: Record<string, unknown> };
  assert.equal(verdict.status, "passed");
  assert.deepEqual(verdict.totals, { steps: 10, passed: 10, failed: 0, duration: "41s", status: "passed" });
  assert.match(verdict.narration!, /^The run passed\. 10 steps/);
  const steps = r.story.scenes.filter((s: { kind: string }) => s.kind === "step").map((s: { step: number }) => s.step);
  assert.deepEqual(steps, [1, 2, 9, 10]);
  assert.equal(scene(r.story, "pass-step-10")!.narration, "Step 10, Check: Buy milk is in the list.");
  assert.equal(scene(r.story, "pass-step-2")!.narration, "Step 2, Step 2.");
  assert.equal(scene(r.story, "objective")!.body, "Open Listly and check Buy milk is in the list");
});

test("a real failed pack shows the failing step's own message, and an aborted run never shows PASSED", opts, () => {
  const sb = sandbox();
  writeFileSync(sb.brief, FULL_BRIEF);
  const steps = [{ id: "open", status: "passed" }, { id: "add", status: "passed" }, { id: "check-list", status: "failed", failure: "Buy milk missing from the list" }];
  makeRealPack(sb.pack, { status: "failed", steps });
  const r = realStoryboard(sb.pack);
  assert.equal(r.code, 0, r.err);
  assert.equal((scene(r.story, "verdict") as { status?: string }).status, "failed");
  const bad = scene(r.story, "pass-step-3") as Scene & { error?: string; status?: string };
  assert.equal(bad.status, "failed");
  assert.equal(bad.error, "Buy milk missing from the list");
  const aborted = sandbox();
  writeFileSync(aborted.brief, FULL_BRIEF);
  makeRealPack(aborted.pack, { status: "passed", runStatus: "aborted", steps: TEN.slice(0, 3) });
  assert.equal((scene(realStoryboard(aborted.pack).story, "verdict") as { status?: string }).status, "failed");
});

test("without PyYAML (python -S) a real pack reads the same as with it", opts, () => {
  const sb = sandbox();
  writeFileSync(sb.brief, FULL_BRIEF);
  makeRealPack(sb.pack, { status: "failed", steps: [{ id: "open", status: "passed" }, { id: "check-list", status: "failed", failure: "Buy milk missing from the list" }] });
  const a = realStoryboard(sb.pack);
  const b = realStoryboard(sb.pack, [], ["-S"]);
  assert.equal(b.code, 0, b.err);
  assert.deepEqual(b.story, a.story);
});

test("screenshots in a real pack can be .jpg, and keep their type when copied", opts, () => {
  const sb = sandbox();
  writeFileSync(sb.brief, FULL_BRIEF);
  makeRealPack(sb.pack, { status: "passed", steps: TEN.slice(0, 2) });
  const r = realStoryboard(sb.pack, ["--include-screenshots"]);
  assert.equal(r.code, 0, r.err);
  const img = (scene(r.story, "pass-step-1") as { image?: string }).image!;
  assert.match(img, /^steps\/pass-01-01\.jpg$/);
  assert.ok(existsSync(join(r.out, img)));
});

test("long Ship Page slugs and file names are not mistaken for secrets; real tokens still are", opts, () => {
  const keep = ["https://www.kaneclihack.sh/ship/kestrel-release-checklist-agent-v2", "assets/screenshot-dashboard-after-login-final.png",
    "The suite should pass 100% of checks", "Use the code v2.0 branch"];
  assert.deepEqual(redact(keep), keep);
  const secret = ["3f8a9c0d1e2b4a5f6c7d8e9f0a1b2c3d4e5f6a7b", "sk-proj-Ab3dEf9hIjKlMn0pQrStUvWxYz12345678AbCdEfGh"];
  assert.deepEqual(redact(secret), ["[redacted]", "[redacted]"]);
});

test("brief screenshots are copied into the video folder, and a missing one is named", opts, () => {
  const sb = sandbox();
  mkdirSync(join(sb.dir, "shots"));
  writeFileSync(join(sb.dir, "shots", "home.png"), "png");
  writeFileSync(sb.brief, FULL_BRIEF + "demo: shots/home.png, shots/missing.png\nhero: shots/home.png\n");
  makePack(sb.pack, "Open the app", STEPS.slice(0, 1));
  const r = run("python3", ["-B", STORYBOARD, sb.pack, "--brief", sb.brief, "--out", sb.out], { cwd: sb.dir });
  assert.equal(r.code, 0, r.err);
  const story = JSON.parse(readFileSync(join(sb.out, "storyboard.json"), "utf8"));
  assert.deepEqual((scene(story, "demo") as { images?: string[] }).images, ["assets/demo-1.png"]);
  assert.equal((scene(story, "open") as { image?: string }).image, "assets/hero.png");
  assert.ok(existsSync(join(sb.out, "assets", "demo-1.png")) && existsSync(join(sb.out, "assets", "hero.png")));
  assert.match(r.err, /shots\/missing\.png/);
});

test("the video folder keeps itself out of git, since it holds pack-derived files", opts, () => {
  const r = storyboard(FULL_BRIEF);
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(join(r.sb.out, ".gitignore"), "utf8").trim(), "*");
});

test("neither renderer points viewers at the private evidence pack", () => {
  for (const f of ["render_ffmpeg.py", "remotion/src/Showcase.tsx"])
    assert.doesNotMatch(readFileSync(join(SCRIPTS, f), "utf8"), /evidence serve/, f);
});

// A fake `say`: writes `seconds` of tone, or (like `say` inside Codex's sandbox) a valid but empty file.
function fakeSay(dir: string, seconds: number) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "say"), `#!/bin/sh
out=""; while [ $# -gt 0 ]; do [ "$1" = "-o" ] && { out="$2"; shift; }; shift; done
exec ffmpeg -v error -y -f lavfi -i "sine=frequency=440:sample_rate=22050" -t ${seconds} -c:a pcm_s16be "$out"
`, { mode: 0o755 });
  return bin;
}

function ttsBoard(scenes: object[]) {
  const sb = sandbox();
  mkdirSync(sb.out, { recursive: true });
  writeFileSync(join(sb.out, "storyboard.json"), JSON.stringify({ project: "Listly", fps: 30, captions: true, brand: BRAND, scenes }));
  return sb;
}

const tts = (sb: { dir: string; out: string }, seconds: number, flags = ["-B"]) =>
  run("python3", [...flags, join(SCRIPTS, "tts.py"), join(sb.out, "storyboard.json"), "--provider", "say", "--out", join(sb.out, "audio")], { path: fakeSay(sb.dir, seconds) });

test("an empty voice file (say inside Codex's sandbox) stops with a clear message, not a traceback", withFfmpeg, () => {
  const sb = ttsBoard([{ id: "problem", kind: "card", seconds: 7, narration: "Families forget half the list." }]);
  const r = tts(sb, 0);
  assert.notEqual(r.code, 0);
  assert.match(r.err + r.out, /no audio[\s\S]*sandbox/i);
  assert.doesNotMatch(r.err, /Traceback/);
});

test("narration that mentions a todo app is voiced; a drafted placeholder is skipped and loses stale audio", withFfmpeg, () => {
  const sb = ttsBoard([
    { id: "pass-step-2", kind: "step", seconds: 3.5, narration: "Step 2, Add a TODO item." },
    { id: "who", kind: "card", seconds: 6, audio: "audio/old.mp3", narration: "TODO narration: who it is for." },
  ]);
  const r = tts(sb, 1);
  assert.equal(r.code, 0, r.err);
  const story = JSON.parse(readFileSync(join(sb.out, "storyboard.json"), "utf8"));
  assert.ok((scene(story, "pass-step-2") as { audio?: string }).audio);
  assert.equal((scene(story, "who") as { audio?: string }).audio, undefined);
});

test("short narration doesn't squeeze the demo, verdict or outro below a watchable length", withFfmpeg, () => {
  const sb = ttsBoard([
    { id: "demo", kind: "demo", seconds: 10, images: ["a.png", "b.png"], narration: "You add a task." },
    { id: "outro", kind: "outro", seconds: 7, narration: "Listly." },
  ]);
  const r = tts(sb, 1);
  assert.equal(r.code, 0, r.err);
  const story = JSON.parse(readFileSync(join(sb.out, "storyboard.json"), "utf8"));
  assert.ok(scene(story, "demo")!.seconds! >= 6);
  assert.ok(scene(story, "outro")!.seconds! >= 5);
});

test("narration that would say 'redacted' aloud is flagged", withFfmpeg, () => {
  const sb = ttsBoard([{ id: "objective", kind: "card", seconds: 7, narration: "Sign in with password [redacted] and add a task." }]);
  const r = tts(sb, 1);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out + r.err, /redacted[\s\S]*objective/i);
});

test("running the voice step leaves no bytecode in the installed skill", withFfmpeg, () => {
  const cache = join(SCRIPTS, "__pycache__");
  const sb = ttsBoard([{ id: "problem", kind: "card", seconds: 7, narration: "Families forget half the list." }]);
  try {
    const r = tts(sb, 1, []);
    assert.equal(r.code, 0, r.err);
    assert.equal(existsSync(cache), false);
  } finally {
    if (existsSync(cache)) spawnSync("rm", ["-r", cache]);
  }
});

test("the ffmpeg renderer keeps one audio format, so a silent scene doesn't garble the voice after it", withPillow, () => {
  const sb = videoDir("Families text lists and forget half of them");
  const story = JSON.parse(readFileSync(join(sb.out, "storyboard.json"), "utf8"));
  mkdirSync(join(sb.out, "audio"));
  assert.equal(spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000", "-t", "1", "-ac", "1", join(sb.out, "audio", "02.mp3")]).status, 0);
  story.width = 640;
  story.height = 360;
  story.scenes = [{ ...story.scenes[0], id: "silent", seconds: 1 }, { ...story.scenes[0], id: "voiced", seconds: 1.2, audio: "audio/02.mp3" }];
  writeFileSync(join(sb.out, "storyboard.json"), JSON.stringify(story));
  const mp4 = join(sb.out, "showcase.mp4");
  const r = run(PY, ["-B", join(SCRIPTS, "render_ffmpeg.py"), join(sb.out, "storyboard.json"), "--out", mp4]);
  assert.equal(r.code, 0, r.err);
  const probe = run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "csv=p=0", mp4]);
  assert.equal(probe.out.trim(), "48000,1");
});

test("the ffmpeg renderer never drops caption words, even in the vertical cut", withPillow, () => {
  const words = "Step 3 failed: the banner never showed the new task, because the list re-rendered before the save finished, so Kane caught a race that our own unit tests had missed for two days straight.";
  const r = run(PY, ["-B", "-c", `
import sys; sys.path.insert(0, sys.argv[1])
import render_ffmpeg as rf
from PIL import Image, ImageDraw, ImageFont
rf.Image, rf.ImageDraw, rf.ImageFont = Image, ImageDraw, ImageFont
sb = {"brand": {"bg": "#0B0F14", "accent": "#7CF2C4", "credit": "c"}, "captions": True}
p = rf.Painter(sb, rf.Path("."), vertical=True)
im, d = p.new()
font, lines = p.caption_lines(d, sys.argv[2])
print(" ".join(lines))
`, SCRIPTS, words]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), words);
});

test("the brief's key: value line wins over prose further down that starts with the same word", opts, () => {
  const sb = sandbox();
  writeFileSync(sb.brief, FULL_BRIEF + "fix: The list re-rendered before the save finished.\n\n## How we used Kane CLI\nFix: we tried three things first.\n");
  makePack(sb.pack, "Open the app", STEPS.slice(0, 2));
  const fail = join(sb.dir, "fail.evidence");
  makePack(fail, "Open the app", [{ title: "Open the todo app", status: "failed" }]);
  const r = py([STORYBOARD, sb.pack, "--fail", fail, "--brief", sb.brief, "--out", sb.out]);
  assert.equal(r.code, 0, r.err);
  const story = JSON.parse(readFileSync(join(sb.out, "storyboard.json"), "utf8"));
  assert.equal(scene(story, "fix")!.body, "The list re-rendered before the save finished.");
});
