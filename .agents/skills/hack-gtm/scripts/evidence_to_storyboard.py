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
from datetime import datetime
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

SECRET_KEYS = r"password|passwd|pwd|credentials?|token|secret|api[_-]?key|access[_-]?key|session|auth|cookie"
KANE_TOKEN = r"\bkhk_[A-Za-z0-9_-]+"
LONG_TOKEN = r"(?<![A-Za-z0-9_+/-])[A-Za-z0-9_+/-]{32,}={0,2}(?![A-Za-z0-9_+/-])"


def hide_long_token(match) -> str:
    """A long run of URL-safe characters is a secret when it looks random: one long chunk, or a
    long mixed-case-and-digit chunk. Paths and slugs ("ship/kestrel-release-checklist-agent-v2",
    "screenshot-dashboard-after-login-final") are short words joined by / - _ . and stay."""
    token = match.group(0)
    chunks = re.split(r"[/_.+-]", token.rstrip("="))
    mixed = re.search(r"[A-Z]", token) and re.search(r"[a-z]", token) and re.search(r"\d", token)
    if any(len(c) >= 20 for c in chunks) or (mixed and any(len(c) >= 12 for c in chunks)):
        return "[redacted]"
    return token
# Credentials as people write them in a run objective or step title: "log in with password
# hunter2", "enter 'Abc123!' in the password field", "OTP 918273".
CREDENTIAL = (r"(?:pass(?:word|wd|code|phrase)|pwd|pin|t?otp|one[- ]time\s+(?:pass)?code"
              r"|(?:verification|security|2fa|mfa|auth(?:entication)?)\s+code)(?![\w-])")
# "the code 123456", "pass Secret99": only as the word before a value ("code editor" stays).
LOOSE_CREDENTIAL = r"(?:pass|code)(?![\w-])"
QUOTES = "\"'`\u201c\u2018"
QUOTED = r"\"[^\"\n]*\"|'[^'\n]*'|`[^`\n]*`|\u201c[^\u201d\n]*\u201d|\u2018[^\u2019\n]*\u2019"
SPOKEN_AFTER = re.compile(
    r"(?P<prefix>(?<![\w-])(?:" + CREDENTIAL + "|(?P<loose>" + LOOSE_CREDENTIAL + r"))(?:\s+(?:field|input|box))?"
    r"(?:\s*[:=]|\s+(?:is|as|to|of|with|set\s+to))?\s+)(?P<value>" + QUOTED + r"|[^\s\"'`]\S*)", re.I)
SPOKEN_BEFORE = re.compile(
    r"(?P<value>" + QUOTED + r"|(?<!\S)[^\s\"'`]+)"
    r"(?P<suffix>\s+(?:in|into|as|for)(?:\s+(?:the|your|a))?\s+(?<![\w-])" + CREDENTIAL + ")", re.I)


def hide_spoken(value: str, loose: bool = False) -> str:
    """A quoted value next to a credential word is the credential. A bare one is when it
    looks like one (a digit or a symbol), so "password field" and "pin it" stay readable.
    After a bare "pass" or "code" only a one-time code (4 to 8 digits) or a password-like
    mix of letters and digits counts, so "pass 100% of checks" and "code v2.0" stay."""
    if value[0] in QUOTES:
        return value[0] + "[redacted]" + value[-1]
    lead = value[:len(value) - len(value.lstrip("([{"))]
    core = value[len(lead):].rstrip(".,;:)]}")
    if loose:
        secret = re.fullmatch(r"\d{4,8}", core) or (
            len(core) >= 6 and re.search(r"[A-Za-z]", core) and re.search(r"\d", core)
            and not re.fullmatch(r"v?\d+(\.\d+)+", core, re.I))
    else:
        secret = len(core) >= 4 and re.search(r"[\d_!@#$%^&*+=?~]", core)
    if secret:
        return lead + "[redacted]" + value[len(lead) + len(core):]
    return value


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
            clean_host = re.sub(LONG_TOKEN, hide_long_token, clean_host)
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
    text = SPOKEN_AFTER.sub(lambda m: m.group("prefix") + hide_spoken(m.group("value"), bool(m.group("loose"))), text)
    text = SPOKEN_BEFORE.sub(lambda m: hide_spoken(m.group("value")) + m.group("suffix"), text)
    text = re.sub(LONG_TOKEN, hide_long_token, text)
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


