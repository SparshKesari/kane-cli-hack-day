#!/usr/bin/env python3
"""
Voice-over for the storyboard. One mp3 per scene, then scene.seconds is set to
audio length + 0.6s so timing follows the narration. Also writes showcase.srt.

Usage:
  tts.py launch/video/storyboard.json --out launch/video/audio/ [--voice alloy] [--voice-notes "..."] [--provider openai|edge|say]

Without --provider, only macOS `say` is selected automatically.
  say    : macOS `say` + ffmpeg, local
  edge   : requires edge-tts; sends narration text to Microsoft
  openai : requires openai and OPENAI_API_KEY; costs money on your OpenAI account
Needs ffmpeg on PATH for duration probing and loudness normalisation.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # the import below must not leave __pycache__ in the installed skill
from evidence_to_storyboard import PLACEHOLDER, redact, redact_data  # noqa: E402

# Short narration still leaves a scene long enough to take in: screenshots, the verdict, the links.
MIN_SECONDS = {"demo": 6.0, "verdict": 4.0, "outro": 5.0, "title": 4.0}
NO_AUDIO = {
    "say": "macOS `say` wrote an empty file. Inside Codex's sandbox it can't reach the speech service: run this "
           "tts.py command outside the sandbox (approve it when Codex asks), or choose --provider edge.",
}


def have(cmd):
    return shutil.which(cmd) is not None


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def normalise(src: Path):
    tmp = src.with_suffix(".norm.mp3")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
                    "-af", "loudnorm=I=-16:TP=-3:LRA=11", "-ar", "48000", "-ac", "1", str(tmp)], check=True)
    tmp.replace(src)


def tts_openai(text, dest: Path, voice, notes):
    from openai import OpenAI  # pip install openai
    client = OpenAI()
    instructions = "Conversational, unhurried, like a developer narrating their own demo. No hype."
    if notes:
        instructions += " " + notes
    with client.audio.speech.with_streaming_response.create(
        model="gpt-4o-mini-tts", voice=voice or "alloy", input=text,
        instructions=instructions, response_format="mp3",
    ) as r:
        r.stream_to_file(dest)


def tts_edge(text, dest: Path, voice, notes):
    import asyncio
    import edge_tts  # pip install edge-tts
    v = voice if voice and "-" in voice else "en-US-AndrewNeural"
    asyncio.run(edge_tts.Communicate(text, v).save(str(dest)))


def tts_say(text, dest: Path, voice, notes):
    aiff = dest.with_suffix(".aiff")
    cmd = ["say", "-o", str(aiff)]
    if voice:
        cmd += ["-v", voice]
    cmd.append(text)
    subprocess.run(cmd, check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), str(dest)], check=True)
    aiff.unlink(missing_ok=True)


def pick_provider(forced):
    if forced:
        return forced
    if sys.platform == "darwin" and have("say"):
        return "say"
    sys.exit("Choose a TTS provider explicitly: --provider say (local macOS say), "
             "--provider edge (sends narration text to Microsoft), or "
             "--provider openai (costs money on your OpenAI account; requires OPENAI_API_KEY).")


def srt_time(t):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{int((s - int(s)) * 1000):03d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("storyboard")
    ap.add_argument("--out", required=True)
    ap.add_argument("--voice")
    ap.add_argument("--voice-notes", default="")
    ap.add_argument("--provider", choices=["say", "edge", "openai"],
                    help="default: local macOS say if available; edge sends text to Microsoft; openai costs money on your OpenAI account")
    ap.add_argument("--pad", type=float, default=0.6)
    a = ap.parse_args()

    provider = pick_provider(a.provider)
    if provider == "say" and not have("say"):
        sys.exit("--provider say requires macOS say; --provider edge sends text to Microsoft; "
                 "--provider openai costs money on your OpenAI account.")
    if not have("ffmpeg") or not have("ffprobe"):
        sys.exit("ffmpeg and ffprobe are required")
    sb_path = Path(a.storyboard).resolve()
    sb = redact_data(json.loads(sb_path.read_text(encoding="utf-8")))
    out = Path(a.out).resolve()
    if not out.is_relative_to(sb_path.parent):
        ap.error("--out must be within the storyboard directory for video asset paths")
    out.mkdir(parents=True, exist_ok=True)
    fn = {"openai": tts_openai, "edge": tts_edge, "say": tts_say}[provider]
    print(f"provider: {provider}")
    spoken = [s["id"] for s in sb["scenes"] if "[redacted]" in (s.get("narration") or "")]
    if spoken:
        print(f"warning: the voice will say \"redacted\" in: {', '.join(spoken)}. Rewrite those lines without the "
              "secret, then rerun.", file=sys.stderr)

    t = 0.0
    srt = []
    for i, scene in enumerate(sb["scenes"], start=1):
        text = (scene.get("narration") or "").strip()
        if not text or PLACEHOLDER.search(text):
            print(f"  skip {scene['id']}: narration missing or still a TODO placeholder")
            scene.pop("audio", None)  # an earlier take must not play under new, unvoiced narration
            t += float(scene.get("seconds", 4))
            continue
        dest = out / f"{i:02d}.mp3"
        try:
            fn(text, dest, a.voice, redact(a.voice_notes))
        except Exception as exc:
            # Provider errors can echo credentials; never expose a raw traceback.
            sys.exit(f"TTS provider {provider} failed: {redact(str(exc))}")
        if duration(dest) <= 0:
            sys.exit(f"no audio for scene {scene['id']}: " + NO_AUDIO.get(provider, f"{provider} returned an empty file."))
        try:
            normalise(dest)
        except subprocess.CalledProcessError:
            sys.exit(f"ffmpeg couldn't level the audio for scene {scene['id']} ({dest.name}).")
        d = duration(dest)
        scene["audio"] = dest.relative_to(sb_path.parent).as_posix()
        floor = float(scene.get("min_seconds") or MIN_SECONDS.get(scene.get("kind", ""), 2.5))
        scene["seconds"] = round(max(d + a.pad, floor), 2)
        srt.append(f"{i}\n{srt_time(t)} --> {srt_time(t + d)}\n{text}\n")
        t += scene["seconds"]
        print(f"  {scene['id']}: {d:.1f}s audio, scene {scene['seconds']}s")

    sb_path.write_text(json.dumps(sb, indent=2), encoding="utf-8")
    (sb_path.parent / "showcase.srt").write_text("\n".join(srt), encoding="utf-8")
    print(f"total {t:.1f}s  (target 60 to 90s)")


if __name__ == "__main__":
    main()
