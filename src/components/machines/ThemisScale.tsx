"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { judging } from "@/data/hackday";

/* ------------------------------------------------------------------------ */
/* Copy                                                                      */
/* ------------------------------------------------------------------------ */

const RUBRIC = judging.rubric;
const FULL = RUBRIC.reduce((sum, c) => sum + c.points, 0); // 100
const ALL = RUBRIC.map((_, i) => i);

const TAGLINE = "Themis weighs every project on the same scale.";

const ARIA_LABEL =
  "Isometric balance scale of Themis. A fluted column holds a beam with two hanging pans. " +
  `The right pan carries a counterweight of ${FULL}. The left pan takes one weight block per judging criterion, ` +
  "each as tall as its points: " +
  RUBRIC.map((c) => `${c.label} ${c.points}`).join(", ") +
  `. When all ${FULL} points are on the left pan, the beam settles level.`;

/* ------------------------------------------------------------------------ */
/* Timing and physics                                                        */
/* ------------------------------------------------------------------------ */

/** Time between blocks during the idle tour. */
const STEP_MS = 2200;
/** Dwell on the balanced scale before the tour clears the pan. */
const HOLD_MS = 3600;
/** Dwell on the empty pan before the first block. */
const EMPTY_MS = 1400;
/** How long a block takes to fall onto the pan. */
const DROP_MS = 420;
/** Height (world units) a block is dropped from. */
const DROP_H = 1.1;

const FILL_TRANSITION = "fill 250ms ease, stroke 250ms ease";

/** Largest beam tilt, in radians. */
const MAX_TILT = 0.2;
/** Spring stiffness (1/s^2) and damping (1/s): underdamped, so the beam rocks before settling. */
const SPRING_K = 28;
const SPRING_C = 3.4;
/** Angular velocity kick per point when a block lands. */
const LAND_KICK = 0.004;

/** Beam angle that balances `left` points against the counterweight. Positive = left end down. */
function targetTilt(left: number): number {
  const r = ((left - FULL) / Math.max(left + FULL, 1)) * 1.7;
  return Math.max(-1, Math.min(1, r)) * MAX_TILT;
}

/* ------------------------------------------------------------------------ */
/* Isometric projection                                                      */
/* ------------------------------------------------------------------------ */

/** Pixels per world unit. */
const S = 40;
const COS30 = Math.cos(Math.PI / 6);
const R2 = Math.SQRT1_2;

/** World (x, y, z) -> screen (sx, sy). World x runs down-right, y runs down-left, z is up. */
// Rounded to 0.01px so server and browser render identical SVG attributes
// (float noise in trig would otherwise cause hydration mismatches).
const r2 = (v: number) => Math.round(v * 100) / 100;

function iso(x: number, y: number, z = 0): [number, number] {
  return [r2((x - y) * COS30 * S), r2(((x + y) * 0.5 - z) * S)];
}

type P3 = readonly [number, number, number];

function isoP(p: P3): [number, number] {
  return iso(p[0], p[1], p[2]);
}

function pts(points: readonly P3[]): string {
  return points
    .map((p) => {
      const [sx, sy] = isoP(p);
      return `${sx.toFixed(2)},${sy.toFixed(2)}`;
    })
    .join(" ");
}

/** p + sum(k * v). */
function along(p: P3, ...terms: [P3, number][]): P3 {
  let [x, y, z] = p;
  for (const [v, k] of terms) {
    x += v[0] * k;
    y += v[1] * k;
    z += v[2] * k;
  }
  return [x, y, z];
}

/** Matrix that lays local text onto the left-facing "+y" face. */
function onLeftFace(x: number, y: number, z: number): string {
  const [sx, sy] = iso(x, y, z);
  return `matrix(${COS30} 0.5 0 1 ${sx.toFixed(2)} ${sy.toFixed(2)})`;
}

/* ------------------------------------------------------------------------ */
/* Palette                                                                   */
/* ------------------------------------------------------------------------ */

