"use client";

import { useLayoutEffect, useRef } from "react";

// Load intro: the page below the navbar is covered by a Kane CLI boot log
// that types in line by line, then breaks away in blocks once the page has
// loaded.

const ROW = 18; // px per line
const FONT = 13; // px
const BLOCK = 240; // px width of each reveal block
const COVER_MS = 420; // time for the log to fill in
const MIN_SHOW_MS = 900; // shortest time the log stays up
const MAX_WAIT_MS = 2500; // reveal even if `load` never fires

const HEADER: [string, string][] = [
  ["$", " kane-cli hackday --init"],
  ["", "kane-cli · TestMu AI"],
  ["", ""],
  ["›", " resolving agents ............ ok"],
  ["›", " loading test suites ......... ok"],
  ["›", " connecting to browser grid .. ok"],
  ["›", " warming up 48 sessions ...... ok"],
  ["", ""],
];
const AREAS = ["checkout", "auth", "search", "cart", "profile", "billing", "onboarding", "settings", "upload", "api"];
const FLOWS = ["happy-path", "edge-cases", "retry", "mobile", "a11y", "visual", "smoke", "regression"];
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

type Row = { tag: string; text: string; ms: number; running: boolean };
type Block = { box: HTMLDivElement; text: HTMLDivElement; row: number; at: number };

const navBottom = () =>
  Math.max(0, Math.round(document.getElementById("nav-bar")?.getBoundingClientRect().bottom ?? 0));

function testRow(): Row {
  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
  const name = `${pick(AREAS)}/${pick(FLOWS)}-${String(Math.floor(Math.random() * 100)).padStart(2, "0")}.spec`;
  const running = Math.random() < 0.2;
  return { tag: running ? SPINNER[0] : "✓", text: ` ${running ? "RUNS" : "PASS"}  ${name.padEnd(34)}`, ms: Math.floor(40 + Math.random() * 900), running };
}

function build(layer: HTMLDivElement, top: number) {
  const width = window.innerWidth;
  const height = window.innerHeight - top;
  if (width <= 0 || height < 16) return null;
  layer.replaceChildren();
  Object.assign(layer.style, { top: `${top}px`, height: `${height}px`, display: "block", background: "#000" });

  const count = Math.ceil(height / ROW);
  const rows: Row[] = Array.from({ length: count }, (_, i) =>
    i < HEADER.length ? { tag: HEADER[i][0], text: HEADER[i][1], ms: -1, running: false } : testRow(),
  );
  const cols = Math.ceil(width / BLOCK);
  const appearAt = (row: number) => (row / Math.max(1, count)) * 380 + 260 * Math.random();

  const frag = document.createDocumentFragment();
  const blocks: Block[] = [];
  // Each line is cut into blocks so it can break apart; every block holds the
  // whole line, shifted so only its slice shows.
  const render = (el: HTMLDivElement, row: Row, frame: number) => {
    const tag = row.running ? SPINNER[frame % SPINNER.length] : row.tag;
    const ms = row.ms < 0 ? "" : `(${row.running ? row.ms + frame * 7 : row.ms} ms)`;
    el.innerHTML = "";
    const t = document.createElement("span");
    t.style.color = row.running ? "#8a8a8a" : "#daff52";
    t.textContent = tag;
    const rest = document.createElement("span");
    rest.textContent = row.text + ms;
    el.append(t, rest);
  };
  rows.forEach((row, r) => {
    const at = appearAt(r);
    for (let c = 0; c < cols; c++) {
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "absolute",
        top: `${ROW * r}px`,
        left: `${c * BLOCK}px`,
        width: `${BLOCK + 1}px`,
        height: `${ROW}px`,
        background: "#000",
        overflow: "hidden",
      });
      const text = document.createElement("div");
      Object.assign(text.style, {
        marginLeft: `${16 - c * BLOCK}px`,
        fontSize: `${FONT}px`,
        lineHeight: `${ROW}px`,
        whiteSpace: "pre",
        color: "#d4d4d8",
        opacity: "0",
      });
      render(text, row, 0);
      box.appendChild(text);
      frag.appendChild(box);
      blocks.push({ box, text, row: r, at });
    }
  });
  layer.appendChild(frag);

  let frame = 0;
  const timer = window.setInterval(() => {
    frame++;
    for (const b of blocks) if (rows[b.row].running) render(b.text, rows[b.row], frame);
  }, 80);

  return { blocks, rows: count, stop: () => window.clearInterval(timer) };
}

// Lines pop in top to bottom; a few flicker on the way.
function typeIn(blocks: Block[]) {
  for (const { text, at } of blocks) {
    const flicker = Math.random() < 0.15;
    text.animate(
      flicker
        ? [
            { opacity: 0, easing: "steps(1, end)" },
            { opacity: 1, offset: 0.4, easing: "steps(1, end)" },
            { opacity: 0, offset: 0.65, easing: "steps(1, end)" },
            { opacity: 1 },
          ]
        : [{ opacity: 0, easing: "steps(1, end)" }, { opacity: 1 }],
      { duration: flicker ? 160 : 1, delay: at, fill: "both" },
    );
  }
}

export default function BootScreen() {
  const bootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const boot = bootRef.current;
    const layer = layerRef.current;
    if (!boot || !layer) return;
    const hideBoot = () => (boot.style.display = "none");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return void hideBoot();

    const log = build(layer, navBottom());
    hideBoot();
    if (!log) return;
    typeIn(log.blocks);
    const covered = new Promise((r) => window.setTimeout(r, COVER_MS));
    const started = performance.now();
    let revealing = false;
    let revealTimer = 0;

    const cleanup = () => {
      log.stop();
      layer.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      layer.replaceChildren();
      Object.assign(layer.style, { display: "none", top: "", height: "", background: "" });
    };

    // Drop blocks out roughly top-to-bottom with jitter, exposing the page.
    const reveal = () => {
      if (revealing) return;
      revealing = true;
      covered
        .then(() => {
          layer.style.background = "transparent";
          return Promise.all(
            log.blocks.map(({ box, row, at }, i) => {
              const delay = (row / Math.max(1, log.rows)) * 900 * 0.55 + 900 * Math.random() * 0.5;
              return box.animate([{ opacity: 1 }, { opacity: 0 }], {
                duration: 1,
                delay: Math.max(delay, at - COVER_MS + 120 + (i % 3) * 10),
                easing: "steps(1, end)",
                fill: "both",
              }).finished;
            }),
          );
        })
        .catch(() => {})
        .finally(cleanup);
    };
    const scheduleReveal = () => {
      window.clearTimeout(fallback);
      revealTimer = window.setTimeout(reveal, Math.max(0, MIN_SHOW_MS - (performance.now() - started)));
    };
    const fallback = window.setTimeout(scheduleReveal, MAX_WAIT_MS);
    if (document.readyState === "complete") scheduleReveal();
    else window.addEventListener("load", scheduleReveal, { once: true });

    return () => {
      window.clearTimeout(fallback);
      window.clearTimeout(revealTimer);
      window.removeEventListener("load", scheduleReveal);
      cleanup();
    };
  }, []);

  return (
    <div aria-hidden>
      {/* Server-rendered cover so the page never flashes before the log is built. */}
      <div ref={bootRef} data-boot-cover className="fixed inset-x-0 bottom-0 top-[69px] z-[2147483647] bg-black" />
      <noscript>
        <style>{"[data-boot-cover]{display:none}"}</style>
      </noscript>
      <div
        ref={layerRef}
        className="pointer-events-auto fixed inset-0 z-[2147483647] hidden overflow-hidden font-plex"
      />
    </div>
  );
}