def _scalar(v: str):
    v = v.strip()
    if v[:1] not in ("'", '"'):
        v = re.sub(r"\s+#.*$", "", v)
    if v in ("", "~", "null", "Null", "NULL"):
        return None
    if v in ("true", "True", "TRUE", "false", "False", "FALSE"):
        return v.lower() == "true"
    if len(v) >= 2 and v[0] == v[-1] == '"':
        try:
            return json.loads(v)
        except ValueError:
            return v[1:-1]
    if len(v) >= 2 and v[0] == v[-1] == "'":
        return v[1:-1].replace("''", "'")
    if v == "[]":
        return []
    if v == "{}":
        return {}
    if v.startswith("[") and v.endswith("]"):
        return [_scalar(x) for x in v[1:-1].split(",") if x.strip()]
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d+", v):
        return float(v)
    return v


YAML_KEY = re.compile(r"""^(?P<k>"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(?P<v>.*))?$""")


class _Yaml:
    """Block-style YAML as evidence packs use it: nested mappings, lists of mappings, plain and
    quoted scalars, and | / > text blocks. Enough for run.yaml, result.yaml and failure.yaml."""

    def __init__(self, text: str):
        self.lines = text.replace("\t", "  ").splitlines()
        self.i = 0

    @staticmethod
    def indent(line: str) -> int:
        return len(line) - len(line.lstrip(" "))

    def skip(self):
        while self.i < len(self.lines) and (not self.lines[self.i].strip() or self.lines[self.i].lstrip().startswith("#")
                                            or self.lines[self.i].strip() in ("---", "...")):
            self.i += 1

    def node(self, indent: int):
        self.skip()
        if self.i >= len(self.lines) or self.indent(self.lines[self.i]) < indent:
            return None
        here = self.indent(self.lines[self.i])
        content = self.lines[self.i].strip()
        return self.seq(here) if content == "-" or content.startswith("- ") else self.map(here)

    def value(self, rest: str, indent: int):
        style = rest.strip()
        if style in ("|", "|-", "|+", ">", ">-", ">+"):
            return self.block(indent, style)
        if style and not style.startswith("#"):
            return _scalar(rest)
        self.skip()
        if self.i < len(self.lines):
            nxt, content = self.indent(self.lines[self.i]), self.lines[self.i].strip()
            if nxt > indent or (nxt == indent and (content == "-" or content.startswith("- "))):
                return self.node(nxt)
        return None

    def map(self, indent: int) -> dict:
        out = {}
        while True:
            self.skip()
            if self.i >= len(self.lines) or self.indent(self.lines[self.i]) != indent:
                return out
            content = self.lines[self.i].strip()
            m = YAML_KEY.match(content)
            if content == "-" or content.startswith("- ") or not m:
                return out
            self.i += 1
            out[str(_scalar(m.group("k")))] = self.value(m.group("v") or "", indent)

    def seq(self, indent: int) -> list:
        out = []
        while True:
            self.skip()
            if self.i >= len(self.lines):
                return out
            line = self.lines[self.i]
            content = line.strip()
            if self.indent(line) != indent or not (content == "-" or content.startswith("- ")):
                return out
            item = content[1:].strip()
            if not item:
                self.i += 1
                out.append(self.node(indent + 1))
            elif YAML_KEY.match(item) and item[0] not in "[{":
                # "- key: value" opens a mapping whose keys line up with "key".
                col = indent + len(content) - len(item)
                self.lines[self.i] = " " * col + item
                out.append(self.map(col))
            else:
                self.i += 1
                out.append(_scalar(item))

    def block(self, indent: int, style: str) -> str:
        lines = []
        while self.i < len(self.lines) and (not self.lines[self.i].strip() or self.indent(self.lines[self.i]) > indent):
            lines.append(self.lines[self.i])
            self.i += 1
        while lines and not lines[-1].strip():
            lines.pop()
        cut = min((self.indent(l) for l in lines if l.strip()), default=0)
        body = [l[cut:] for l in lines]
        text = "\n".join(body) if style[0] == "|" else re.sub(r"(?<!\n)\n(?!\n)", " ", "\n".join(body))
        return text if style.endswith("-") else text + "\n"


