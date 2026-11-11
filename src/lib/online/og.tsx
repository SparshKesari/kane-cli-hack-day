import "server-only";
import { ImageResponse } from "next/og";

// The 1200×630 share card for the online hackathon, in the site's style:
// black ink, off-white type, hairline rules, one lime block. Fonts come from
// Google Fonts when reachable; otherwise the built-in face.

export const OG_SIZE = { width: 1200, height: 630 };

const INK = "#000";
const BRIGHT = "#f2f2f2";
const GRAY = "#a8a8a8";
const HAIRLINE = "#37383a";
const LIME = "#daff52";

async function googleFont(family: string, weight: number, text: string) {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`, {
      signal: AbortSignal.timeout(2500),
    }).then((r) => (r.ok ? r.text() : ""));
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export type Card = {
  /** Small line top-left, e.g. "Welcome to" or "Built for the KaneCLI Online Hackathon". */
  eyebrow: string;
  /** Top-right, e.g. "by TestMu AI". */
  corner: string;
  title: string;
  subtitle: string;
  /** The lime strip's facts. */
  facts: string[];
  /** Bottom-right address. */
  path: string;
};

export async function ogCard(c: Card) {
  const mono = [c.eyebrow, c.corner, c.path, ...c.facts].join(" ");
  const [d, m] = await Promise.all([googleFont("Inter Tight", 700, `${c.title}${c.subtitle}`), googleFont("IBM Plex Mono", 500, `${mono.toUpperCase()}${mono}·`)]);
  // Both or neither: a subset font missing glyphs for the other text would render blanks.
  const ok = d && m;
  const fonts = ok
    ? [
        { name: "Display", data: d, weight: 700 as const, style: "normal" as const },
        { name: "Mono", data: m, weight: 500 as const, style: "normal" as const },
      ]
    : [];
  const size = c.title.length > 26 ? 84 : c.title.length > 16 ? 104 : 132;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: INK, color: BRIGHT, padding: "52px 64px", fontFamily: ok ? "Mono" : undefined }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${HAIRLINE}`, paddingBottom: 20, fontSize: 22, color: GRAY, letterSpacing: 3 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 22, height: 22, background: LIME, marginRight: 16 }} />
            <span style={{ textTransform: "uppercase" }}>{c.eyebrow}</span>
          </div>
          <span>{c.corner}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          <div style={{ fontFamily: ok ? "Display" : undefined, fontWeight: 700, fontSize: size, lineHeight: 1.02, letterSpacing: -2 }}>{c.title}</div>
          <div style={{ fontFamily: ok ? "Display" : undefined, fontSize: 36, lineHeight: 1.25, color: GRAY, marginTop: 24, maxWidth: 1000 }}>{c.subtitle}</div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", background: LIME, color: INK, padding: "12px 18px", fontSize: 24, letterSpacing: 2, textTransform: "uppercase" }}>{c.facts.join("  ·  ")}</div>
          <span style={{ fontSize: 22, color: GRAY }}>{c.path}</span>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
