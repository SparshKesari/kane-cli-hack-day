import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Scene, Storyboard } from "./types";

type Props = { sb: Storyboard; vertical: boolean; publicBase: string };

const font = `"Inter", "SF Pro Display", "Segoe UI", system-ui, sans-serif`;
const mono = `"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`;

// Type is sized from the short side, so the 1080x1920 cut reads like the 1920x1080 one. In the
// tall cut the caption sits above the act label, and layouts keep `captionSpace` clear for three lines.
const useFrame = () => {
  const cfg = useVideoConfig();
  const unit = Math.min(cfg.width, cfg.height);
  const vertical = cfg.height > cfg.width;
  const captionBottom = vertical ? cfg.height * 0.035 + unit * 0.06 : cfg.height * 0.05;
  const captionSpace = captionBottom + unit * 0.028 * 1.3 * 3 + 16;
  return { ...cfg, unit, vertical, captionBottom, captionSpace };
};

const Caption: React.FC<{ text?: string; accent: string }> = ({ text }) => {
  const { width, unit, captionBottom } = useFrame();
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: captionBottom,
        left: width * 0.08,
        right: width * 0.08,
        textAlign: "center",
        fontFamily: font,
        fontSize: unit * 0.028,
        lineHeight: 1.3,
        color: "#f3f3f3",
      }}
    >
      <span style={{ background: "rgba(0,0,0,0.75)", padding: "8px 18px", borderRadius: 10, boxDecorationBreak: "clone" }}>{text}</span>
    </div>
  );
};

const FadeIn: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 24}px)` }}>{children}</div>;
};

const Title: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height, unit } = useFrame();
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, s.seconds * sb.fps], [1, 1.06]);
  return (
    <AbsoluteFill style={{ background: sb.brand.bg }}>
      {s.image && (
        <Img src={staticFile(s.image)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})`, opacity: 0.35 }} />
      )}
      <div style={{ position: "absolute", left: width * 0.08, top: height * 0.34, right: width * 0.08, fontFamily: font, color: "#fff" }}>
        <FadeIn>
          <div style={{ fontSize: unit * 0.12, fontWeight: 800, letterSpacing: -2 }}>{s.title}</div>
        </FadeIn>
        <FadeIn delay={8}>
          <div style={{ fontSize: unit * 0.045, color: sb.brand.accent, marginTop: 16, maxWidth: width * 0.8 }}>{s.subtitle}</div>
        </FadeIn>
      </div>
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

