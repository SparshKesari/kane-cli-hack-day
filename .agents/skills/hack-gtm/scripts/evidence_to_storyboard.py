#!/usr/bin/env python3
"""
Turn one or two Kane CLI .evidence packs into a video storyboard.

Usage:
  evidence_to_storyboard.py <pass.evidence> [--fail <fail.evidence>] [--brief launch/brief.md] --out launch/video/

Writes:
  <out>/storyboard.json   scenes with drafted narration (edit before TTS)
  <out>/steps/NN-*.png    screenshots, only with --include-screenshots after visual review
  <out>/pack-summary.json what was read, for the blog's Kane CLI section

Only the standard library plus PyYAML if present (falls back to a tiny YAML reader).
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, urlunsplit

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None

SECRET_KEYS = r"password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|session|auth|cookie"
KANE_TOKEN = r"\bkhk_[A-Za-z0-9_-]+"
LONG_TOKEN = r"(?<![A-Za-z0-9_+/-])[A-Za-z0-9_+/-]{32,}={0,2}(?![A-Za-z0-9_+/-])"


def redact(text: str) -> str:
    """Remove credentials and private URL components before publishing text."""
    text = str(text)
    secrets = {os.environ.get(name, "") for name in (
        "OPENAI_API_KEY", "KANEHACK_TOKEN", "TESTMU_ACCESS_KEY", "LT_ACCESS_KEY",
    )}
    for secret in sorted(filter(None, secrets), key=len, reverse=True):
        text = text.replace(secret, "[redacted]")

    # Protect URL authorities from the JWT pattern (a.b.test is also three
    # base64url segments), but apply the same redaction to their paths.
    urls = []

    def public_url(match):
        raw = re.split(r"[?#]", match.group(0), maxsplit=1)[0]
        try:
            parts = urlsplit(raw)
            host = parts.netloc.rsplit("@", 1)[-1]  # remove URL user/password
            clean_host = re.sub(KANE_TOKEN, "[redacted]", host, flags=re.I)
            clean_host = re.sub(LONG_TOKEN, "[redacted]", clean_host)
            url = "[redacted]" if clean_host != host else urlunsplit((parts.scheme, host, redact(parts.path), "", ""))
        except ValueError:
            url = "[redacted]"
        urls.append(url)
        return f"\u27e6url-{len(urls) - 1}\u27e7"

    text = re.sub(r"\b[a-z][a-z0-9+.-]*://[^\s<>\"')]+", public_url, text, flags=re.I)
    text = re.sub(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", r"\1 [redacted]", text, flags=re.I)
    text = re.sub(KANE_TOKEN, "[redacted]", text, flags=re.I)
    text = re.sub(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+",
                  "[redacted]", text)
    text = re.sub(r"(?<![\w.-])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?![\w-])",
                  "[redacted]", text)
    assignment = re.compile(
        r"(?P<prefix>(?<![\w-])[\"']?(?:" + SECRET_KEYS + r")[\"']?\s*[:=]\s*)"
        r"(?P<value>\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|\[redacted\]|[^\s,}\]&][^\r\n,}\]&]*)", re.I)

    def hide_value(match):
        value = match.group("value")
        quote = value[0] if value.startswith(('"', "'")) else ""
        return match.group("prefix") + quote + "[redacted]" + quote

    text = assignment.sub(hide_value, text)
    text = re.sub(LONG_TOKEN, "[redacted]", text)
    for i, url in enumerate(urls):
        text = text.replace(f"\u27e6url-{i}\u27e7", url)
    return text


def redact_data(value):
    """Use the same policy for every string in a storyboard or summary."""
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {redact(str(k)): "[redacted]" if re.fullmatch(SECRET_KEYS, str(k), re.I) else redact_data(v)
                for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_data(v) for v in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact(str(value))


def load_yaml(path: Path):
    text = path.read_text(encoding="utf-8", errors="replace")
    if yaml:
        try:
            loaded = yaml.safe_load(text)
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass
    # Minimal root-level "key: value" reader for flat manifests. Nested metadata
    # must never overwrite the run's real status when PyYAML is unavailable.
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z0-9_\-]+)\s*:\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


@contextmanager
def extract(pack: Path, include_screenshots=False):
    with tempfile.TemporaryDirectory(prefix="evidence-") as tmp:
        with zipfile.ZipFile(pack) as z:
            # Logs and other raw artifacts are not inputs to the video. Do not
            # even unpack them; only read the small, known metadata files.
            for member in z.infolist():
                parts = PurePosixPath(member.filename).parts
                if member.is_dir() or any(p in ("..", "/") or "\\" in p for p in parts):
                    continue
                keep = parts in (("run.yaml",), ("failure.yaml",))
                if len(parts) == 3 and parts[0] == "tests":
                    keep = parts[2] in ("test.md", "result.yaml")
                if len(parts) == 5 and parts[0] == "tests" and parts[2] == "steps":
                    keep = parts[4] in ("step.json", "failure.yaml") or (
                        include_screenshots and parts[4] in ("annotated.png", "screenshot.png"))
                if keep:
                    z.extract(member, tmp)
        yield Path(tmp)


def read_pack(root: Path, tag: str, steps_out: Path, include_screenshots=False):
    raw_run = load_yaml(root / "run.yaml") if (root / "run.yaml").exists() else {}
    # Only retain fields used by the video. Never export the manifest or logs.
    run = {"title": redact(str(raw_run.get("title") or "")),
           "status": redact(str(raw_run.get("status") or "")).strip().lower(),
           "duration": redact(str(raw_run.get("duration") or raw_run.get("ended") or ""))}
    run_failure = load_yaml(root / "failure.yaml") if (root / "failure.yaml").exists() else {}
    run["error"] = redact(str(run_failure.get("error") or run_failure.get("message") or ""))
    tests_dir = root / "tests"
    tests = []
    if tests_dir.exists():
        ordinal = 0
        for test_index, tdir in enumerate(sorted(p for p in tests_dir.iterdir() if p.is_dir()), start=1):
            result = load_yaml(tdir / "result.yaml") if (tdir / "result.yaml").exists() else {}
            objective = ""
            tmd = tdir / "test.md"
            if tmd.exists():
                objective = words(redact(tmd.read_text(encoding="utf-8", errors="replace").strip()), 40)
            steps = []
            sdir = tdir / "steps"
            if sdir.exists():
                for i, step_dir in enumerate(sorted(p for p in sdir.iterdir() if p.is_dir()), start=1):
                    meta = {}
                    sj = step_dir / "step.json"
                    if sj.exists():
                        try:
                            meta = json.loads(sj.read_text(encoding="utf-8", errors="replace"))
                            if not isinstance(meta, dict):
                                meta = {}
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
                    if include_screenshots and shot.exists():
                        # Pack identifiers can contain secrets too; use generated names.
                        dest = steps_out / f"{tag}-{test_index:02d}-{i:02d}.png"
                        shutil.copy(shot, dest)
                    status = str(meta.get("status") or ("failed" if failure else "done")).strip().lower()
                    rect = meta.get("element_rect") or meta.get("rect") or meta.get("elementRect")
                    if isinstance(rect, dict):
                        rect = [rect.get(k) for k in ("x", "y", "width", "height")]
                    if not isinstance(rect, list) or len(rect) < 4 or not all(isinstance(v, (int, float)) for v in rect[:4]):
                        rect = None
                    else:
                        rect = rect[:4]
                    error = failure.get("error") or failure.get("message") or meta.get("error")
                    ordinal += 1
                    steps.append({
                        "ordinal": ordinal,
                        "label": str(meta.get("title") or meta.get("kind") or meta.get("action") or step_dir.name),
                        "status": status,
                        "url": str(meta["url"]) if meta.get("url") else None,
                        "rect": rect,
                        "error": str(error) if error else None,
                        "image": dest.relative_to(steps_out.parent).as_posix() if dest else None,
                    })
            tests.append({
                "verdict": str(result.get("verdict") or result.get("status") or "").strip().lower(),
                "objective": objective,
                "error": str(result.get("error") or result.get("message") or ""),
                "steps": steps,
            })
    return redact_data({"run": run, "tests": tests})


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
    brief = redact_data(brief)
    passed = redact_data(passed)
    failed = redact_data(failed) if failed else None
    project = brief.get("project", "Our project")
    pitch = brief.get("pitch", "")
    demo_images = [Path(p.strip()).as_posix().replace("\\", "/")
                   for p in brief.get("demo", "").split(",") if p.strip()]
    if brief.get("hero"):
        brief["hero"] = Path(brief["hero"]).as_posix().replace("\\", "/")

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

    psteps = [s for test in passed["tests"] for s in test["steps"]]
    run = passed["run"]
    status = str(run.get("status") or (passed["tests"][0].get("verdict") if passed["tests"] else "") or "").strip().lower()
    bad_step = next((s for s in psteps if s["status"] in ("failed", "broken", "error")), None)
    bad_test = next((test for test in passed["tests"]
                     if test.get("verdict") and str(test["verdict"]).strip().lower() != "passed"), None)
    if bad_step or bad_test or run.get("error"):
        status = "failed"
    shown, hidden = pick_steps(psteps, head=1, tail=1) if failed else pick_steps(psteps, head=2, tail=2)
    for s in shown:
        scenes.append({
            "id": f"pass-step-{s['ordinal']}", "kind": "step", "act": "proof", "run": status,
            "seconds": 3.5, "step": s["ordinal"], "label": s["label"], "status": s["status"],
            "image": s["image"], "url": s["url"], "rect": s["rect"], "error": s["error"],
            "narration": f"Step {s['ordinal']}, {words(s['label'], 6)}.",
        })
    if hidden and scenes:
        scenes[-1]["hidden_steps"] = hidden

    totals = {
        "steps": len(psteps),
        "passed": sum(1 for s in psteps if s["status"] in ("done", "passed")),
        "failed": sum(1 for s in psteps if s["status"] in ("failed", "broken")),
        "duration": run.get("duration") or run.get("ended") or "",
        "status": status,
    }
    if status == "passed":
        narration = f"The run passed. {totals['steps']} steps, sealed into one evidence pack for the judges."
    elif bad_step:
        reason = words(redact(str(bad_step.get("error") or bad_step["label"] or "the step did not complete")), 14)
        narration = f"The run failed on step {bad_step['ordinal']}: {reason.rstrip('.')}. That is the bug Kane caught."
    else:
        reason = words(redact(str(run.get("error") or (bad_test or {}).get("error")
                                  or f"the evidence reports {status or 'no passing status'}")), 14)
        narration = f"The run failed: {reason.rstrip('.')}. Kane did not confirm a passing run."
    scenes.append({"id": "verdict", "kind": "verdict", "act": "proof", "seconds": 6, "status": status,
                   "totals": totals, "title": run.get("title", ""),
                   "narration": narration})
    scenes.append({"id": "outro", "kind": "outro", "act": "close", "seconds": 7,
                   "links": [brief.get("ship_url", "TODO ship page"), brief.get("deck_url", "TODO deck url")],
                   "credits": brief.get("credits", "Built with OpenAI. Tested with Kane CLI."),
                   "narration": f"{project}. Built with OpenAI, tested with Kane CLI. Links in the post."})
    return redact_data({
        "project": project, "pitch": pitch, "fps": 30, "width": 1920, "height": 1080, "captions": True,
        "brand": {"accent": "#7CF2C4", "bg": "#0B0F14", "credit": "Built with OpenAI. Tested with Kane CLI."},
        "scenes": scenes,
    })


def read_brief(path: Path | None) -> dict:
    """Very light parser: lines like `key: value` in launch/brief.md become fields."""
    if not path or not path.exists():
        return {}
    out = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^\s*[-*]?\s*(project|pitch|hook|problem|who|solution|demo|demo_narration|why|openai|openai_narration|fix|hero|ship_url|deck_url|credits)\s*:\s*(.+)$", line, re.I)
        if m:
            out[m.group(1).lower()] = m.group(2).strip()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("passed", nargs="?", help="sealed .evidence pack of the final run")
    ap.add_argument("--pass", dest="passing_pack", help="alias for the positional final pack")
    ap.add_argument("--fail", help="sealed .evidence pack of an earlier failed run")
    ap.add_argument("--brief", help="launch/brief.md with key: value lines")
    ap.add_argument("--out", required=True)
    ap.add_argument("--include-screenshots", action="store_true",
                    help="copy pack screenshots ONLY after visually checking them for secrets; pixels cannot be text-redacted")
    a = ap.parse_args()
    if bool(a.passed) == bool(a.passing_pack):
        ap.error("provide one final pack, either positionally or with --pass")

    out = Path(a.out)
    steps_out = out / "steps"
    steps_out.mkdir(parents=True, exist_ok=True)
    (out / "assets").mkdir(exist_ok=True)
    (out / "audio").mkdir(exist_ok=True)

    with extract(Path(a.passed or a.passing_pack), a.include_screenshots) as passed_root:
        passed = read_pack(passed_root, "pass", steps_out, a.include_screenshots)
    failed = None
    if a.fail:
        with extract(Path(a.fail), a.include_screenshots) as failed_root:
            failed = read_pack(failed_root, "fail", steps_out, a.include_screenshots)

    brief = read_brief(Path(a.brief) if a.brief else None)
    sb = build_storyboard(brief, passed, failed)
    (out / "storyboard.json").write_text(json.dumps(sb, indent=2), encoding="utf-8")
    (out / "pack-summary.json").write_text(json.dumps(redact_data({"passed": passed, "failed": failed}), indent=2), encoding="utf-8")

    n_todo = sum(1 for s in sb["scenes"] if "TODO" in json.dumps(s))
    print(f"storyboard: {out/'storyboard.json'}  scenes={len(sb['scenes'])}  TODO narration lines={n_todo}")
    print(f"screenshots copied: {len(list(steps_out.glob('*.png')))}")
    print("next: edit narration, then scripts/tts.py")


if __name__ == "__main__":
    sys.exit(main())