def parse_yaml(text: str):
    return _Yaml(text).node(0)


def load_yaml(path: Path):
    text = path.read_text(encoding="utf-8", errors="replace")
    if yaml:
        try:
            loaded = yaml.safe_load(text)
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass
    try:
        loaded = parse_yaml(text)
    except Exception:  # pragma: no cover - malformed manifest
        loaded = None
    return loaded if isinstance(loaded, dict) else {}


SHOT = re.compile(r"(annotated|screenshot)\.(png|jpe?g|webp)", re.I)


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
                    keep = parts[4] in ("step.json", "failure.yaml") or bool(
                        include_screenshots and SHOT.fullmatch(parts[4]))
                if keep:
                    z.extract(member, tmp)
        yield Path(tmp)


PASS = {"passed", "pass", "success", "succeeded", "ok", "done"}
FAIL = {"failed", "fail", "broken", "error", "errored", "aborted"}


def run_verdict(raw_run: dict) -> str:
    """passed, failed, or "" when the pack doesn't say. In Kane CLI's packs run.yaml's status is
    the pack's lifecycle (running, finalized, aborted) and the outcome is in totals."""
    status = str(raw_run.get("status") or "").strip().lower()
    totals = raw_run.get("totals") if isinstance(raw_run.get("totals"), dict) else {}
    if status in PASS or status in FAIL:
        return "passed" if status in PASS else "failed"
    count = lambda k: int(totals.get(k) or 0) if str(totals.get(k) or 0).isdigit() else 0
    if count("failed") or count("broken"):
        return "failed"
    if status in ("finalized", "completed", "complete") and count("passed"):
        return "passed"
    return ""


def when(value):
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def seconds_text(total: float) -> str:
    total = int(round(total))
    return f"{total}s" if total < 60 else f"{total // 60}m {total % 60:02d}s"


def run_duration(raw_run: dict, results: list) -> str:
    if raw_run.get("duration"):
        return str(raw_run["duration"])
    started, ended = when(raw_run.get("started")), when(raw_run.get("ended"))
    if started and ended and ended >= started:
        return seconds_text((ended - started).total_seconds())
    ms = sum(float(r.get("duration_ms") or 0) for r in results if isinstance(r, dict))
    return seconds_text(ms / 1000) if ms else ""


def failure_text(failure: dict, step: dict) -> str | None:
    """The short reason a step failed: the record's title, its error message, or expected/actual."""
    error = failure.get("error")
    message = error.get("message") if isinstance(error, dict) else error
    expected = failure.get("expected") or step.get("expected")
    actual = failure.get("actual") or step.get("actual")
    for text in (failure.get("title"), message, failure.get("message"), step.get("defect"),
                 f"expected {expected}, got {actual}" if expected and actual else None):
        if text and str(text).strip():
            return " ".join(str(text).split())
    return None


def humanize(name: str) -> str:
    text = re.sub(r"[-_]+", " ", str(name)).strip()
    return text[:1].upper() + text[1:]


def step_dirs(sdir: Path, listed: list) -> list:
    """(result.yaml step, folder) in step order. Folders are <ordinal>-<id> with no zero padding, so
    order by the number, never by name (1, 2, 10, not 1, 10, 2)."""
    folders = {}
    for d in sdir.iterdir() if sdir.exists() else []:
        m = re.match(r"^(\d+)-(.+)$", d.name)
        if d.is_dir():
            folders[d.name] = (int(m.group(1)) if m else 0, d)
    if listed:
        rows = []
        for st in sorted((x for x in listed if isinstance(x, dict)), key=lambda x: int(x.get("ordinal") or 0)):
            name = f"{st.get('ordinal')}-{st.get('id')}"
            folder = folders.get(name, (0, None))[1] or next(
                (d for n, d in folders.values() if n == int(st.get("ordinal") or -1)), None)
            rows.append((st, folder))
        return rows
    return [({}, d) for _, d in sorted(folders.values(), key=lambda nd: (nd[0], nd[1].name))]


def objective_text(md: str) -> str:
    md = md.strip()
    if md.startswith("---"):
        parts = md.split("\n---", 1)
        md = parts[1].lstrip("-").strip() if len(parts) == 2 else md
    return md


