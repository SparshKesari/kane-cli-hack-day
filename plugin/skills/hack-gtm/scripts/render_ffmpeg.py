#!/usr/bin/env python3
"""
Fallback renderer: storyboard -> MP4 using Pillow + ffmpeg only.

Usage:
  render_ffmpeg.py launch/video/storyboard.json --out launch/video/showcase.mp4 [--vertical]

Each scene becomes a still PNG (title cards, step frames with the screenshot
letterboxed and a status pill, verdict card, outro). Stills are turned into
clips of scene.seconds with the scene audio (if any), then concatenated.
"""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont  # pip install pillow

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "C:/Windows/Fonts/arialbd.ttf",
]
MONO_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "C:/Windows/Fonts/consola.ttf",
]


def font(size, mono=False):
    for p in (MONO_CANDIDATES if mono else FONT_CANDIDATES):
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def wrap(draw, text, fnt, max_w):
    words, lines, cur = str(text).split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textlength(test, font=fnt) <= max_w:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Painter:
    def __init__(self, sb, base: Path, vertical=False):
        self.sb = sb
        self.base = base
        self.W, self.H = (1080, 1920) if vertical else (sb.get("width", 1920), sb.get("height", 1080))
        self.bg = hexc(sb["brand"]["bg"])
        self.accent = hexc(sb["brand"]["accent"])
        self.pad = int(self.W * 0.06)

    def new(self):
        im = Image.new("RGB", (self.W, self.H), self.bg)
        return im, ImageDraw.Draw(im)

    def caption(self, draw, text):
        if not self.sb.get("captions") or not text:
            return
        f = font(int(self.H * 0.03))
        lines = wrap(draw, text, f, self.W - 2 * self.pad)[:2]
        y = self.H - self.pad - len(lines) * int(self.H * 0.04)
        for ln in lines:
            w = draw.textlength(ln, font=f)
            draw.rounded_rectangle([(self.W - w) / 2 - 20, y - 6, (self.W + w) / 2 + 20, y + int(self.H * 0.036)],
                                   radius=10, fill=(0, 0, 0))
            draw.text(((self.W - w) / 2, y), ln, font=f, fill=(240, 240, 240))
            y += int(self.H * 0.04)

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
        f1, f2 = font(int(self.H * 0.12)), font(int(self.H * 0.045))
        d.text((self.pad, self.H * 0.36), s.get("title", ""), font=f1, fill=(255, 255, 255))
        y = self.H * 0.36 + int(self.H * 0.14)
        for ln in wrap(d, s.get("subtitle", ""), f2, self.W - 2 * self.pad)[:3]:
            d.text((self.pad, y), ln, font=f2, fill=self.accent)
            y += int(self.H * 0.055)
        self.caption(d, s.get("narration"))
        return im

    def card(self, s):
        im, d = self.new()
        f1 = font(int(self.H * 0.06))
        f2 = font(int(self.H * 0.04), mono=s.get("mono", False))
        d.text((self.pad, self.H * 0.18), s.get("title", ""), font=f1, fill=self.accent)
        y = self.H * 0.32
        for ln in wrap(d, s.get("body", ""), f2, self.W - 2 * self.pad)[:7]:
            d.text((self.pad, y), ln, font=f2, fill=(255, 255, 255))
            y += int(self.H * 0.055)
        self.caption(d, s.get("narration"))
        return im

    def step(self, s):
        im, d = self.new()
        failed = s.get("status") in ("failed", "broken")
        pill = (255, 92, 92) if failed else self.accent
        f_lab, f_small = font(int(self.H * 0.04)), font(int(self.H * 0.026), mono=True)
        # header strip
        d.text((self.pad, self.pad), f"Step {s.get('step')}  {s.get('label', '')}", font=f_lab, fill=(255, 255, 255))
        status = s.get("status", "").upper()
        w = d.textlength(status, font=f_small) + 40
        d.rounded_rectangle([self.W - self.pad - w, self.pad, self.W - self.pad, self.pad + int(self.H * 0.045)],
                            radius=12, fill=pill)
        d.text((self.W - self.pad - w + 20, self.pad + 8), status, font=f_small, fill=self.bg)
        # screenshot
        top = self.pad + int(self.H * 0.07)
        bottom = self.H - self.pad - int(self.H * 0.12 if failed else self.H * 0.09)
        box_w, box_h = self.W - 2 * self.pad, bottom - top
        img = s.get("image")
        if img and (self.base / img).exists():
            shot = Image.open(self.base / img).convert("RGB")
            shot.thumbnail((box_w, box_h))
            x = self.pad + (box_w - shot.width) // 2
            im.paste(shot, (x, top))
            d.rectangle([x - 2, top - 2, x + shot.width + 2, top + shot.height + 2], outline=pill, width=3)
        if s.get("url"):
            d.text((self.pad, bottom + 10), str(s["url"])[:110], font=f_small, fill=(160, 170, 180))
        if failed and s.get("error"):
            d.text((self.pad, bottom + 10 + int(self.H * 0.035)), str(s["error"])[:120], font=f_small, fill=pill)
        if s.get("hidden_steps"):
            d.text((self.W - self.pad - 220, bottom + 10), f"+{s['hidden_steps']} more steps", font=f_small, fill=(160, 170, 180))
        self.caption(d, s.get("narration"))
        return im

    def act_label(self, d, s):
        label = {"pitch": "THE PITCH", "build": "HOW WE BUILT IT", "proof": "TESTED WITH KANE CLI", "close": ""}.get(s.get("act", ""), "")
        if label:
            f = font(int(self.H * 0.02))
            d.text((self.W - self.pad - d.textlength(label, font=f), self.H - self.pad * 0.6), label, font=f, fill=(110, 120, 130))

    def demo(self, s):
        im, d = self.new()
        f1 = font(int(self.H * 0.05))
        d.text((self.pad, self.pad), s.get("title", "Demo"), font=f1, fill=self.accent)
        imgs = [self.base / p for p in (s.get("images") or []) if (self.base / p).exists()][:3]
        top = self.pad + int(self.H * 0.09)
        box_h = self.H - top - self.pad - int(self.H * 0.09)
        if imgs:
            gap = int(self.W * 0.02)
            box_w = (self.W - 2 * self.pad - gap * (len(imgs) - 1)) // len(imgs)
            x = self.pad
            for p in imgs:
                shot = Image.open(p).convert("RGB")
                shot.thumbnail((box_w, box_h))
                im.paste(shot, (x + (box_w - shot.width) // 2, top + (box_h - shot.height) // 2))
                x += box_w + gap
        else:
            d.text((self.pad, top), "add demo screenshots to the brief (demo: a.png, b.png)", font=font(int(self.H * 0.03)), fill=(160, 170, 180))
        self.caption(d, s.get("narration"))
        return im

    def verdict(self, s):
        im, d = self.new()
        ok = s.get("status") == "passed"
        col = self.accent if ok else (255, 92, 92)
        f1, f2 = font(int(self.H * 0.14)), font(int(self.H * 0.045))
        d.text((self.pad, self.H * 0.25), "PASSED" if ok else "FAILED", font=f1, fill=col)
        t = s.get("totals", {})
        line = f"{t.get('steps', '?')} steps   {t.get('passed', '?')} passed   {t.get('failed', '?')} failed   {t.get('duration', '')}"
        d.text((self.pad, self.H * 0.25 + int(self.H * 0.17)), line, font=f2, fill=(255, 255, 255))
        d.text((self.pad, self.H * 0.25 + int(self.H * 0.24)), "Sealed in one Kane CLI evidence pack. kane-cli evidence serve <pack>",
               font=font(int(self.H * 0.03), mono=True), fill=(160, 170, 180))
        self.caption(d, s.get("narration"))
        return im

    def outro(self, s):
        im, d = self.new()
        f1, f2, f3 = font(int(self.H * 0.08)), font(int(self.H * 0.04), mono=True), font(int(self.H * 0.035))
        d.text((self.pad, self.H * 0.18), self.sb.get("project", ""), font=f1, fill=(255, 255, 255))
        y = self.H * 0.36
        for link in s.get("links", []):
            d.text((self.pad, y), str(link), font=f2, fill=self.accent)
            y += int(self.H * 0.07)
        d.text((self.pad, y + int(self.H * 0.04)), s.get("credits", self.sb["brand"]["credit"]), font=f3, fill=(200, 210, 220))
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
    sb = json.loads(sb_path.read_text())
    base = sb_path.parent
    p = Painter(sb, base, a.vertical)
    tmp = Path(tempfile.mkdtemp(prefix="render-"))
    clips = []
    for i, s in enumerate(sb["scenes"]):
        png = tmp / f"{i:02d}.png"
        p.paint(s).save(png)
        clip = tmp / f"{i:02d}.mp4"
        secs = float(s.get("seconds", 4))
        audio = base / s["audio"] if s.get("audio") and (base / s["audio"]).exists() else None
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", str(sb.get("fps", 30)), "-i", str(png)]
        if audio:
            cmd += ["-i", str(audio)]
        else:
            cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]
        cmd += ["-t", f"{secs}", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(sb.get("fps", 30)),
                "-c:a", "aac", "-b:a", "160k", str(clip)]
        subprocess.run(cmd, check=True)
        clips.append(clip)
    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{c}'\n" for c in clips))
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", a.out], check=True)
    print(f"wrote {a.out}  ({len(clips)} scenes)")


if __name__ == "__main__":
    sys.exit(main())
