# Showcase video from a Kane CLI evidence pack

Goal: a 60 to 90 second MP4 with voice-over that shows the app, then the real Kane CLI run step by step, then the verdict. Everything on screen comes from the evidence pack or the brief; nothing is mocked.

## Evidence pack layout (what the script reads)

A `.evidence` file is a zip:

```
run.yaml                         # title, status, started/ended, totals
failure.yaml                     # run-level failure rollup (failed runs)
tests/<test-id>/
  test.md                        # the test definition
  result.yaml                    # verdict, per-step outcomes, tags, environment
  logs/<n>-actions.ndjson        # step-by-step actions
  logs/<n>-console.ndjson
  logs/<n>-network.har
  steps/<ordinal>-<step-id>/
    screenshot.png               # page as the agent saw it
    annotated.png                # same with the acted-on element highlighted
    step.json                    # kind, status, duration, url, action id, click coords, element rect
    failure.yaml                 # only on failed/broken steps
  auteur/execution.json
```

If the pack is live (unsealed), run `kane-cli evidence validate <path>` first; `serve` and this pipeline expect sealed packs. If the team has a failed pack and a passed pack, pass both to the storyboard script (`--fail <pack> --pass <pack>`) so the video can show the fix.

## Storyboard schema (`launch/video/storyboard.json`)

```json
{
  "project": "Orbit",
  "pitch": "A release checklist that runs itself in a real browser.",
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "brand": {"accent": "#7CF2C4", "bg": "#0B0F14", "credit": "Built with OpenAI. Tested with Kane CLI."},
  "scenes": [
    {"id": "open", "kind": "title", "act": "pitch", "seconds": 5, "title": "Orbit", "subtitle": "...", "image": "assets/hero.png", "narration": "..."},
    {"id": "problem", "kind": "card", "act": "pitch", "seconds": 7, "title": "...", "body": "...", "narration": "..."},
    {"id": "who", "kind": "card", "act": "pitch", "seconds": 6, "title": "Who it's for", "body": "...", "narration": "..."},
    {"id": "solution", "kind": "card", "act": "pitch", "seconds": 7, "title": "What Orbit does", "body": "...", "narration": "..."},
    {"id": "demo", "kind": "demo", "act": "pitch", "seconds": 10, "title": "See it work", "images": ["assets/demo-1.png", "assets/demo-2.png"], "narration": "..."},
    {"id": "ask", "kind": "card", "act": "pitch", "seconds": 5, "title": "Why it matters", "body": "...", "narration": "..."},
    {"id": "build", "kind": "card", "act": "build", "seconds": 8, "title": "How we built it", "body": "...", "narration": "..."},
    {"id": "step-1", "kind": "step", "seconds": 4, "step": 1, "label": "Open staging", "status": "done", "image": "steps/01-annotated.png", "url": "https://...", "narration": "..."},
    {"id": "step-4", "kind": "step", "seconds": 6, "step": 4, "label": "Enter OTP", "status": "failed", "image": "steps/04-annotated.png", "error": "element not found", "narration": "..."},
    {"id": "fix", "kind": "card", "seconds": 6, "title": "The fix", "body": "...", "narration": "..."},
    {"id": "verdict", "kind": "verdict", "seconds": 6, "status": "passed", "totals": {"steps": 9, "passed": 9, "failed": 0, "duration": "41s"}, "narration": "..."},
    {"id": "outro", "kind": "outro", "seconds": 7, "links": ["https://kaneclihack.sh/ship/orbit", "https://kaneclihack.sh/ship/orbit/deck"], "credits": "...", "narration": "..."}
  ]
}
```

`evidence_to_storyboard.py` writes this with drafted narration. Edit the narration lines by hand (or with the brief) before TTS; each should be 12 to 22 words so it fits the scene length at a natural pace. The TTS script writes `audio/<scene-id>.mp3` and updates each scene's `seconds` to the audio length plus 0.6s padding, so narration length drives timing.

## Scene plan: three acts

The video is a pitch first and a test story second. A viewer who stops at 30 seconds should know what the product is, who it is for and why they would want it. Tooling only appears after that. Each scene carries an `act` tag (`pitch`, `build`, `proof`, `close`) and both renderers print a small act label in the corner.

### Act 1: the pitch (35 to 40s)

Shark Tank structure: hook, problem, customer, product, demo, why it matters. No mention of OpenAI or Kane CLI yet.

