#!/usr/bin/env python3
"""
Fallback renderer: storyboard -> MP4 using Pillow + ffmpeg only.

Usage:
  render_ffmpeg.py launch/video/storyboard.json --out launch/video/showcase.mp4 [--vertical]

Each scene becomes a still PNG (title cards, step frames with the screenshot
letterboxed and a status pill, verdict card, outro). Stills are turned into
clips of scene.seconds with the scene audio (if any), then concatenated.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True  # the import below must not leave __pycache__ in the installed skill
from evidence_to_storyboard import redact_data, refuse_placeholders  # noqa: E402

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "C:/Windows/Fonts/arialbd.ttf",
]
MONO_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/dejavu-sans-mono-fonts/DejaVuSansMono.ttf",
    "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "C:/Windows/Fonts/consola.ttf",
]
# Every clip gets the same audio format, so the concat never resamples one scene into another's.
AUDIO = ["-ar", "48000", "-ac", "1"]


def font(size, mono=False):
    for p in (MONO_CANDIDATES if mono else FONT_CANDIDATES):
        if Path(p).exists():
            return ImageFont.truetype(p, max(1, int(size)))
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_w):
    words, lines, cur = str(text).split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textlength(test, font=fnt) <= max_w or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def wrap_chars(draw, text, fnt, max_w):
    """For links: break anywhere, since a URL has no spaces to break at."""
    lines, cur = [], ""
    for ch in str(text):
        if cur and draw.textlength(cur + ch, font=fnt) > max_w:
            lines.append(cur)
            cur = ""
        cur += ch
    return lines + ([cur] if cur else [])


def fit(draw, text, fnt, max_w):
    """One line, cut with "..." if it doesn't fit."""
    text = str(text)
    if draw.textlength(text, font=fnt) <= max_w:
        return text
    while text and draw.textlength(text + "...", font=fnt) > max_w:
        text = text[:-1]
    return text.rstrip() + "..."