def read_pack(root: Path, tag: str, steps_out: Path, include_screenshots=False):
    raw_run = load_yaml(root / "run.yaml") if (root / "run.yaml").exists() else {}
    tests_dir = root / "tests"
    test_dirs = sorted(p for p in tests_dir.iterdir() if p.is_dir()) if tests_dir.exists() else []
    results = [load_yaml(t / "result.yaml") if (t / "result.yaml").exists() else {} for t in test_dirs]
    # Only retain fields used by the video. Never export the manifest or logs.
    run = {"title": redact(str(raw_run.get("title") or "")),
           "status": run_verdict(raw_run),
           "duration": redact(run_duration(raw_run, results))}
    run_failure = load_yaml(root / "failure.yaml") if (root / "failure.yaml").exists() else {}
    run["error"] = redact(str(run_failure.get("error") or run_failure.get("message") or ""))
    tests = []
    ordinal = 0
    for test_index, (tdir, result) in enumerate(zip(test_dirs, results), start=1):
        objective = ""
        tmd = tdir / "test.md"
        if tmd.exists():
            objective = clip(redact(objective_text(tmd.read_text(encoding="utf-8", errors="replace"))), 40)
        steps = []
        listed = result.get("steps") if isinstance(result.get("steps"), list) else []
        for i, (st, step_dir) in enumerate(step_dirs(tdir / "steps", listed), start=1):
            meta, failure = {}, {}
            if step_dir and (step_dir / "step.json").exists():
                try:
                    meta = json.loads((step_dir / "step.json").read_text(encoding="utf-8", errors="replace"))
                    meta = meta if isinstance(meta, dict) else {}
                except Exception:
                    meta = {}
            if step_dir and (step_dir / "failure.yaml").exists():
                failure = load_yaml(step_dir / "failure.yaml")
            shots = sorted((f for f in step_dir.iterdir() if SHOT.fullmatch(f.name)), key=lambda f: (not f.name.startswith("annotated"), f.name)) if step_dir else []
            shot = shots[0] if shots else None
            dest = None
            if include_screenshots and shot:
                # Pack identifiers can contain secrets too; use generated names.
                dest = steps_out / f"{tag}-{test_index:02d}-{i:02d}{shot.suffix.lower()}"
                shutil.copy(shot, dest)
            status = str(st.get("status") or meta.get("status") or ("failed" if failure else "done")).strip().lower()
            rect = meta.get("element_rect") or meta.get("rect") or meta.get("elementRect")
            if isinstance(rect, dict):
                rect = [rect.get(k) for k in ("x", "y", "width", "height")]
            if not isinstance(rect, list) or len(rect) < 4 or not all(isinstance(v, (int, float)) for v in rect[:4]):
                rect = None
            else:
                rect = rect[:4]
            label = next((str(meta[k]) for k in ("title", "name", "intent", "instruction", "action_instruction", "description")
                          if meta.get(k)), None) or st.get("title") or (
                f"Check: {st['expected']}" if st.get("expected") else None) or humanize(
                st.get("id") or meta.get("kind") or meta.get("action") or (step_dir.name if step_dir else "step"))
            error = failure_text(failure, st) or (str(meta["error"]) if meta.get("error") else None)
            ordinal += 1
            page = failure.get("page_state") if isinstance(failure.get("page_state"), dict) else {}
            url = meta.get("url") or page.get("url")
            steps.append({
                "ordinal": ordinal,
                "label": str(label),
                "status": status,
                "url": str(url) if url else None,
                "rect": rect,
                "error": error,
                "image": dest.relative_to(steps_out.parent).as_posix() if dest else None,
            })
        tests.append({
            "verdict": str(result.get("status") or result.get("verdict") or "").strip().lower(),
            "objective": objective,
            "error": str(result.get("error") or result.get("message") or ""),
            "steps": steps,
        })
    return redact_data({"run": run, "tests": tests})


FILLER = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is", "of", "on", "or", "the", "to", "with"}
# Text the script drafts for a person to replace. The renderers refuse to put it in a video.
PLACEHOLDER = re.compile(r"\bTODO(?: narration)?:")