const Card: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height, unit } = useFrame();
  return (
    <AbsoluteFill style={{ background: sb.brand.bg }}>
      <div style={{ position: "absolute", left: width * 0.08, top: height * 0.2, right: width * 0.08, fontFamily: font, color: "#fff" }}>
        <FadeIn>
          <div style={{ fontSize: unit * 0.055, fontWeight: 700, color: sb.brand.accent }}>{s.title}</div>
        </FadeIn>
        <FadeIn delay={6}>
          <div style={{ fontSize: unit * (s.mono ? 0.034 : 0.042), lineHeight: 1.35, marginTop: 28, fontFamily: s.mono ? mono : font, whiteSpace: "pre-wrap", background: s.mono ? "rgba(255,255,255,0.06)" : "none", padding: s.mono ? 24 : 0, borderRadius: 12 }}>
            {s.body}
          </div>
        </FadeIn>
      </div>
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

const rectOf = (r: Scene["rect"]) => {
  if (!r) return null;
  if (Array.isArray(r) && r.length >= 4) return { x: r[0], y: r[1], width: r[2], height: r[3] };
  if (typeof r === "object" && "x" in r) return r;
  return null;
};

const Step: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height, fps, unit, vertical, captionSpace } = useFrame();
  const frame = useCurrentFrame();
  const failed = s.status === "failed" || s.status === "broken";
  const pill = failed ? "#ff5c5c" : sb.brand.accent;
  // The rect is in screenshot pixels, which only roughly match the contained image in the wide cut.
  const rect = vertical ? null : rectOf(s.rect);
  // gentle zoom toward the highlighted element if we know where it is
  const zoom = interpolate(frame, [0, s.seconds * fps], [1, rect ? 1.18 : 1.04], { extrapolateRight: "clamp" });
  const origin = rect ? `${rect.x + rect.width / 2}px ${rect.y + rect.height / 2}px` : "50% 50%";
  const pad = width * 0.06;
  const labelSize = unit * 0.038;
  const small = unit * 0.024;
  // A long step title gets two lines in the tall cut and an ellipsis in the wide one, beside the pill.
  const labelLines = vertical ? 2 : 1;
  const top = vertical ? pad + labelLines * labelSize * 1.25 + unit * 0.03 : pad + height * 0.07;
  // Under the screenshot: the URL line, up to two lines of error when it failed, then the caption.
  const under = vertical ? small * 1.5 * (failed ? 3 : 1) + 24 + captionSpace : pad + height * (failed ? 0.14 : 0.1);
  const boxH = height - top - under;
  const clamp = (lines: number) => ({ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical" as const, overflow: "hidden" });
  return (
    <AbsoluteFill style={{ background: sb.brand.bg, fontFamily: font, color: "#fff" }}>
      <div style={{ position: "absolute", left: pad, right: pad, top: pad, display: "flex", alignItems: "flex-start", gap: unit * 0.02 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: labelSize, fontWeight: 600, lineHeight: vertical ? 1.25 : undefined, ...clamp(labelLines) }}>
          Step {s.step} <span style={{ opacity: 0.8, fontWeight: 400 }}>{s.label}</span>
        </div>
        <div style={{ flexShrink: 0, background: pill, color: sb.brand.bg, fontFamily: mono, fontSize: small, padding: "6px 16px", borderRadius: 999, fontWeight: 700 }}>
          {(s.status ?? "").toUpperCase()}
        </div>
      </div>
      <div style={{ position: "absolute", left: pad, right: pad, top, height: boxH, overflow: "hidden", borderRadius: 14, border: `3px solid ${pill}`, background: "#000" }}>
        {/* The tall cut shows the whole page, not a crop of its middle, over a blurred fill. */}
        {s.image && vertical && (
          <Img src={staticFile(s.image)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "blur(28px)", opacity: 0.35, transform: "scale(1.1)" }} />
        )}
        {s.image && (
          <Img src={staticFile(s.image)} style={{ position: "relative", width: "100%", height: "100%", objectFit: "contain", transform: `scale(${zoom})`, transformOrigin: origin }} />
        )}
      </div>
      <div style={{ position: "absolute", left: pad, right: pad, top: top + boxH + 12, display: "flex", gap: unit * 0.02, fontFamily: mono, fontSize: small, color: "#9aa5b1", whiteSpace: "nowrap" }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{s.url}</span>
        {s.hidden_steps ? <span style={{ flexShrink: 0 }}>+{s.hidden_steps} more steps</span> : null}
      </div>
      {failed && s.error && (
        <div style={{ position: "absolute", left: pad, right: pad, top: top + boxH + 12 + (vertical ? small * 1.5 : height * 0.035), fontFamily: mono, fontSize: small, color: pill, ...clamp(2) }}>{s.error}</div>
      )}
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

const ACT_LABEL: Record<string, string> = { pitch: "THE PITCH", build: "HOW WE BUILT IT", proof: "TESTED WITH KANE CLI", close: "" };

const ActLabel: React.FC<{ s: Scene }> = ({ s }) => {
  const { width, height, unit } = useFrame();
  const label = ACT_LABEL[s.act ?? ""] ?? "";
  if (!label) return null;
  return (
    <div style={{ position: "absolute", right: width * 0.06, bottom: height * 0.035, fontFamily: font, fontSize: unit * 0.02, letterSpacing: 3, color: "#6e7882" }}>{label}</div>
  );
};

const Demo: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height, fps, unit, vertical, captionSpace } = useFrame();
  const frame = useCurrentFrame();
  const imgs = (s.images ?? []).slice(0, 3);
  const n = imgs.length;
  const pad = width * 0.06;
  const top = pad + unit * 0.09;
  const gap = vertical ? unit * 0.02 : width * 0.02;
  // Side by side in the wide cut. Stacked in the tall one, where side by side leaves slivers.
  const areaW = width - 2 * pad;
  const areaH = vertical ? height - top - captionSpace - gap : height - top - pad - height * 0.09;
  const boxW = vertical ? areaW : n ? (areaW - gap * (n - 1)) / n : 0;
  const boxH = vertical ? (n ? (areaH - gap * (n - 1)) / n : 0) : areaH;
  return (
    <AbsoluteFill style={{ background: sb.brand.bg, fontFamily: font, color: "#fff" }}>
      <div style={{ position: "absolute", left: pad, top: pad, fontSize: unit * 0.05, fontWeight: 700, color: sb.brand.accent }}>{s.title ?? "See it work"}</div>
      {imgs.map((src, i) => {
        const p = spring({ frame: frame - i * Math.round(fps * 0.5), fps, config: { damping: 200 } });
        return (
          <div key={src} style={{ position: "absolute", left: vertical ? pad : pad + i * (boxW + gap), top: vertical ? top + i * (boxH + gap) : top, width: boxW, height: boxH, borderRadius: 14, overflow: "hidden", border: "2px solid rgba(255,255,255,0.12)", opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
            <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
          </div>
        );
      })}
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

const Verdict: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height, unit } = useFrame();
  const ok = s.status === "passed";
  const col = ok ? sb.brand.accent : "#ff5c5c";
  const t = s.totals ?? {};
  return (
    <AbsoluteFill style={{ background: sb.brand.bg, fontFamily: font, color: "#fff" }}>
      <div style={{ position: "absolute", left: width * 0.08, top: height * 0.25 }}>
        <FadeIn>
          <div style={{ fontSize: unit * 0.14, fontWeight: 900, color: col, letterSpacing: -3 }}>{ok ? "PASSED" : "FAILED"}</div>
        </FadeIn>
        <FadeIn delay={8}>
          <div style={{ fontSize: unit * 0.045, marginTop: 20 }}>
            {t.steps ?? "?"} steps &nbsp; {t.passed ?? "?"} passed &nbsp; {t.failed ?? "?"} failed &nbsp; {t.duration ?? ""}
          </div>
        </FadeIn>
        <FadeIn delay={16}>
          <div style={{ fontSize: unit * 0.028, marginTop: 36, fontFamily: mono, color: "#9aa5b1" }}>
            Sealed in one Kane CLI evidence pack. kane-cli evidence serve &lt;pack&gt;
          </div>
        </FadeIn>
      </div>
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height, unit } = useFrame();
  // A link stays on one line where it can: shrink it to fit, down to a floor, then let it wrap.
  const linkSize = (l: string) => Math.max(unit * 0.024, Math.min(unit * 0.04, (width * 0.84) / (l.length * 0.62)));
  return (
    <AbsoluteFill style={{ background: sb.brand.bg, fontFamily: font, color: "#fff" }}>
      <div style={{ position: "absolute", left: width * 0.08, top: height * 0.18, right: width * 0.08 }}>
        <FadeIn>
          <div style={{ fontSize: unit * 0.08, fontWeight: 800 }}>{sb.project}</div>
        </FadeIn>
        {(s.links ?? []).map((l, i) => (
          <FadeIn key={l} delay={6 + i * 5}>
            <div style={{ fontSize: linkSize(l), fontFamily: mono, color: sb.brand.accent, marginTop: 22, wordBreak: "break-all" }}>{l}</div>
          </FadeIn>
        ))}
        <FadeIn delay={20}>
          <div style={{ fontSize: unit * 0.034, marginTop: 44, color: "#c8d0d8" }}>{s.credits ?? sb.brand.credit}</div>
        </FadeIn>
      </div>
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

export const Showcase: React.FC<Props> = ({ sb }) => {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: sb.brand.bg }}>
      {sb.scenes.map((s) => {
        const dur = Math.round((s.seconds ?? 4) * sb.fps);
        const start = from;
        from += dur;
        return (
          <Sequence key={s.id} from={start} durationInFrames={dur}>
            {s.audio && <Audio src={staticFile(s.audio)} />}
            {s.kind === "title" && <Title s={s} sb={sb} />}
            {s.kind === "card" && <Card s={s} sb={sb} />}
            {s.kind === "step" && <Step s={s} sb={sb} />}
            {s.kind === "demo" && <Demo s={s} sb={sb} />}
            {s.kind === "verdict" && <Verdict s={s} sb={sb} />}
            {s.kind === "outro" && <Outro s={s} sb={sb} />}
            <ActLabel s={s} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