def clamp(draw, text, fnt, max_w, n):
    """At most n wrapped lines; the last one says it was cut."""
    lines = wrap(draw, text, fnt, max_w)
    if len(lines) <= n:
        return lines
    return lines[:n - 1] + [fit(draw, " ".join(lines[n - 1:]), fnt, max_w)]


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Painter:
    def __init__(self, sb, base: Path, vertical=False):
        self.sb = sb
        self.base = base
        self.W, self.H = (1080, 1920) if vertical else (sb.get("width", 1920), sb.get("height", 1080))
        self.vertical = self.H > self.W
        # Type is sized from the short side, so the 1080x1920 cut reads like the 1920x1080 one.
        self.unit = min(self.W, self.H)
        self.bg = hexc(sb["brand"]["bg"])
        self.accent = hexc(sb["brand"]["accent"])
        self.pad = int(self.W * 0.06)
        # The caption sits above the act label and may take three lines; layouts keep that clear.
        self.label_size = int(self.unit * 0.02)
        self.caption_bottom = int(self.pad * 0.6 + self.label_size + 16) if self.vertical else self.pad
        self.caption_size = int(self.unit * 0.03)
        self.caption_space = self.caption_bottom + int(3 * self.caption_size * 1.35) + 16

    def new(self):
        im = Image.new("RGB", (self.W, self.H), self.bg)
        return im, ImageDraw.Draw(im)

    def caption_lines(self, draw, text):
        """The whole narration: three lines at full size if it fits, smaller type if not, never cut."""
        size = self.caption_size
        for scale in (1.0, 0.9, 0.8, 0.7):
            f = font(size * scale)
            lines = wrap(draw, text, f, self.W - 2 * self.pad)
            if len(lines) <= 3:
                break
        return f, lines

    def caption(self, draw, text):
        if not self.sb.get("captions") or not text:
            return
        f, lines = self.caption_lines(draw, text)
        step = int(f.size * 1.35) if hasattr(f, "size") else 16
        y = self.H - self.caption_bottom - len(lines) * step
        for ln in lines:
            w = draw.textlength(ln, font=f)
            draw.rounded_rectangle([(self.W - w) / 2 - 20, y - 6, (self.W + w) / 2 + 20, y + step - 4],
                                   radius=10, fill=(0, 0, 0))
            draw.text(((self.W - w) / 2, y), ln, font=f, fill=(240, 240, 240))
            y += step

    def paste_fit(self, im, path, box, fill=False):
        """The whole image inside box (x, y, w, h); in the tall cut, over a blurred, dimmed fill of itself."""
        x, y, w, h = box
        shot = Image.open(path).convert("RGB")
        if fill:
            from PIL import ImageFilter
            back = shot.copy()
            scale = max(w / back.width, h / back.height)
            back = back.resize((max(1, int(back.width * scale)), max(1, int(back.height * scale))))
            left, top = (back.width - w) // 2, (back.height - h) // 2
            back = back.crop((left, top, left + w, top + h)).filter(ImageFilter.GaussianBlur(24))
            im.paste(Image.blend(back, Image.new("RGB", back.size, (0, 0, 0)), 0.65), (x, y))
        shot.thumbnail((w, h))
        px, py = x + (w - shot.width) // 2, y + (h - shot.height) // 2
        im.paste(shot, (px, py))
        return px, py, shot.width, shot.height

    def title(self, s):
        im, d = self.new()
        img = s.get("image")
        if img and (self.base / img).exists():
            hero = Image.open(self.base / img).convert("RGB")
            hero.thumbnail((self.W, self.H))
            im.paste(hero, ((self.W - hero.width) // 2, (self.H - hero.height) // 2))
            overlay = Image.new("RGBA", im.size, (*self.bg, 170))
            im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
            d = ImageDraw.Draw(im)
        f1, f2 = font(self.unit * 0.12), font(self.unit * 0.045)
        y = self.H * 0.36
        for ln in clamp(d, s.get("title", ""), f1, self.W - 2 * self.pad, 2):
            d.text((self.pad, y), ln, font=f1, fill=(255, 255, 255))
            y += int(self.unit * 0.14)
        for ln in clamp(d, s.get("subtitle", ""), f2, self.W - 2 * self.pad, 3):
            d.text((self.pad, y), ln, font=f2, fill=self.accent)
            y += int(self.unit * 0.055)
        self.caption(d, s.get("narration"))
        return im

    def card(self, s):
        im, d = self.new()
        f1 = font(self.unit * 0.06)
        f2 = font(self.unit * 0.04, mono=s.get("mono", False))
        y = self.H * 0.18
        for ln in clamp(d, s.get("title", ""), f1, self.W - 2 * self.pad, 2):
            d.text((self.pad, y), ln, font=f1, fill=self.accent)
            y += int(self.unit * 0.075)
        y = max(y + self.unit * 0.04, self.H * 0.32 if not self.vertical else y + self.unit * 0.04)
        step = int(self.unit * 0.055)
        room = max(1, int((self.H - self.caption_space - y) // step))
        for ln in clamp(d, s.get("body", ""), f2, self.W - 2 * self.pad, min(room, 7 if not self.vertical else 12)):
            d.text((self.pad, y), ln, font=f2, fill=(255, 255, 255))
            y += step
        self.caption(d, s.get("narration"))
        return im

    def step(self, s):
        im, d = self.new()
        failed = s.get("status") in ("failed", "broken")
        pill = (255, 92, 92) if failed else self.accent
        f_lab, f_small = font(self.unit * 0.04), font(self.unit * 0.026, mono=True)
        small = int(self.unit * 0.026)
        # header: the step title (two lines in the tall cut, one in the wide) beside the status pill
        status = s.get("status", "").upper()
        pill_w = int(d.textlength(status, font=f_small) + 40)
        pill_h = int(self.unit * 0.045)
        d.rounded_rectangle([self.W - self.pad - pill_w, self.pad, self.W - self.pad, self.pad + pill_h], radius=12, fill=pill)
        d.text((self.W - self.pad - pill_w + 20, self.pad + (pill_h - small) // 2 - 2), status, font=f_small, fill=self.bg)
        label_w = self.W - 2 * self.pad - pill_w - int(self.unit * 0.02)
        line_h = int(self.unit * 0.05)
        y = self.pad
        lines = clamp(d, f"Step {s.get('step')}  {s.get('label', '')}", f_lab, label_w, 2 if self.vertical else 1)
        for ln in lines:
            d.text((self.pad, y), ln, font=f_lab, fill=(255, 255, 255))
            y += line_h
        top = max(self.pad + int(self.H * 0.07) if not self.vertical else 0, y + int(self.unit * 0.02))
        # under the screenshot: the URL line, up to two lines of error, then the caption
        meta_h = int(small * 1.5) * (3 if failed and s.get("error") else 1)
        bottom = self.H - self.caption_space - meta_h - 12
        box_w, box_h = self.W - 2 * self.pad, bottom - top
        img = s.get("image")
        if img and (self.base / img).exists():
            x0, y0, w0, h0 = self.paste_fit(im, self.base / img, (self.pad, top, box_w, box_h), fill=self.vertical)
            if self.vertical:
                x0, y0, w0, h0 = self.pad, top, box_w, box_h
            d.rectangle([x0 - 2, y0 - 2, x0 + w0 + 2, y0 + h0 + 2], outline=pill, width=3)
        more = f"+{s['hidden_steps']} more steps" if s.get("hidden_steps") else ""
        more_w = int(d.textlength(more, font=f_small)) if more else 0
        y = bottom + 10
        if s.get("url"):
            d.text((self.pad, y), fit(d, s["url"], f_small, box_w - more_w - 24), font=f_small, fill=(160, 170, 180))
        if more:
            d.text((self.W - self.pad - more_w, y), more, font=f_small, fill=(160, 170, 180))
        if failed and s.get("error"):
            y += int(small * 1.5)
            for ln in clamp(d, s["error"], f_small, box_w, 2):
                d.text((self.pad, y), ln, font=f_small, fill=pill)
                y += int(small * 1.5)
        self.caption(d, s.get("narration"))
        return im

    def act_label(self, d, s):
        label = {"pitch": "THE PITCH", "build": "HOW WE BUILT IT", "proof": "TESTED WITH KANE CLI", "close": ""}.get(s.get("act", ""), "")
        if label:
            f = font(self.label_size)
            d.text((self.W - self.pad - d.textlength(label, font=f), self.H - self.pad * 0.6), label, font=f, fill=(110, 120, 130))

    def demo(self, s):
        im, d = self.new()
        f1 = font(self.unit * 0.05)
        d.text((self.pad, self.pad), s.get("title", "Demo"), font=f1, fill=self.accent)
        imgs = [self.base / p for p in (s.get("images") or []) if (self.base / p).exists()][:3]
        top = self.pad + int(self.unit * 0.09)
        gap = int(self.unit * 0.02)
        area_w = self.W - 2 * self.pad
        area_h = (self.H - top - self.caption_space - gap) if self.vertical else (self.H - top - self.pad - int(self.H * 0.09))
        n = len(imgs)
        for i, p in enumerate(imgs):
            # side by side in the wide cut; stacked in the tall one, where side by side leaves slivers
            if self.vertical:
                box = (self.pad, top + i * ((area_h - gap * (n - 1)) // n + gap), area_w, (area_h - gap * (n - 1)) // n)
            else:
                w = (area_w - gap * (n - 1)) // n
                box = (self.pad + i * (w + gap), top, w, area_h)
            self.paste_fit(im, p, box)
        self.caption(d, s.get("narration"))
        return im

    def verdict(self, s):
        im, d = self.new()
        ok = s.get("status") == "passed"
        col = self.accent if ok else (255, 92, 92)
        f1, f2 = font(self.unit * 0.14), font(self.unit * 0.045)
        y = self.H * 0.25
        d.text((self.pad, y), "PASSED" if ok else "FAILED", font=f1, fill=col)
        t = s.get("totals", {})
        line = f"{t.get('steps', '?')} steps   {t.get('passed', '?')} passed   {t.get('failed', '?')} failed   {t.get('duration', '')}"
        y += int(self.unit * 0.17)
        fits = d.textlength(line, font=f2) <= self.W - 2 * self.pad
        for ln in [line] if fits else clamp(d, line, f2, self.W - 2 * self.pad, 2):
            d.text((self.pad, y), ln, font=f2, fill=(255, 255, 255))
            y += int(self.unit * 0.06)
        d.text((self.pad, y + int(self.unit * 0.02)), "Sealed in one Kane CLI evidence pack.",
               font=font(self.unit * 0.03, mono=True), fill=(160, 170, 180))
        self.caption(d, s.get("narration"))
        return im

    def outro(self, s):
        im, d = self.new()
        f1, f3 = font(self.unit * 0.08), font(self.unit * 0.035)
        y = self.H * 0.18
        for ln in clamp(d, self.sb.get("project", ""), f1, self.W - 2 * self.pad, 2):
            d.text((self.pad, y), ln, font=f1, fill=(255, 255, 255))
            y += int(self.unit * 0.1)
        y = max(y + self.unit * 0.04, self.H * 0.36 if not self.vertical else 0)
        for link in s.get("links", []):
            # one line where it fits: shrink to fit, down to a floor, then break anywhere
            size = self.unit * 0.04
            while size > self.unit * 0.024 and d.textlength(str(link), font=font(size, mono=True)) > self.W - 2 * self.pad:
                size -= 1
            f2 = font(size, mono=True)
            for ln in wrap_chars(d, link, f2, self.W - 2 * self.pad):
                d.text((self.pad, y), ln, font=f2, fill=self.accent)
                y += int(size * 1.3)
            y += int(self.unit * 0.03)
        for ln in clamp(d, s.get("credits", self.sb["brand"]["credit"]), f3, self.W - 2 * self.pad, 3):
            d.text((self.pad, y + int(self.unit * 0.04)), ln, font=f3, fill=(200, 210, 220))
            y += int(self.unit * 0.045)
        self.caption(d, s.get("narration"))
        return im

    def paint(self, s):
        im = {"title": self.title, "card": self.card, "step": self.step, "demo": self.demo,
              "verdict": self.verdict, "outro": self.outro}.get(s.get("kind"), self.card)(s)
        self.act_label(ImageDraw.Draw(im), s)
        return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("storyboard")
    ap.add_argument("--out", required=True)
    ap.add_argument("--vertical", action="store_true")
    a = ap.parse_args()
    sb_path = Path(a.storyboard)
    sb = redact_data(json.loads(sb_path.read_text(encoding="utf-8")))
    refuse_placeholders(sb)
    # Keep --help usable with stock Python, even without rendering dependencies.
    global Image, ImageDraw, ImageFont
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        sys.exit("Pillow is required for ffmpeg rendering")
    base = sb_path.parent
    p = Painter(sb, base, a.vertical)
    with tempfile.TemporaryDirectory(prefix="render-") as tmp_dir:
        tmp = Path(tmp_dir)
        clips = []
        for i, s in enumerate(sb["scenes"]):
            png = tmp / f"{i:02d}.png"
            p.paint(s).save(png)
            clip = tmp / f"{i:02d}.mp4"
            secs = float(s.get("seconds", 4))
            audio = base / s["audio"] if s.get("audio") and (base / s["audio"]).exists() else None
            cmd = ["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", str(sb.get("fps", 30)), "-i", str(png)]
            if audio:
                # apad: the voice is shorter than the scene; pad it so the next scene's audio starts on time
                cmd += ["-i", str(audio), "-af", "apad"]
            else:
                cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=48000"]
            cmd += ["-t", f"{secs}", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(sb.get("fps", 30)),
                    *AUDIO, "-c:a", "aac", "-b:a", "160k", str(clip)]
            subprocess.run(cmd, check=True)
            clips.append(clip)
        lst = tmp / "list.txt"
        # Relative, generated filenames also work with Windows paths and quotes.
        lst.write_text("".join(f"file '{c.name}'\n" for c in clips), encoding="utf-8")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", *AUDIO, "-c:a", "aac", "-movflags", "+faststart", a.out], check=True)
    print(f"wrote {a.out}  ({len(clips)} scenes)")


if __name__ == "__main__":
    sys.exit(main())