type Tone = { top: string; left: string; right: string };

const TONES = {
  plate: { top: "#121212", left: "#0d0d0d", right: "#080808" },
  base: { top: "#3a3a3a", left: "#2a2a2a", right: "#1a1a1a" },
  raised: { top: "#5a5a5a", left: "#3a3a3a", right: "#2a2a2a" },
  bright: { top: "#8a8a8a", left: "#5a5a5a", right: "#3a3a3a" },
} satisfies Record<string, Tone>;

const LIT: Tone = { top: "#daff52", left: "#b8d93f", right: "#86a324" };
const LIME = "#daff52";
const LIME_DEEP = "#1f2606";

/* ------------------------------------------------------------------------ */
/* Primitives                                                                */
/* ------------------------------------------------------------------------ */

function Face({ points, fill }: { points: readonly P3[]; fill: string }) {
  return (
    <polygon
      points={pts(points)}
      stroke="#000"
      strokeWidth={1}
      strokeLinejoin="round"
      style={{ fill, transition: FILL_TRANSITION }}
    />
  );
}

/** Solid box with its min corner at (x, y, z); top, +y and +x faces only. */
function Box({
  x,
  y,
  z,
  w,
  d,
  h,
  tone,
}: {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  tone: Tone;
}) {
  const X = x + w;
  const Y = y + d;
  const Z = z + h;
  return (
    <g>
      <Face points={[[X, y, z], [X, Y, z], [X, Y, Z], [X, y, Z]]} fill={tone.right} />
      <Face points={[[x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]]} fill={tone.left} />
      <Face points={[[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]]} fill={tone.top} />
    </g>
  );
}

/** Box centred on (0, 0) in plan. */
function CBox({ half, z, h, tone }: { half: number; z: number; h: number; tone: Tone }) {
  return <Box x={-half} y={-half} z={z} w={half * 2} d={half * 2} h={h} tone={tone} />;
}