def clip(s: str, n: int) -> str:
    """At most n words. A cut ends on a content word and says it was cut."""
    ws = str(s).split()
    if len(ws) <= n:
        return " ".join(ws)
    ws = ws[:n]
    while len(ws) > 1 and ws[-1].lower().strip(",;:") in FILLER:
        ws.pop()
    return " ".join(ws).rstrip(",;:.") + "..."


def sentence(s: str) -> str:
    s = str(s).rstrip()
    return s if s.endswith((".", "!", "?")) else s + "."


def placeholder_scenes(sb: dict) -> list:
    """Ids of the scenes whose on-screen text or narration is still a drafted placeholder."""
    left = [str(s.get("id") or f"scene {i + 1}") for i, s in enumerate(sb.get("scenes") or [])
            if PLACEHOLDER.search(json.dumps(s))]
    left += [k for k, v in sb.items() if k != "scenes" and PLACEHOLDER.search(json.dumps(v))]
    return left


def refuse_placeholders(sb: dict) -> None:
    """Renderers call this first, so a draft never ends up in a published video."""
    left = placeholder_scenes(sb)
    if left:
        sys.exit(f"storyboard still has placeholder text in: {', '.join(left)}. "
                 "Write those scenes in storyboard.json, or delete them, then render again.")


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
    project = brief.get("project") or "TODO: project name"
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
        {"id": "ask", "kind": "card", "act": "pitch", "seconds": 5, "title": "Why it matters",
         "body": brief.get("why", "TODO: the before/after in one line"),
         "narration": brief.get("why", "TODO narration: the before and after, the thing that changes for the user.")},
    ]
    # No screenshots means no demo scene, rather than an empty frame.
    demo_images = demo_images or ([brief["hero"]] if brief.get("hero") else [])
    if demo_images:
        scenes.insert(4, {"id": "demo", "kind": "demo", "act": "pitch", "seconds": 10, "title": "See it work",
                          "images": demo_images,
                          "narration": brief.get("demo_narration", "TODO narration: walk through the demo screens, what the user sees.")})

    # ACT 2: how it was built. OpenAI layer, in plain words.
    scenes.append({"id": "build", "kind": "card", "act": "build", "seconds": 8, "title": "How we built it",
                   "body": brief.get("openai", "TODO: model, API, role"),
                   "narration": brief.get("openai_narration", "TODO narration: what the OpenAI layer does, model named, one decision.")})

    # ACT 3: how effectively Kane CLI was used. Real steps, real screenshots, real verdict.
    objective = ""
    if passed["tests"]:
        objective = passed["tests"][0].get("objective", "")
    scenes.append({"id": "objective", "kind": "card", "act": "proof", "seconds": 7, "title": "Then we told Kane CLI what to prove",
                   "body": objective or "TODO: paste the kane-cli run objective",
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
                "narration": sentence(f"Step {s['ordinal']} failed: {clip(s['error'] or 'the element was not found', 14)}"
                                       if is_fail else f"Step {s['ordinal']}, {clip(s['label'], 12)}"),
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
            "narration": sentence(f"Step {s['ordinal']}, {clip(s['label'], 12)}"),
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
        reason = clip(redact(str(bad_step.get("error") or bad_step["label"] or "the step did not complete")), 14)
        narration = f"The run failed on step {bad_step['ordinal']}: {sentence(reason)} That is the bug Kane caught."
    else:
        reason = clip(redact(str(run.get("error") or (bad_test or {}).get("error")
                                 or f"the evidence reports {status or 'no passing status'}")), 14)
        narration = f"The run failed: {sentence(reason)} Kane did not confirm a passing run."
    scenes.append({"id": "verdict", "kind": "verdict", "act": "proof", "seconds": 6, "status": status,
                   "totals": totals, "title": run.get("title", ""),
                   "narration": narration})
    scenes.append({"id": "outro", "kind": "outro", "act": "close", "seconds": 7,
                   "links": [brief[k] for k in ("ship_url", "deck_url") if brief.get(k)],
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
        # "(one sentence a stranger would stop for)" is the template's hint, not an answer.
        # The first line for a key wins: the key: value block sits at the top, prose ("Fix: ...") below.
        if m and not re.fullmatch(r"\(.*\)", m.group(2).strip()):
            out.setdefault(m.group(1).lower(), m.group(2).strip())
    return out


def stage_images(brief: dict, out: Path, brief_path: Path | None) -> dict:
    """Copy the brief's hero and demo screenshots into <out>/assets, where both renderers look,
    and point the brief at the copies. A path is tried from the project folder, then the brief's
    folder, then the video folder. Missing files are named and left out."""
    def find(raw: str) -> Path | None:
        given = Path(raw.strip()).expanduser()
        bases = [Path.cwd()] + ([brief_path.parent] if brief_path else []) + [out]
        for c in ([given] if given.is_absolute() else [b / given for b in bases]):
            if c.is_file():
                return c
        return None

    staged, missing = dict(brief), []
    demos = []
    for raw in [p for p in brief.get("demo", "").split(",") if p.strip()]:
        src = find(raw)
        if not src:
            missing.append(raw.strip())
            continue
        dest = out / "assets" / f"demo-{len(demos) + 1}{src.suffix.lower()}"
        if src.resolve() != dest.resolve():
            shutil.copy(src, dest)
        demos.append(dest.relative_to(out).as_posix())
    staged["demo"] = ", ".join(demos)
    if brief.get("hero"):
        src = find(brief["hero"])
        if src:
            dest = out / "assets" / f"hero{src.suffix.lower()}"
            if src.resolve() != dest.resolve():
                shutil.copy(src, dest)
            staged["hero"] = dest.relative_to(out).as_posix()
        else:
            missing.append(brief["hero"].strip())
            staged.pop("hero")
    if missing:
        print(f"brief screenshots not found, left out: {', '.join(missing)} (paths are read from the project folder)",
              file=sys.stderr)
    return staged


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
    if a.brief and not Path(a.brief).is_file():
        ap.error(f"brief not found: {a.brief}. Write it from assets/brief-template.md, or leave out --brief to draft placeholders")

    out = Path(a.out)
    steps_out = out / "steps"
    steps_out.mkdir(parents=True, exist_ok=True)
    (out / "assets").mkdir(exist_ok=True)
    (out / "audio").mkdir(exist_ok=True)
    # Screenshots, the pack summary and the drafts are derived from a private pack: never commit them.
    (out / ".gitignore").write_text("*\n", encoding="utf-8")

    with extract(Path(a.passed or a.passing_pack), a.include_screenshots) as passed_root:
        passed = read_pack(passed_root, "pass", steps_out, a.include_screenshots)
    failed = None
    if a.fail:
        with extract(Path(a.fail), a.include_screenshots) as failed_root:
            failed = read_pack(failed_root, "fail", steps_out, a.include_screenshots)

    brief = stage_images(read_brief(Path(a.brief) if a.brief else None), out, Path(a.brief) if a.brief else None)
    sb = build_storyboard(brief, passed, failed)
    (out / "storyboard.json").write_text(json.dumps(sb, indent=2), encoding="utf-8")
    (out / "pack-summary.json").write_text(json.dumps(redact_data({"passed": passed, "failed": failed}), indent=2), encoding="utf-8")

    needed = ["project", "hook", "problem", "who", "solution", "why", "openai", "openai_narration"]
    needed += (["demo_narration"] if any(s["id"] == "demo" for s in sb["scenes"]) else []) + (["fix"] if failed else [])
    missing = [k for k in needed if not brief.get(k)]
    source = a.brief or "no --brief given"
    if missing:
        print(f"brief ({source}) has no {', '.join(missing)}: those scenes are TODO placeholders. Fill the key: value "
              "lines from assets/brief-template.md and rerun, or write the scenes in storyboard.json.", file=sys.stderr)
    if not any(s["id"] == "demo" for s in sb["scenes"]):
        print(f"brief ({source}) has no demo or hero screenshots, so the video has no demo scene.", file=sys.stderr)
    left = placeholder_scenes(sb)
    print(f"storyboard: {out/'storyboard.json'}  scenes={len(sb['scenes'])}")
    print("placeholders left: none" if not left else
          f"placeholders left in {len(left)} scenes: {', '.join(left)}. The renderers refuse them; write them first.")
    print(f"screenshots copied: {len(list(steps_out.glob('*.png')))}")
    print("next: edit narration, then scripts/tts.py")


if __name__ == "__main__":
    sys.exit(main())