1. Cold open (5s): project name over the hero screenshot. Narration is a hook, not a description. "Every Friday someone at your company deploys without clicking through staging. Orbit does the clicking."
2. The problem (7s): one scene a real person has lived, with how often it happens and what it costs.
3. Who it's for (6s): the person who would pay, named by role, and what they do today instead.
4. What it does (7s): the product in three short lines, outcome first.
5. See it work (10s): `demo` scene. Two or three screenshots or frames from a screen recording side by side, animated in. Narration walks what the user sees, not what the code does.
6. Why it matters (5s): the before and after in one line. This is the "ask" moment: what changes for the customer.

### Act 2: how we built it (8 to 10s)

7. How we built it (8s): architecture in one breath, model and API named, one decision the team made. "GPT-5 reads the diff and writes the checklist. We kept it to one call so it fits in the deploy hook."

### Act 3: how effectively we used Kane CLI (25 to 35s)

8. Objective (7s): "Then we told Kane CLI what to prove" with the real objective string from `test.md`.
9. Failed run steps (3.5s each, failed step 6s): annotated screenshots with a zoom toward the element rect from `step.json`; the error line from `failure.yaml` on the failed step.
10. The fix (6s): what changed, one sentence or one line of code.
11. Passing run (3 steps at 3.5s): the same flow going green.
12. Verdict (6s): totals from `run.yaml`, the evidence pack command.

### Close (7s)

13. Outro: both URLs, team, "Built with OpenAI. Tested with Kane CLI."

Keep total under 90s; the pitch act must not be cut to make room for more Kane steps. If the pack has many steps, show the first two, the failed one, and the last two, with a "+N steps" chip. Judges and viewers remember the problem and the failed-then-fixed run, not step seven.

### Narration voice for the pitch act

Second person, present tense, concrete. Say the customer's job title. Say a number (minutes lost, times per week, dollars). Say what the product does before saying how. No "AI-powered", no "revolutionary", no "seamless". Read `humanize.md` before writing these lines.

## Voice-over (`scripts/tts.py`)

Provider order, first available wins:

1. OpenAI TTS (`OPENAI_API_KEY` set): model `gpt-4o-mini-tts`, voice `alloy` or the one in `--voice`. Fits the "built with OpenAI" story and the user likely has credits from the event.
2. `edge-tts` (pip): free, decent neural voices, needs network.
3. macOS `say` + `ffmpeg` to mp3: offline fallback.

Pass `--voice-notes "<how the author talks>"` to add a short style instruction to the OpenAI request. Keep narration conversational: contractions, no marketing adjectives. Read every line out loud once before rendering.

## Rendering

### Remotion (preferred)

`scripts/remotion/` is a minimal Remotion project. `render.sh <launch/video dir>` copies `storyboard.json`, `assets/`, `steps/` and `audio/` into `public/`, installs deps if needed, and runs `npx remotion render Showcase out/showcase.mp4`. Composition duration is computed from the storyboard. Scenes are React components in `src/Showcase.tsx`; the step scene uses `step.json` element rect for the zoom target when present.

Vertical cut: `render.sh <dir> --vertical` renders `ShowcaseVertical` at 1080x1920 with the same storyboard (step screenshots are cropped to the highlighted element).

Requirements: Node 18+, Chromium (Remotion downloads its own if missing). First install takes a couple of minutes.

### ffmpeg fallback (`scripts/render_ffmpeg.py`)

No Node. Builds each scene as a PNG with Pillow (title cards, step frames with the screenshot letterboxed and a status pill), concatenates with the per-scene audio using ffmpeg, adds 0.4s crossfades, outputs H.264 MP4 with AAC audio. Lower polish, same content. Use it when Remotion install fails or the machine is locked down.

## Captions

Both renderers burn the narration line as a lower-third caption when `"captions": true` is set in the storyboard. Keep it on for social: most autoplay is muted. Also write `launch/video/showcase.srt` from the storyboard timings for upload to LinkedIn and X.

## Checklist before upload

- Under 90s, 1920x1080, H.264, AAC, under 50 MB for X.
- Every screenshot is from the pack. Every number matches `run.yaml`.
- Both URLs legible on the outro for at least 5 seconds.
- Captions on. Audio peaks around -3 dBFS (`tts.py` normalises).
- Watch it once with sound off. If the story still makes sense, ship it.
