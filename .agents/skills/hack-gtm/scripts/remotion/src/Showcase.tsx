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

const Caption: React.FC<{ text?: string; accent: string }> = ({ text }) => {
  const { height, width } = useVideoConfig();
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: height * 0.05,
        left: width * 0.08,
        right: width * 0.08,
        textAlign: "center",
        fontFamily: font,
        fontSize: height * 0.028,
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
  const { width, height } = useVideoConfig();
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, s.seconds * sb.fps], [1, 1.06]);
  return (
    <AbsoluteFill style={{ background: sb.brand.bg }}>
      {s.image && (
        <Img src={staticFile(s.image)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})`, opacity: 0.35 }} />
      )}
      <div style={{ position: "absolute", left: width * 0.08, top: height * 0.34, right: width * 0.08, fontFamily: font, color: "#fff" }}>
        <FadeIn>
          <div style={{ fontSize: height * 0.12, fontWeight: 800, letterSpacing: -2 }}>{s.title}</div>
        </FadeIn>
        <FadeIn delay={8}>
          <div style={{ fontSize: height * 0.045, color: sb.brand.accent, marginTop: 16, maxWidth: width * 0.8 }}>{s.subtitle}</div>
        </FadeIn>
      </div>
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

const Card: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: sb.brand.bg }}>
      <div style={{ position: "absolute", left: width * 0.08, top: height * 0.2, right: width * 0.08, fontFamily: font, color: "#fff" }}>
        <FadeIn>
          <div style={{ fontSize: height * 0.055, fontWeight: 700, color: sb.brand.accent }}>{s.title}</div>
        </FadeIn>
        <FadeIn delay={6}>
          <div style={{ fontSize: height * (s.mono ? 0.034 : 0.042), lineHeight: 1.35, marginTop: 28, fontFamily: s.mono ? mono : font, whiteSpace: "pre-wrap", background: s.mono ? "rgba(255,255,255,0.06)" : "none", padding: s.mono ? 24 : 0, borderRadius: 12 }}>
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

const Step: React.FC<{ s: Scene; sb: Storyboard; vertical: boolean }> = ({ s, sb, vertical }) => {
  const { width, height, fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const failed = s.status === "failed" || s.status === "broken";
  const pill = failed ? "#ff5c5c" : sb.brand.accent;
  const rect = rectOf(s.rect);
  // gentle zoom toward the highlighted element if we know where it is
  const zoom = interpolate(frame, [0, s.seconds * fps], [1, rect ? 1.18 : 1.04], { extrapolateRight: "clamp" });
  const origin = rect ? `${rect.x + rect.width / 2}px ${rect.y + rect.height / 2}px` : "50% 50%";
  const pad = width * 0.06;
  const top = pad + height * 0.07;
  const boxH = height - top - pad - height * (failed ? 0.14 : 0.1);
  return (
    <AbsoluteFill style={{ background: sb.brand.bg, fontFamily: font, color: "#fff" }}>
      <div style={{ position: "absolute", left: pad, top: pad, fontSize: height * 0.038, fontWeight: 600 }}>
        Step {s.step} <span style={{ opacity: 0.8, fontWeight: 400 }}>{s.label}</span>
      </div>
      <div style={{ position: "absolute", right: pad, top: pad, background: pill, color: sb.brand.bg, fontFamily: mono, fontSize: height * 0.024, padding: "6px 16px", borderRadius: 999, fontWeight: 700 }}>
        {(s.status ?? "").toUpperCase()}
      </div>
      <div style={{ position: "absolute", left: pad, right: pad, top, height: boxH, overflow: "hidden", borderRadius: 14, border: `3px solid ${pill}`, background: "#000" }}>
        {s.image && (
          <Img src={staticFile(s.image)} style={{ width: "100%", height: "100%", objectFit: vertical ? "cover" : "contain", transform: `scale(${zoom})`, transformOrigin: origin }} />
        )}
      </div>
      <div style={{ position: "absolute", left: pad, right: pad, top: top + boxH + 12, fontFamily: mono, fontSize: height * 0.024, color: "#9aa5b1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {s.url}
        {s.hidden_steps ? <span style={{ float: "right" }}>+{s.hidden_steps} more steps</span> : null}
      </div>
      {failed && s.error && (
        <div style={{ position: "absolute", left: pad, right: pad, top: top + boxH + 12 + height * 0.035, fontFamily: mono, fontSize: height * 0.024, color: pill }}>{s.error}</div>
      )}
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

const ACT_LABEL: Record<string, string> = { pitch: "THE PITCH", build: "HOW WE BUILT IT", proof: "TESTED WITH KANE CLI", close: "" };

const ActLabel: React.FC<{ s: Scene }> = ({ s }) => {
  const { width, height } = useVideoConfig();
  const label = ACT_LABEL[s.act ?? ""] ?? "";
  if (!label) return null;
  return (
    <div style={{ position: "absolute", right: width * 0.06, bottom: height * 0.035, fontFamily: font, fontSize: height * 0.02, letterSpacing: 3, color: "#6e7882" }}>{label}</div>
  );
};

const Demo: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height, fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const imgs = (s.images ?? []).slice(0, 3);
  const pad = width * 0.06;
  const top = pad + height * 0.09;
  const boxH = height - top - pad - height * 0.09;
  const gap = width * 0.02;
  const boxW = imgs.length ? (width - 2 * pad - gap * (imgs.length - 1)) / imgs.length : 0;
  return (
    <AbsoluteFill style={{ background: sb.brand.bg, fontFamily: font, color: "#fff" }}>
      <div style={{ position: "absolute", left: pad, top: pad, fontSize: height * 0.05, fontWeight: 700, color: sb.brand.accent }}>{s.title ?? "See it work"}</div>
      {imgs.map((src, i) => {
        const p = spring({ frame: frame - i * Math.round(fps * 0.5), fps, config: { damping: 200 } });
        return (
          <div key={src} style={{ position: "absolute", left: pad + i * (boxW + gap), top, width: boxW, height: boxH, borderRadius: 14, overflow: "hidden", border: "2px solid rgba(255,255,255,0.12)", opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
            <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
          </div>
        );
      })}
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

const Verdict: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height } = useVideoConfig();
  const ok = s.status === "passed";
  const col = ok ? sb.brand.accent : "#ff5c5c";
  const t = s.totals ?? {};
  return (
    <AbsoluteFill style={{ background: sb.brand.bg, fontFamily: font, color: "#fff" }}>
      <div style={{ position: "absolute", left: width * 0.08, top: height * 0.25 }}>
        <FadeIn>
          <div style={{ fontSize: height * 0.14, fontWeight: 900, color: col, letterSpacing: -3 }}>{ok ? "PASSED" : "FAILED"}</div>
        </FadeIn>
        <FadeIn delay={8}>
          <div style={{ fontSize: height * 0.045, marginTop: 20 }}>
            {t.steps ?? "?"} steps &nbsp; {t.passed ?? "?"} passed &nbsp; {t.failed ?? "?"} failed &nbsp; {t.duration ?? ""}
          </div>
        </FadeIn>
        <FadeIn delay={16}>
          <div style={{ fontSize: height * 0.028, marginTop: 36, fontFamily: mono, color: "#9aa5b1" }}>
            Sealed in one Kane CLI evidence pack. kane-cli evidence serve &lt;pack&gt;
          </div>
        </FadeIn>
      </div>
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ s: Scene; sb: Storyboard }> = ({ s, sb }) => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: sb.brand.bg, fontFamily: font, color: "#fff" }}>
      <div style={{ position: "absolute", left: width * 0.08, top: height * 0.18, right: width * 0.08 }}>
        <FadeIn>
          <div style={{ fontSize: height * 0.08, fontWeight: 800 }}>{sb.project}</div>
        </FadeIn>
        {(s.links ?? []).map((l, i) => (
          <FadeIn key={l} delay={6 + i * 5}>
            <div style={{ fontSize: height * 0.04, fontFamily: mono, color: sb.brand.accent, marginTop: 22, wordBreak: "break-all" }}>{l}</div>
          </FadeIn>
        ))}
        <FadeIn delay={20}>
          <div style={{ fontSize: height * 0.034, marginTop: 44, color: "#c8d0d8" }}>{s.credits ?? sb.brand.credit}</div>
        </FadeIn>
      </div>
      {sb.captions && <Caption text={s.narration} accent={sb.brand.accent} />}
    </AbsoluteFill>
  );
};

export const Showcase: React.FC<Props> = ({ sb, vertical }) => {
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
            {s.kind === "step" && <Step s={s} sb={sb} vertical={vertical} />}
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