function Seg({ a, b, stroke, width = 2 }: { a: P3; b: P3; stroke: string; width?: number }) {
  const [x1, y1] = isoP(a);
  const [x2, y2] = isoP(b);
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      strokeWidth={width}
      strokeLinecap="square"
      style={{ stroke, transition: FILL_TRANSITION }}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Rig geometry: column at the origin, beam along screen-horizontal          */
/* ------------------------------------------------------------------------ */

/** Pivot height, half beam length (to the hooks), chain drop from hook to pan. */
const PIVOT_Z = 5.25;
const ARM = 3.6;
const CHAIN = 3.1;
const PIVOT: P3 = [0, 0, PIVOT_Z];
/** Horizontal towards the viewer, perpendicular to the beam's plane. */
const V: P3 = [R2, R2, 0];

const BEAM_HALF = ARM + 0.3;
const BEAM_HH = 0.12; // half height
const BEAM_HD = 0.15; // half depth
const NEEDLE = 1.05;

/** Pan dish half-size and thickness; blocks sit on PAN_TOP in the pan's local frame. */
const PAN_HALF = 0.9;
const PAN_TOP = 0.15;
const BLOCK_HALF = 0.6;
/** World units of height per rubric point (30 pts -> 0.75). */
const PER_POINT = 0.025;

type Rig = {
  front: string;
  top: string;
  needle: [number, number, number, number];
  hookL: [number, number];
  hookR: [number, number];
  panL: string;
  panR: string;
};

function panTransform(end: P3): string {
  const [sx, sy] = iso(end[0], end[1], end[2] - CHAIN);
  return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`;
}

function rig(theta: number): Rig {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // Beam axis (left -> right) and its up-normal, both in the u/z plane.
  const a: P3 = [c * R2, -c * R2, s];
  const n: P3 = [-s * R2, s * R2, c];
  const corner = (ka: number, kn: number, kv: number) =>
    along(PIVOT, [a, ka * BEAM_HALF], [n, kn * BEAM_HH], [V, kv * BEAM_HD]);
  const left = along(PIVOT, [a, -ARM]);
  const right = along(PIVOT, [a, ARM]);
  const needleBase = along(PIVOT, [V, BEAM_HD]);
  const [nx1, ny1] = isoP(needleBase);
  const [nx2, ny2] = isoP(along(needleBase, [n, NEEDLE]));
  return {
    front: pts([corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1)]),
    top: pts([corner(-1, 1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(-1, 1, 1)]),
    needle: [nx1, ny1, nx2, ny2],
    hookL: isoP(along(left, [V, BEAM_HD])),
    hookR: isoP(along(right, [V, BEAM_HD])),
    panL: panTransform(left),
    panR: panTransform(right),
  };
}

/** Fixed dial behind the needle: ticks from -MAX_TILT to +MAX_TILT. */
const DIAL_TICKS = [-1, -0.5, 0, 0.5, 1].map((k) => {
  const phi = k * MAX_TILT;
  const dir: P3 = [-Math.sin(phi) * R2, Math.sin(phi) * R2, Math.cos(phi)];
  const base = along(PIVOT, [V, -BEAM_HD]);
  return { k, a: along(base, [dir, NEEDLE + 0.12]), b: along(base, [dir, NEEDLE + (k === 0 ? 0.42 : 0.3)]) };
});

/** Screen position of the pivot pin on the beam's front face. */
const PIN = isoP(along(PIVOT, [V, BEAM_HD]));

/* ------------------------------------------------------------------------ */
/* Parts                                                                     */
/* ------------------------------------------------------------------------ */

const FLUTES = [-0.3, -0.1, 0.1, 0.3];

function Column() {
  const shaft = 0.45;
  const z0 = 0.55;
  const z1 = 4.6;
  return (
    <g>
      {/* stylobate, plinth, torus */}
      <CBox half={1.25} z={-0.3} h={0.3} tone={TONES.plate} />
      <CBox half={0.8} z={0} h={0.3} tone={TONES.base} />
      <CBox half={0.6} z={0.3} h={0.25} tone={TONES.raised} />
      {/* fluted shaft */}
      <CBox half={shaft} z={z0} h={z1 - z0} tone={TONES.base} />
      {FLUTES.map((f) => (
        <g key={f}>
          <Seg a={[f, shaft, z0 + 0.12]} b={[f, shaft, z1 - 0.12]} stroke="#161616" width={2} />
          <Seg a={[shaft, f, z0 + 0.12]} b={[shaft, f, z1 - 0.12]} stroke="#0e0e0e" width={2} />
        </g>
      ))}
      {/* echinus, abacus, fulcrum */}
      <CBox half={0.62} z={z1} h={0.18} tone={TONES.raised} />
      <CBox half={0.82} z={z1 + 0.18} h={0.22} tone={TONES.base} />
      <Box x={-0.18} y={-0.18} z={z1 + 0.4} w={0.36} d={0.36} h={0.12} tone={TONES.raised} />
    </g>
  );
}

function Dish({ tone }: { tone: Tone }) {
  return <CBox half={PAN_HALF} z={0} h={PAN_TOP} tone={tone} />;
}

/** Chains from the beam hook (local z = CHAIN) to the dish's back and side corners. */
function Chains() {
  const hook: P3 = [0, 0, CHAIN];
  const corners: P3[] = [
    [-PAN_HALF, -PAN_HALF, PAN_TOP],
    [-PAN_HALF, PAN_HALF, PAN_TOP],
    [PAN_HALF, -PAN_HALF, PAN_TOP],
  ];
  return (
    <g>
      {corners.map((c, i) => (
        <Seg key={i} a={hook} b={c} stroke={i === 0 ? "#2a2a2a" : "#5a5a5a"} width={1.5} />
      ))}
    </g>
  );
}

function Counterweight({ lit }: { lit: boolean }) {
  const half = 0.62;
  const h = 1.0;
  const z = PAN_TOP;
  return (
    <g>
      <CBox half={half} z={z} h={h} tone={lit ? LIT : TONES.bright} />
      <CBox half={0.18} z={z + h} h={0.14} tone={lit ? LIT : TONES.raised} />
      <text
        transform={onLeftFace(-half + 0.2, half, z + 0.62)}
        className="font-pixel"
        fontSize={13}
        letterSpacing={1}
        style={{ fill: lit ? LIME_DEEP : "#1a1a1a", transition: FILL_TRANSITION }}
      >
        {FULL}
      </text>
    </g>
  );
}

function WeightBlock({ index, lit }: { index: number; lit: boolean }) {
  const c = RUBRIC[index];
  const h = c.points * PER_POINT;
  // Leader from the block's leftmost edge, out past the dish, to the label.
  const [lx, ly] = iso(-BLOCK_HALF, BLOCK_HALF, h / 2);
  const [dx] = iso(-PAN_HALF, PAN_HALF, 0);
  const tx = dx - 12;
  return (
    <g>
      <Box x={-BLOCK_HALF} y={-BLOCK_HALF} z={0} w={BLOCK_HALF * 2} d={BLOCK_HALF * 2} h={h} tone={lit ? LIT : TONES.raised} />
      <line
        x1={lx - 2}
        y1={ly}
        x2={tx + 4}
        y2={ly}
        strokeWidth={1}
        strokeDasharray="2 3"
        style={{ stroke: lit ? LIME : "#4a4a4a", transition: FILL_TRANSITION }}
      />
      <text
        x={tx}
        y={ly}
        dy="0.35em"
        textAnchor="end"
        className="font-pixel uppercase"
        fontSize={10}
        letterSpacing={1}
        style={{ fill: lit ? LIME : "#7e7e7e", transition: FILL_TRANSITION }}
      >
        {c.label}{" "}
        <tspan style={{ fill: lit ? LIME : "#b5b5b5", transition: FILL_TRANSITION }}>{c.points}</tspan>
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------------ */
/* Reduced-motion preference                                                 */
/* ------------------------------------------------------------------------ */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

/* ------------------------------------------------------------------------ */
/* Component                                                                 */
/* ------------------------------------------------------------------------ */

const sumPoints = (idx: readonly number[]) => idx.reduce((s, i) => s + RUBRIC[i].points, 0);
const easeIn = (t: number) => t * t;

type Drop = { index: number; t: number };

export default function ThemisScale({ className = "" }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  /** Blocks on the left pan, bottom to top, in the order they were placed. */
  const [order, setOrder] = useState<number[]>([]);
  /** Criterion last placed or removed; -1 means the pan was just cleared. */
  const [active, setActive] = useState(-1);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(true);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<SVGPolygonElement>(null);
  const topRef = useRef<SVGPolygonElement>(null);
  const needleRef = useRef<SVGLineElement>(null);
  const tipRef = useRef<SVGCircleElement>(null);
  const hookLRef = useRef<SVGCircleElement>(null);
  const hookRRef = useRef<SVGCircleElement>(null);
  const panLRef = useRef<SVGGElement>(null);
  const panRRef = useRef<SVGGElement>(null);
  const blockRefs = useRef<(SVGGElement | null)[]>([]);

  /** Physics and tour state live in refs so the RAF loop doesn't re-render every frame. */
  const thetaRef = useRef(targetTilt(0));
  const omegaRef = useRef(0);
  const elapsedRef = useRef(0);
  const dropRef = useRef<Drop | null>(null);

  const shown = reduced ? ALL : order;
  const shownActive = reduced ? 0 : active;
  const total = sumPoints(shown);
  const placed = new Set(shown);
  const paused = hovered || focused || !inView;

  const applyRig = useCallback((theta: number) => {
    const r = rig(theta);
    frontRef.current?.setAttribute("points", r.front);
    topRef.current?.setAttribute("points", r.top);
    const nd = needleRef.current;
    if (nd) {
      nd.setAttribute("x1", String(r.needle[0]));
      nd.setAttribute("y1", String(r.needle[1]));
      nd.setAttribute("x2", String(r.needle[2]));
      nd.setAttribute("y2", String(r.needle[3]));
    }
    tipRef.current?.setAttribute("cx", String(r.needle[2]));
    tipRef.current?.setAttribute("cy", String(r.needle[3]));
    hookLRef.current?.setAttribute("cx", String(r.hookL[0]));
    hookLRef.current?.setAttribute("cy", String(r.hookL[1]));
    hookRRef.current?.setAttribute("cx", String(r.hookR[0]));
    hookRRef.current?.setAttribute("cy", String(r.hookR[1]));
    panLRef.current?.setAttribute("transform", r.panL);
    panRRef.current?.setAttribute("transform", r.panR);
  }, []);

  const applyDrop = useCallback(() => {
    const d = dropRef.current;
    blockRefs.current.forEach((g, i) => {
      if (!g) return;
      const lift = d && d.index === i ? DROP_H * (1 - easeIn(Math.min(1, d.t / DROP_MS))) : 0;
      g.setAttribute("transform", `translate(0 ${(-lift * S).toFixed(2)})`);
    });
  }, []);

  // Every render rewrites the rig from the live physics state before paint, so
  // React's render-time attributes never flash the target pose.
  useLayoutEffect(() => {
    if (reduced) {
      thetaRef.current = 0;
      omegaRef.current = 0;
      dropRef.current = null;
    }
    applyRig(thetaRef.current);
    applyDrop();
  });

  // Pause while the figure is scrolled out of view.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* ---- actions ---------------------------------------------------------- */

  const place = useCallback(
    (i: number) => {
      if (!reduced) dropRef.current = { index: i, t: 0 };
      setOrder((o) => (o.includes(i) ? o : [...o, i]));
      setActive(i);
    },
    [reduced],
  );

  const lift = useCallback((i: number) => {
    if (dropRef.current?.index === i) dropRef.current = null;
    setOrder((o) => o.filter((j) => j !== i));
    setActive(i);
  }, []);

  /** Advance the idle tour by one beat: place the next block, or clear a full pan. */
  const tourBeat = useCallback(() => {
    if (order.length >= RUBRIC.length) {
      dropRef.current = null;
      setOrder([]);
      setActive(-1);
      return;
    }
    const next = ALL.find((i) => !order.includes(i));
    if (next !== undefined) place(next);
  }, [order, place]);

  /* ---- animation loop --------------------------------------------------- */

  useLayoutEffect(() => {
    if (reduced || !inView) return;

    const landed = () => {
      const d = dropRef.current;
      return total - (d ? RUBRIC[d.index].points : 0);
    };
    const beatMs = order.length === 0 ? EMPTY_MS : order.length >= RUBRIC.length ? HOLD_MS : STEP_MS;

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;

      // Falling block: lands, then kicks the beam down on its side.
      const d = dropRef.current;
      if (d) {
        d.t += dt;
        if (d.t >= DROP_MS) {
          omegaRef.current += RUBRIC[d.index].points * LAND_KICK;
          dropRef.current = null;
        }
        applyDrop();
      }

      // Damped spring toward torque balance, integrated in small sub-steps.
      const target = targetTilt(landed());
      let remaining = dt / 1000;
      while (remaining > 0) {
        const h = Math.min(remaining, 1 / 120);
        const acc = SPRING_K * (target - thetaRef.current) - SPRING_C * omegaRef.current;
        omegaRef.current += acc * h;
        thetaRef.current += omegaRef.current * h;
        remaining -= h;
      }
      applyRig(thetaRef.current);

      if (!paused) {
        elapsedRef.current += dt;
        if (elapsedRef.current >= beatMs) {
          elapsedRef.current = 0;
          tourBeat();
          return; // the effect restarts with the new pan contents
        }
      }

      const settled =
        !dropRef.current && Math.abs(target - thetaRef.current) < 1e-4 && Math.abs(omegaRef.current) < 1e-4;
      if (paused && settled) return; // nothing to animate until the next interaction
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [order, total, paused, inView, reduced, tourBeat, applyRig, applyDrop]);

  /* ---- input ------------------------------------------------------------ */

  const toggle = (i: number) => {
    if (reduced) return;
    elapsedRef.current = 0;
    if (order.includes(i)) lift(i);
    else place(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (reduced) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = ALL.find((i) => !order.includes(i));
      elapsedRef.current = 0;
      if (next !== undefined) place(next);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const top = order[order.length - 1];
      elapsedRef.current = 0;
      if (top !== undefined) lift(top);
    }
  };

  /* ---- render ----------------------------------------------------------- */

  // Render-time pose (overwritten before paint by the live physics state).
  const pose = rig(reduced ? 0 : targetTilt(total));
  const activeOnPan = shownActive >= 0 && placed.has(shownActive);
  const weightLit = !activeOnPan;

  // Stack offsets, bottom to top.
  const stack = shown.map((i, k) => ({ i, base: PAN_TOP + sumPoints(shown.slice(0, k)) * PER_POINT }));

  const readout = describe(shownActive, placed, total);

  return (
    <div className={`w-full max-w-[640px] font-plex ${className}`}>
      <div
        ref={wrapperRef}
        tabIndex={0}
        role="group"
        aria-roledescription="interactive diagram"
        aria-label="Themis scale. Use the right arrow key to add the next rubric weight and the left arrow key to remove the last one."
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
        onKeyDown={onKeyDown}
        className="outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
      >
        <svg viewBox="-400 -282 650 362" role="img" aria-label={ARIA_LABEL} className="block h-auto w-full">
          {/* dial behind the beam */}
          {DIAL_TICKS.map((t) => (
            <Seg key={t.k} a={t.a} b={t.b} stroke={t.k === 0 ? "#8a8a8a" : "#3a3a3a"} width={t.k === 0 ? 2 : 1.5} />
          ))}

          <Column />

          {/* left pan: the rubric */}
          <g ref={panLRef} transform={pose.panL}>
            <Chains />
            <Dish tone={TONES.base} />
            {stack.map(({ i, base }) => (
              <g
                key={RUBRIC[i].label}
                style={{ transform: `translate(0px, ${(-base * S).toFixed(2)}px)`, transition: "transform 300ms ease" }}
              >
                <g
                  ref={(el) => {
                    blockRefs.current[i] = el;
                  }}
                >
                  <WeightBlock index={i} lit={i === shownActive} />
                </g>
              </g>
            ))}
          </g>

          {/* right pan: the counterweight */}
          <g ref={panRRef} transform={pose.panR}>
            <Chains />
            <Dish tone={TONES.base} />
            <Counterweight lit={weightLit} />
          </g>

          {/* beam, front then top, with the needle and hooks over it */}
          <polygon
            ref={frontRef}
            points={pose.front}
            stroke="#000"
            strokeWidth={1}
            strokeLinejoin="round"
            fill={TONES.raised.left}
          />
          <polygon
            ref={topRef}
            points={pose.top}
            stroke="#000"
            strokeWidth={1}
            strokeLinejoin="round"
            fill={TONES.raised.top}
          />
          <line
            ref={needleRef}
            x1={pose.needle[0]}
            y1={pose.needle[1]}
            x2={pose.needle[2]}
            y2={pose.needle[3]}
            stroke="#8a8a8a"
            strokeWidth={2}
          />
          <circle ref={tipRef} cx={pose.needle[2]} cy={pose.needle[3]} r={3} fill="#8a8a8a" />
          <circle cx={PIN[0]} cy={PIN[1]} r={4} fill="#121212" stroke="#8a8a8a" />
          <circle ref={hookLRef} cx={pose.hookL[0]} cy={pose.hookL[1]} r={3} fill="#121212" stroke="#5a5a5a" />
          <circle ref={hookRRef} cx={pose.hookR[0]} cy={pose.hookR[1]} r={3} fill="#121212" stroke="#5a5a5a" />

          {/* column caption */}
          <text
            x={iso(0.82, 0.82, 0)[0]}
            y={iso(0.82, 0.82, 0)[1] + 6}
            className="font-pixel uppercase"
            fontSize={10}
            letterSpacing={2}
            style={{ fill: "#5a5a5a" }}
          >
            Themis
          </text>
        </svg>

        <p className="mt-2 text-center font-pixel text-[10px] uppercase tracking-[0.25em] text-lightgray">{TAGLINE}</p>

        {/* Readout. Invisible copies of the longest states share one grid cell
            with the live one, so the panel never changes height. */}
        <div className="mt-5 grid border border-dashed border-hairline bg-surface p-4">
          {[...RUBRIC.map((_, i) => describe(i, new Set<number>(), 0)), describe(-1, new Set<number>(), 0)].map(
            (r, k) => (
              <div key={k} aria-hidden="true" className="invisible col-start-1 row-start-1">
                <ReadoutBody total={FULL} {...r} status="Paused" />
              </div>
            ),
          )}
          <div aria-live="polite" aria-atomic="true" className="col-start-1 row-start-1">
            <ReadoutBody total={total} {...readout} status={reduced ? "Still" : paused ? "Paused" : "Auto"} />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {RUBRIC.map((c, i) => {
            const on = placed.has(i);
            const lit = on && i === shownActive;
            const tone = lit
              ? "border-lime bg-lime-deep text-lime"
              : on
                ? "border-lightgray text-bright"
                : "border-hairline text-lightgray hover:text-bright";
            return (
              <button
                key={c.label}
                type="button"
                aria-pressed={on}
                disabled={reduced}
                onClick={() => toggle(i)}
                className={`flex items-baseline gap-2 border border-dashed px-3 py-2 text-left font-pixel text-[10px] uppercase tracking-[0.2em] transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime disabled:cursor-default ${
                  i === 0 ? "col-span-2 sm:col-span-1" : ""
                } ${tone}`}
              >
                <span className="font-dots text-base leading-none">{c.points}</span>
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type Readout = { label: string; points: number; detail: string };

function describe(active: number, placed: Set<number>, total: number): Readout {
  const left = FULL - total;
  if (active < 0) {
    return { label: "Counterweight", points: FULL, detail: "Empty pan. The rubric goes on the left." };
  }
  const c = RUBRIC[active];
  if (!placed.has(active)) {
    return { label: c.label, points: c.points, detail: `Off the pan. ${left} points to balance.` };
  }
  if (left === 0) {
    return { label: c.label, points: c.points, detail: `Balanced. All ${FULL} points are on the pan.` };
  }
  return { label: c.label, points: c.points, detail: `On the pan. ${left} points to balance.` };
}

function ReadoutBody({
  total,
  label,
  points,
  detail,
  status,
}: {
  total: number;
  label: string;
  points: number;
  detail: string;
  status: string;
}): ReactNode {
  return (
    <div className="flex items-start gap-4">
      <span className="flex items-baseline gap-2">
        {/* fixed width: "100" always reserves the slot */}
        <span className="grid font-dots text-5xl leading-none text-lime">
          <span aria-hidden="true" className="invisible col-start-1 row-start-1">
            {FULL}
          </span>
          <span className="col-start-1 row-start-1 text-right">{total}</span>
        </span>
        <span className="font-pixel text-[10px] uppercase tracking-[0.25em] text-lightgray">/ {FULL}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-pixel text-[11px] uppercase tracking-[0.25em] text-bright">
            {label} <span className="text-lime">{points}</span>
          </span>
          <span aria-hidden="true" className="font-pixel text-[9px] uppercase tracking-[0.25em] text-lightgray">
            {status}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-lightgray">{detail}</p>
      </div>
    </div>
  );
}
