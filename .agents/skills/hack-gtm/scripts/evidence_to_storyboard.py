#!/usr/bin/env python3
"""
Turn one or two Kane CLI .evidence packs into a video storyboard.

Usage:
  evidence_to_storyboard.py <pass.evidence> [--fail <fail.evidence>] [--brief launch/brief.md] --out launch/video/

Writes:
  <out>/storyboard.json   scenes with drafted narration (edit before TTS)
  <out>/steps/NN-*.png    annotated (or plain) screenshots copied out of the pack(s)
  <out>/pack-summary.json what was read, for the blog's Kane CLI section

Only the standard library plus PyYAML if present (falls back to a tiny YAML reader).
"""
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None


def load_yaml(path: Path):
    text = path.read_text(errors="replace")
    if yaml:
        try:
            return yaml.safe_load(text) or {}
        except Exception:
            pass
    # minimal "key: value" reader for flat manifests
    out = {}
    for line in text.splitlines():
        m = re.match(r"^\s*([A-Za-z0-9_\-]+)\s*:\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def extract(pack: Path) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="evidence-"))
    with zipfile.ZipFile(pack) as z:
        z.extractall(tmp)
    return tmp


def read_pack(root: Path, tag: str, steps_out: Path):
    run = load_yaml(root / "run.yaml") if (root / "run.yaml").exists() else {}
    tests_dir = root / "tests"
    tests = []
    if tests_dir.exists():
        for tdir in sorted(p for p in tests_dir.iterdir() if p.is_dir()):
            result = load_yaml(tdir / "result.yaml") if (tdir / "result.yaml").exists() else {}
            objective = ""
            tmd = tdir / "test.md"
            if tmd.exists():
                objective = tmd.read_text(errors="replace").strip()
            steps = []
            sdir = tdir / "steps"
            if sdir.exists():
                for i, step_dir in enumerate(sorted(p for p in sdir.iterdir() if p.is_dir()), start=1):
                    meta = {}
                    sj = step_dir / "step.json"
                    if sj.exists():
                        try:
                            meta = json.loads(sj.read_text(errors="replace"))
                        except Exception:
                            meta = {}
                    failure = {}
                    fy = step_dir / "failure.yaml"
                    if fy.exists():
                        failure = load_yaml(fy)
                    shot = step_dir / "annotated.png"
                    if not shot.exists():
                        shot = step_dir / "screenshot.png"
                    dest = None
                    if shot.exists():
                        dest = steps_out / f"{tag}-{i:02d}-{step_dir.name}.png"
                        shutil.copy(shot, dest)
                    status = str(meta.get("status") or ("failed" if failure else "done")).lower()
                    steps.append({
                        "ordinal": i,
                        "dir": step_dir.name,
                        "label": meta.get("title") or meta.get("kind") or meta.get("action") or step_dir.name,
                        "kind": meta.get("kind"),
                        "status": status,
                        "duration": meta.get("duration") or meta.get("duration_ms"),
                        "url": meta.get("url"),
                        "rect": meta.get("element_rect") or meta.get("rect") or meta.get("elementRect"),
                        "error": failure.get("error") or failure.get("message"),
                        "image": str(dest.relative_to(steps_out.parent)) if dest else None,
                    })
            tests.append({
                "id": tdir.name,
                "verdict": result.get("verdict") or result.get("status"),
                "objective": objective,
                "environment": result.get("environment"),
                "steps": steps,
            })
    return {"tag": tag, "run": run, "tests": tests}


def words(s: str, n: int) -> str:
    return " ".join(str(s).split()[:n])


def pick_steps(steps, head=1, tail=1, keep_failed=True):
    """Keep the first `head`, the failed step (if any), and the last `tail` steps, in order."""
    if len(steps) <= head + tail + 1:
        return steps, 0
    chosen = list(steps[:head])
    if keep_failed:
        chosen += [s for s in steps if s["status"] in ("failed", "broken")][:1]
    chosen += steps[-tail:] if tail else []
    seen, out = set(), []
    for s in chosen:
        if s["ordinal"] not in seen:
            seen.add(s["ordinal"])
            out.append(s)
    out.sort(key=lambda s: s["ordinal"])
    return out, len(steps) - len(out)


def build_storyboard(brief: dict, passed: dict, failed: dict | None):
    project = brief.get("project", "Our project")
    pitch = brief.get("pitch", "")
    demo_images = [p.strip() for p in brief.get("demo", "").split(",") if p.strip()]

    # ACT 1: the pitch. Product first, like a Shark Tank open. No tooling yet.
    scenes = [
        {"id": "open", "kind": "title", "act": "pitch", "seconds": 5, "title": project, "subtitle": pitch,
         "image": brief.get("hero"),
         "narration": brief.get("hook") or f"TODO narration: a one-line hook for {project}. {pitch}"},
        {"id": "problem", "kind": "card", "act": "pitch", "seconds": 7, "title": "The problem",
         "body": brief.get("problem", "TODO: one sentence"),
         "narration": brief.get("problem", "TODO narration: the problem, with who feels it and how often.")},
        {"id": "who", "kind": "card", "act": "pitch", "seconds": 6, "title": "Who it's for",
         "body": brief.get("who", "TODO: the person who would pay for this"),
         "narration": brief.get("who", "TODO narration: who it is for and what they do today instead.")},
        {"id": "solution", "kind": "card", "act": "pitch", "seconds": 7, "title": f"What {project} does",
         "body": brief.get("solution", "TODO: what it does in three short lines"),
         "narration": brief.get("solution", "TODO narration: what the product does, in plain words.")},
        {"id": "demo", "kind": "demo", "act": "pitch", "seconds": 10, "title": "See it work",
         "images": demo_images or ([brief["hero"]] if brief.get("hero") else []),
         "narration": brief.get("demo_narration", "TODO narration: walk through the demo screens, what the user sees.")},
        {"id": "ask", "kind": "card", "act": "pitch", "seconds": 5, "title": "Why it matters",
         "body": brief.get("why", "TODO: the before/after in one line"),
         "narration": brief.get("why", "TODO narration: the before and after, the thing that changes for the user.")},
    ]

    # ACT 2: how it was built. OpenAI layer, in plain words.
    scenes.append({"id": "build", "kind": "card", "act": "build", "seconds": 8, "title": "How we built it",
                   "body": brief.get("openai", "TODO: model, API, role"),
                   "narration": brief.get("openai_narration", "TODO narration: what the OpenAI layer does, model named, one decision.")})

    # ACT 3: how effectively Kane CLI was used. Real steps, real screenshots, real verdict.
    objective = ""
    if passed["tests"]:
        objective = passed["tests"][0].get("objective", "")
    scenes.append({"id": "objective", "kind": "card", "act": "proof", "seconds": 7, "title": "Then we told Kane CLI what to prove",
                   "body": words(objective, 40) or "TODO: paste the kane-cli run objective",
                   "mono": True,
                   "narration": "We described the flow in plain English and Kane CLI drove a real Chrome."})

    # failed run first, if provided
    if failed and failed["tests"]:
        fsteps = failed["tests"][0]["steps"]
        shown, hidden = pick_steps(fsteps, head=1, tail=0)  # first step, then the failure
        for s in shown:
            is_fail = s["status"] in ("failed", "broken")
            scenes.append({
                "id": f"fail-step-{s['ordinal']}", "kind": "step", "act": "proof", "run": "failed",
                "seconds": 6 if is_fail else 3.5, "step": s["ordinal"], "label": s["label"],
                "status": s["status"], "image": s["image"], "url": s["url"], "rect": s["rect"],
                "error": s["error"],
                "narration": (f"Step {s['ordinal']} failed: {words(s['error'] or 'the element was not found', 14)}."
                              if is_fail else f"Step {s['ordinal']}, {words(s['label'], 6)}."),
            })
        if hidden:
            scenes[-1]["hidden_steps"] = hidden
        scenes.append({"id": "fix", "kind": "card", "act": "proof", "seconds": 6, "title": "The fix",
                       "body": brief.get("fix", "TODO: what changed"),
                       "narration": brief.get("fix", "TODO narration: what we changed after the failed run.")})

    psteps = passed["tests"][0]["steps"] if passed["tests"] else []
    shown, hidden = pick_steps(psteps, head=1, tail=1) if failed else pick_steps(psteps, head=2, tail=2)
    for s in shown:
        scenes.append({
            "id": f"pass-step-{s['ordinal']}", "kind": "step", "act": "proof", "run": "passed",
            "seconds": 3.5, "step": s["ordinal"], "label": s["label"], "status": s["status"],
            "image": s["image"], "url": s["url"], "rect": s["rect"],
            "narration": f"Step {s['ordinal']}, {words(s['label'], 6)}.",
        })
    if hidden and scenes:
        scenes[-1]["hidden_steps"] = hidden

    run = passed["run"]
    totals = {
        "steps": len(psteps),
        "passed": sum(1 for s in psteps if s["status"] in ("done", "passed")),
        "failed": sum(1 for s in psteps if s["status"] in ("failed", "broken")),
        "duration": run.get("duration") or run.get("ended") or "",
        "status": run.get("status") or (passed["tests"][0].get("verdict") if passed["tests"] else ""),
    }
    scenes.append({"id": "verdict", "kind": "verdict", "act": "proof", "seconds": 6, "status": str(totals["status"]).lower(),
                   "totals": totals, "title": run.get("title", ""),
                   "narration": f"The run passed. {totals['steps']} steps, sealed into one evidence pack anyone can open."})
    scenes.append({"id": "outro", "kind": "outro", "act": "close", "seconds": 7,
                   "links": [brief.get("ship_url", "TODO ship page"), brief.get("deck_url", "TODO deck url")],
                   "credits": brief.get("credits", "Built with OpenAI. Tested with Kane CLI."),
                   "narration": f"{project}. Built with OpenAI, tested with Kane CLI. Links in the post."})
    return {
        "project": project, "pitch": pitch, "fps": 30, "width": 1920, "height": 1080, "captions": True,
        "brand": {"accent": "#7CF2C4", "bg": "#0B0F14", "credit": "Built with OpenAI. Tested with Kane CLI."},
        "scenes": scenes,
    }


def read_brief(path: Path | None) -> dict:
    """Very light parser: lines like `key: value` in launch/brief.md become fields."""
    if not path or not path.exists():
        return {}
    out = {}
    for line in path.read_text(errors="replace").splitlines():
        m = re.match(r"^\s*[-*]?\s*(project|pitch|hook|problem|who|solution|demo|demo_narration|why|openai|openai_narration|fix|hero|ship_url|deck_url|credits)\s*:\s*(.+)$", line, re.I)
        if m:
            out[m.group(1).lower()] = m.group(2).strip()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("passed", help="sealed .evidence pack of the passing run")
    ap.add_argument("--fail", help="sealed .evidence pack of an earlier failed run")
    ap.add_argument("--brief", help="launch/brief.md with key: value lines")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    out = Path(a.out)
    steps_out = out / "steps"
    steps_out.mkdir(parents=True, exist_ok=True)
    (out / "assets").mkdir(exist_ok=True)
    (out / "audio").mkdir(exist_ok=True)

    passed_root = extract(Path(a.passed))
    passed = read_pack(passed_root, "pass", steps_out)
    failed = None
    if a.fail:
        failed = read_pack(extract(Path(a.fail)), "fail", steps_out)

    brief = read_brief(Path(a.brief) if a.brief else None)
    sb = build_storyboard(brief, passed, failed)
    (out / "storyboard.json").write_text(json.dumps(sb, indent=2))
    (out / "pack-summary.json").write_text(json.dumps({"passed": passed, "failed": failed}, indent=2, default=str))

    n_todo = sum(1 for s in sb["scenes"] if "TODO" in json.dumps(s))
    print(f"storyboard: {out/'storyboard.json'}  scenes={len(sb['scenes'])}  TODO narration lines={n_todo}")
    print(f"screenshots copied: {len(list(steps_out.glob('*.png')))}")
    print("next: edit narration, then scripts/tts.py")


if __name__ == "__main__":
    sys.exit(main())
