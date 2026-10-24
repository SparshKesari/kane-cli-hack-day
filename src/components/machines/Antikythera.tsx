"use client";

import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { event, schedule, type Slot } from "@/data/hackday";
import { slotLabel, to12h, toMinutes } from "@/lib/time";
import { useDayState } from "@/lib/useDayState";

/* ------------------------------------------------------------------------ */
/* Copy                                                                      */
/* ------------------------------------------------------------------------ */

const TAGLINE = "The Antikythera mechanism, c. 150 BC — the first computer kept time too.";

const ARIA_LABEL =
  "Isometric drawing of the Antikythera mechanism reimagined as the Hack Day clock: a bronze case with a " +
  "64-tooth main gear driving a 32-tooth and a 16-tooth gear, and a dial ring marked with every start time " +
  "of the day. A hand on the main gear points at the time; the slot it is in lights up.";

/* ------------------------------------------------------------------------ */
/* Schedule on the dial                                                      */
/* ------------------------------------------------------------------------ */

/** Slots that share a start time share one mark on the dial. */
type Group = { start: string; min: number; slots: Slot[] };

const GROUPS: Group[] = schedule.reduce<Group[]>((acc, s) => {
  const last = acc[acc.length - 1];
  if (last && last.start === s.start) last.slots.push(s);
  else acc.push({ start: s.start, min: toMinutes(s.start), slots: [s] });
  return acc;
}, []);

/** The dial runs from the first start to half an hour after the last thing ends (as useDayState does). */
const DIAL_START = GROUPS[0].min;
const DIAL_END = Math.max(...schedule.map((s) => toMinutes(s.end ?? s.start) + 30));
/** The idle tour sweeps first start -> last start. */
const TOUR_END = GROUPS[GROUPS.length - 1].min;

function groupOf(m: number): number {
  let g = 0;
  GROUPS.forEach((grp, i) => {
    if (grp.min <= m) g = i;
  });
  return g;
}

const clampMin = (m: number) => Math.min(DIAL_END, Math.max(DIAL_START, m));
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;

/* ------------------------------------------------------------------------ */
/* Timing                                                                    */
/* ------------------------------------------------------------------------ */

const START_DWELL_MS = 700;
const SWEEP_MS = 12000;
const END_DWELL_MS = 1800;
const CYCLE_MS = START_DWELL_MS + SWEEP_MS + END_DWELL_MS;
/** Time constant of the hand chasing its target (ms). */
const TAU = 110;
const FILL_TRANSITION = "fill 250ms ease, stroke 250ms ease";

function tourMinute(t: number): number {
  if (t <= START_DWELL_MS) return DIAL_START;
  const p = Math.min(1, (t - START_DWELL_MS) / SWEEP_MS);
  return DIAL_START + (TOUR_END - DIAL_START) * p;
}

/* ------------------------------------------------------------------------ */
/* Isometric projection                                                      */
/* ------------------------------------------------------------------------ */

/** Pixels per world unit. */
const S = 40;
const COS30 = Math.cos(Math.PI / 6);

/** World (x, y, z) -> screen. World x runs down-right, y down-left, z up. */
// Rounded to 0.01px so server and browser render identical SVG attributes
// (float noise in trig would otherwise cause hydration mismatches).
const r2 = (v: number) => Math.round(v * 100) / 100;

function iso(x: number, y: number, z = 0): [number, number] {
  return [r2((x - y) * COS30 * S), r2(((x + y) * 0.5 - z) * S)];
}

type P3 = readonly [number, number, number];

function pts(points: readonly P3[]): string {
  return points
    .map((p) => {
      const [sx, sy] = iso(p[0], p[1], p[2]);
      return `${sx.toFixed(2)},${sy.toFixed(2)}`;
    })
    .join(" ");
}

const f2 = (n: number) => n.toFixed(3);

/**
 * Screen matrix for a world-plane rotation by `phi` (radians). Because the
 * projection is linear, a part drawn in local world-plane units inside a
 * group translated to its centre turns honestly with this one matrix.
 * Increasing phi is clockwise on screen.
 */
function rotMatrix(phi: number): string {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const k = COS30 * S;
  const h = 0.5 * S;
  return `matrix(${f2(k * (c - s))} ${f2(h * (c + s))} ${f2(-k * (s + c))} ${f2(h * (c - s))} 0 0)`;
}

function at(x: number, y: number, z: number): string {
  const [sx, sy] = iso(x, y, z);
  return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`;
}

/** Text laid on the +y face (lower left): local +x follows world +x, local +y is down. */
function onLeftFace(x: number, y: number, z: number): string {
  const [sx, sy] = iso(x, y, z);
  return `matrix(${COS30} 0.5 0 1 ${sx.toFixed(2)} ${sy.toFixed(2)})`;
}

/** Text laid on the +x face (lower right): local +x follows world -y, local +y is down. */
function onRightFace(x: number, y: number, z: number): string {
  const [sx, sy] = iso(x, y, z);
  return `matrix(${COS30} -0.5 0 1 ${sx.toFixed(2)} ${sy.toFixed(2)})`;
}

/* ------------------------------------------------------------------------ */
/* Palette                                                                   */
/* ------------------------------------------------------------------------ */

type Tone = { top: string; left: string; right: string };

const TONES = {
  base: { top: "#3a3a3a", left: "#2a2a2a", right: "#1a1a1a" },
  raised: { top: "#5a5a5a", left: "#3a3a3a", right: "#2a2a2a" },
  bright: { top: "#8a8a8a", left: "#5a5a5a", right: "#3a3a3a" },
} satisfies Record<string, Tone>;

const LIT: Tone = { top: "#daff52", left: "#b8d93f", right: "#86a324" };
const LIME = "#daff52";
const LIME_DEEP = "#1f2606";

/* ------------------------------------------------------------------------ */
/* Geometry                                                                  */
/* ------------------------------------------------------------------------ */

const DEG = Math.PI / 180;

/** Gear module (world units of pitch diameter per tooth). Same module = gears mesh. */
const MOD = 0.07;
const GEAR_H = 0.2;
const BEZEL_H = 0.3;
const HAND_Z = 0.36;
const BEZEL_RI = 2.42;
const BEZEL_RO = 3.05;
const LABEL_R = 3.75;

/** Direction (from the main arbor) of the gap in the dial where the train meshes: straight back. */
const ALPHA = -135 * DEG;
/** Direction from the 32 to the 16. */
const BETA = -90 * DEG;
const GAP = 60 * DEG;
const SWEEP = 2 * Math.PI - GAP;
const THETA0 = ALPHA + GAP / 2;

type GearDef = { id: "main" | "mid" | "small"; n: number; cx: number; cy: number };

const pitchR = (n: number) => (MOD * n) / 2;

const MAIN: GearDef = { id: "main", n: 64, cx: 0, cy: 0 };
const D1 = pitchR(64) + pitchR(32);
const MID: GearDef = { id: "mid", n: 32, cx: D1 * Math.cos(ALPHA), cy: D1 * Math.sin(ALPHA) };
const D2 = pitchR(32) + pitchR(16);
const SMALL: GearDef = { id: "small", n: 16, cx: MID.cx + D2 * Math.cos(BETA), cy: MID.cy + D2 * Math.sin(BETA) };

/** Hand angle for a minute of the day. The hand is pinned to the 64's arbor. */
const angleOf = (m: number) => THETA0 + ((clampMin(m) - DIAL_START) / (DIAL_END - DIAL_START)) * SWEEP;

/**
 * Rotations of the train for a main-gear angle. Teeth sit at rot + k*2pi/N;
 * each driven gear is phased so a gap faces its driver's tooth at the mesh,
 * and turns at -N_driver/N_driven: the 32 runs 2x backwards, the 16 runs 4x
 * forwards. Honest ratios, so the teeth stay meshed at every angle.
 */
function trainAngles(main: number) {
  const mid = ALPHA + Math.PI + Math.PI / MID.n - (MAIN.n / MID.n) * (main - ALPHA);
  const small = BETA + Math.PI + Math.PI / SMALL.n - (MID.n / SMALL.n) * (mid - BETA);
  return { main, mid, small, hand: main };
}

function polar(r: number, a: number): [number, number] {
  return [r * Math.cos(a), r * Math.sin(a)];
}

const local = (list: [number, number][]) => list.map(([x, y]) => `${f2(x)},${f2(y)}`).join(" ");

function gearOutline(n: number): string {
  const r = pitchR(n);
  const tip = r + MOD;
  const root = r - 1.25 * MOD;
  const p = (2 * Math.PI) / n;
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const c = k * p;
    out.push(polar(root, c - 0.3 * p), polar(tip, c - 0.16 * p), polar(tip, c + 0.16 * p), polar(root, c + 0.3 * p));
  }
  return local(out);
}

/** Four spoke windows, the way the surviving Antikythera wheels are cut. */
function gearWindows(n: number): string[] {
  const root = pitchR(n) - 1.25 * MOD;
  const r1 = root * 0.3;
  const r2 = root * 0.78;
  return [0, 1, 2, 3].map((q) => {
    const mid = q * (Math.PI / 2) + Math.PI / 4;
    const half = 34 * DEG;
    const arc: [number, number][] = [];
    for (let i = 0; i <= 10; i++) arc.push(polar(r2, mid - half + (2 * half * i) / 10));
    for (let i = 10; i >= 0; i--) arc.push(polar(r1, mid - half + (2 * half * i) / 10));
    return local(arc);
  });
}

function circleLocal(r: number, steps = 28): string {
  const out: [number, number][] = [];
  for (let i = 0; i < steps; i++) out.push(polar(r, (2 * Math.PI * i) / steps));
  return local(out);
}

type Wall = { points: P3[]; side: "left" | "right" };

/**
 * The visible part of a cylindrical wall (radius r around cx, cy, from angle
 * a0 to a1, height z0..z1), split into left/right-shaded runs. An outer wall
 * faces the viewer where its normal points toward +x/+y; an inner wall where
 * it points away.
 */
function cylWall(cx: number, cy: number, r: number, a0: number, a1: number, z0: number, z1: number, inner = false) {
  const steps = Math.max(1, Math.ceil((a1 - a0) / (2 * DEG)));
  const walls: Wall[] = [];
  let run: { side: Wall["side"]; angles: number[] } | null = null;
  const flush = () => {
    if (!run) return;
    const top = run.angles.map((a): P3 => [cx + r * Math.cos(a), cy + r * Math.sin(a), z1]);
    const bottom = run.angles.map((a): P3 => [cx + r * Math.cos(a), cy + r * Math.sin(a), z0]).reverse();
    walls.push({ points: [...top, ...bottom], side: run.side });
    run = null;
  };
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + ((a1 - a0) * i) / steps;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
    const m = (t0 + t1) / 2;
    const nx = inner ? -Math.cos(m) : Math.cos(m);
    const ny = inner ? -Math.sin(m) : Math.sin(m);
    if (nx + ny <= 0) {
      flush();
      continue;
    }
    const side = ny > nx ? "left" : "right";
    if (run && run.side === side) run.angles.push(t1);
    else {
      flush();
      run = { side, angles: [t0, t1] };
    }
  }
  flush();
  return walls;
}

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

function Walls({ walls, tone }: { walls: Wall[]; tone: Tone }) {
  return (
    <>
      {walls.map((w, i) => (
        <Face key={i} points={w.points} fill={w.side === "left" ? tone.left : tone.right} />
      ))}
    </>
  );
}

function Box({ x, y, z, w, d, h, tone }: { x: number; y: number; z: number; w: number; d: number; h: number; tone: Tone }) {
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

function Seg({ a, b, stroke, width = 2 }: { a: P3; b: P3; stroke: string; width?: number }) {
  const [x1, y1] = iso(a[0], a[1], a[2]);
  const [x2, y2] = iso(b[0], b[1], b[2]);
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
/* Parts                                                                     */
/* ------------------------------------------------------------------------ */

const INITIAL = trainAngles(angleOf(DIAL_START));
const TOOTH_SLICES = [0, 0.05, 0.1, 0.15];

/**
 * An extruded toothed disc: stacked tooth silhouettes for the flanks, a
 * smooth band for the rim below the teeth, then the top face with its
 * spokes. Everything that turns carries data-rot so the animation loop can
 * write one matrix to it without re-rendering.
 */
function Gear({ g, tone, spokes }: { g: GearDef; tone: Tone; spokes: boolean }) {
  const outline = gearOutline(g.n);
  const root = pitchR(g.n) - 1.25 * MOD;
  const rot = rotMatrix(INITIAL[g.id]);
  return (
    <g>
      {TOOTH_SLICES.map((z, i) => (
        <g key={z} transform={at(g.cx, g.cy, z)}>
          <g data-rot={g.id} transform={rot}>
            <polygon
              points={outline}
              fill={tone.right}
              stroke={i === 0 ? "#000" : "none"}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </g>
      ))}
      <Walls walls={cylWall(g.cx, g.cy, root, -Math.PI / 4, (7 * Math.PI) / 4, 0, GEAR_H)} tone={tone} />
      <g transform={at(g.cx, g.cy, GEAR_H)}>
        <g data-rot={g.id} transform={rot}>
          <polygon
            points={outline}
            fill={tone.top}
            stroke="#000"
            strokeWidth={1}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {spokes &&
            gearWindows(g.n).map((w, i) => (
              <polygon key={i} points={w} fill="#141414" stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
          <polygon
            points={circleLocal(Math.max(0.09, pitchR(g.n) * 0.12))}
            fill="#0b0b0b"
            stroke="#000"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </g>
    </g>
  );
}

/** One segment of the dial bezel: an extruded ring sector from a0 to a1. */
function BezelSegment({ a0, a1, lit, capStart, capEnd }: { a0: number; a1: number; lit: boolean; capStart: boolean; capEnd: boolean }) {
  const tone = lit ? LIT : TONES.raised;
  const caps: Wall[] = [];
  const cap = (a: number, nx: number, ny: number) => {
    if (nx + ny <= 0) return;
    const [ix, iy] = polar(BEZEL_RI, a);
    const [ox, oy] = polar(BEZEL_RO, a);
    caps.push({
      points: [[ix, iy, 0], [ox, oy, 0], [ox, oy, BEZEL_H], [ix, iy, BEZEL_H]],
      side: ny > nx ? "left" : "right",
    });
  };
  if (capStart) cap(a0, Math.sin(a0), -Math.cos(a0));
  if (capEnd) cap(a1, -Math.sin(a1), Math.cos(a1));

  const steps = Math.max(2, Math.ceil((a1 - a0) / (2 * DEG)));
  const top: P3[] = [];
  for (let i = 0; i <= steps; i++) {
    const [x, y] = polar(BEZEL_RO, a0 + ((a1 - a0) * i) / steps);
    top.push([x, y, BEZEL_H]);
  }
  for (let i = steps; i >= 0; i--) {
    const [x, y] = polar(BEZEL_RI, a0 + ((a1 - a0) * i) / steps);
    top.push([x, y, BEZEL_H]);
  }
  return (
    <g>
      <Walls walls={cylWall(0, 0, BEZEL_RI, a0, a1, 0, BEZEL_H, true)} tone={tone} />
      <Walls walls={caps} tone={tone} />
      <Walls walls={cylWall(0, 0, BEZEL_RO, a0, a1, 0, BEZEL_H)} tone={tone} />
      <Face points={top} fill={tone.top} />
    </g>
  );
}

const SEGMENTS = GROUPS.map((grp, i) => {
  const a0 = angleOf(grp.min);
  const a1 = angleOf(i + 1 < GROUPS.length ? GROUPS[i + 1].min : DIAL_END);
  const mid = (a0 + a1) / 2;
  return { i, a0, a1, depth: Math.cos(mid) + Math.sin(mid) };
}).sort((a, b) => a.depth - b.depth);

/** Half-hour graduations around the bezel. */
const GRADS = (() => {
  const out: number[] = [];
  for (let m = DIAL_START + 30; m < DIAL_END; m += 30) out.push(m);
  return out;
})();

function DialMarks({ active }: { active: number }) {
  return (
    <g>
      {GRADS.map((m) => {
        const a = angleOf(m);
        const [x1, y1] = polar(BEZEL_RO - 0.16, a);
        const [x2, y2] = polar(BEZEL_RO - 0.04, a);
        return <Seg key={m} a={[x1, y1, BEZEL_H]} b={[x2, y2, BEZEL_H]} stroke="#141414" width={1.5} />;
      })}
      {GROUPS.map((grp, i) => {
        const a = angleOf(grp.min);
        const lock = grp.slots.some((s) => s.deadline);
        const on = i === active;
        const [x1, y1] = polar(BEZEL_RI + 0.04, a);
        const [x2, y2] = polar(lock ? BEZEL_RO - 0.04 : BEZEL_RI + 0.32, a);
        const stroke = on ? LIME_DEEP : lock ? LIME : "#a8a8a8";
        return <Seg key={grp.start} a={[x1, y1, BEZEL_H]} b={[x2, y2, BEZEL_H]} stroke={stroke} width={lock ? 3 : 2} />;
      })}
    </g>
  );
}

/** Central arbor the hand rides on. */
function Hub() {
  const r = 0.26;
  const z1 = HAND_Z - 0.06;
  const top: P3[] = [];
  for (let i = 0; i < 28; i++) {
    const [x, y] = polar(r, (2 * Math.PI * i) / 28);
    top.push([x, y, z1]);
  }
  return (
    <g>
      <Walls walls={cylWall(0, 0, r, -Math.PI / 4, (7 * Math.PI) / 4, GEAR_H, z1)} tone={TONES.raised} />
      <Face points={top} fill={TONES.raised.top} />
    </g>
  );
}

const HAND_SHAPE = local([
  [-0.62, -0.1],
  [0.3, -0.09],
  [2.45, -0.05],
  [2.85, 0],
  [2.45, 0.05],
  [0.3, 0.09],
  [-0.62, 0.1],
]);

function Hand() {
  const rot = rotMatrix(INITIAL.hand);
  const layer = (z: number, fill: string, cap: string) => (
    <g transform={at(0, 0, z)}>
      <g data-rot="hand" transform={rot}>
        <polygon points={HAND_SHAPE} fill={fill} stroke="#000" strokeWidth={1} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <g transform="translate(-0.5 0)">
          <polygon points={circleLocal(0.17, 20)} fill={fill} stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </g>
        <polygon points={circleLocal(0.1, 16)} fill={cap} stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </g>
    </g>
  );
  return (
    <g>
      {layer(HAND_Z - 0.06, "#2a2a2a", "#2a2a2a")}
      {layer(HAND_Z, "#cfcfcf", "#5a5a5a")}
    </g>
  );
}

/** Bronze case with its inscriptions. */
const CASE = { x: -4, y: -5, w: 8, d: 9, z: -1, h: 1 };

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
function roman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}
const [EY, EM, ED] = event.date.split("-").map(Number);
const INSCRIPTION_LEFT = `${event.name} · ${event.city}`.toUpperCase();
const INSCRIPTION_RIGHT = `${roman(ED)} · ${roman(EM)} · ${roman(EY)}`;

function Case() {
  const { x, y, w, d, z, h } = CASE;
  const rivets: P3[] = [
    [x + 0.3, y + 0.3, 0],
    [x + w - 0.3, y + 0.3, 0],
    [x + w - 0.3, y + d - 0.3, 0],
    [x + 0.3, y + d - 0.3, 0],
  ];
  return (
    <g>
      <Box x={x} y={y} z={z} w={w} d={d} h={h} tone={TONES.base} />
      {/* a seam around the case, a third of the way down */}
      <Seg a={[x + w, y + d, -0.72]} b={[x, y + d, -0.72]} stroke="#141414" width={1} />
      <Seg a={[x + w, y + d, -0.72]} b={[x + w, y, -0.72]} stroke="#0b0b0b" width={1} />
      <text
        transform={onLeftFace(x + 0.4, y + d, -0.32)}
        className="font-pixel"
        fontSize={11}
        letterSpacing={2}
        fill="#7e7e7e"
      >
        {INSCRIPTION_LEFT}
      </text>
      <text
        transform={onRightFace(x + w, y + d - 0.4, -0.32)}
        className="font-pixel"
        fontSize={11}
        letterSpacing={2}
        fill="#5a5a5a"
      >
        {INSCRIPTION_RIGHT}
      </text>
      {rivets.map((p) => {
        const [cx, cy] = iso(p[0], p[1], p[2]);
        return <ellipse key={`${p[0]},${p[1]}`} cx={cx} cy={cy} rx={4} ry={2.3} fill="#5a5a5a" stroke="#000" />;
      })}
    </g>
  );
}

function DialLabel({ i, lit, onPick }: { i: number; lit: boolean; onPick: (i: number) => void }) {
  const grp = GROUPS[i];
  const [wx, wy] = polar(LABEL_R, angleOf(grp.min));
  const [x, y] = iso(wx, wy, 0);
  return (
    <g onClick={() => onPick(i)} style={{ cursor: "pointer" }}>
      <rect x={x - 22} y={y - 10} width={44} height={20} fill="transparent" />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        className="font-pixel"
        fontSize={11}
        letterSpacing={1}
        style={{ fill: lit ? LIME : "#7e7e7e", transition: FILL_TRANSITION }}
      >
        {to12h(grp.start)}
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

export default function Antikythera({ className = "" }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const day = useDayState();
  const live = day?.phase === "during";
  const liveMinute = day?.phase === "during" ? clampMin(day.minutes) : null;

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(true);
  /** A slot picked by hand while live or in the still frame; cleared when the pointer and focus leave. */
  const [manual, setManual] = useState<number | null>(null);
  const [tourGroup, setTourGroup] = useState(0);
  /** Bumped on a manual jump during the tour so a settled, paused loop wakes up. */
  const [jump, setJump] = useState(0);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const minuteRef = useRef(DIAL_START);
  const tourTRef = useRef(0);
  const tourGroupRef = useRef(0);

  const touring = !live && !reduced;
  const paused = hovered || focused || !inView;

  const active = touring ? tourGroup : (manual ?? (liveMinute !== null ? groupOf(liveMinute) : 0));
  const staticTarget = manual !== null ? GROUPS[manual].min : (liveMinute ?? DIAL_START);

  // Pause while scrolled out of view.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Drive the hand and the train. Transforms are written straight to the DOM;
  // React only re-renders when the lit slot changes.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const nodes = {
      main: svg.querySelectorAll('[data-rot="main"]'),
      mid: svg.querySelectorAll('[data-rot="mid"]'),
      small: svg.querySelectorAll('[data-rot="small"]'),
      hand: svg.querySelectorAll('[data-rot="hand"]'),
    };
    const place = (m: number) => {
      const r = trainAngles(angleOf(m));
      (Object.keys(nodes) as (keyof typeof nodes)[]).forEach((key) => {
        const t = rotMatrix(r[key]);
        nodes[key].forEach((n) => n.setAttribute("transform", t));
      });
    };

    if (reduced) {
      minuteRef.current = staticTarget;
      place(staticTarget);
      return;
    }
    place(minuteRef.current);
    if (!inView) return;

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      let target = staticTarget;
      if (touring) {
        if (!paused) tourTRef.current = (tourTRef.current + dt) % CYCLE_MS;
        target = tourMinute(tourTRef.current);
        const g = groupOf(target);
        if (g !== tourGroupRef.current) {
          tourGroupRef.current = g;
          setTourGroup(g);
        }
      }
      const k = 1 - Math.exp(-dt / TAU);
      let m = minuteRef.current + (target - minuteRef.current) * k;
      if (Math.abs(target - m) < 0.02) m = target;
      minuteRef.current = m;
      place(m);
      if (m === target && (!touring || paused)) return; // settled; deps restart us
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, inView, touring, paused, staticTarget, jump]);

  const goTo = (i: number) => {
    const n = GROUPS.length;
    const g = ((i % n) + n) % n;
    if (touring) {
      tourTRef.current = START_DWELL_MS + ((GROUPS[g].min - DIAL_START) / (TOUR_END - DIAL_START)) * SWEEP_MS;
      tourGroupRef.current = g;
      setTourGroup(g);
      setJump((j) => j + 1);
    } else {
      setManual(g);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(active + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(active - 1);
    }
  };

  const status = touring
    ? paused
      ? "Paused"
      : "Auto"
    : live
      ? manual !== null
        ? "Picked"
        : "Live"
      : "Still";
  const readTime = live && manual === null && liveMinute !== null ? hhmm(liveMinute) : GROUPS[active].start;

  const back = SEGMENTS.filter((s) => s.depth < 0);
  const front = SEGMENTS.filter((s) => s.depth >= 0);
  const segment = (s: (typeof SEGMENTS)[number]) => (
    <BezelSegment
      key={s.i}
      a0={s.a0}
      a1={s.a1}
      lit={s.i === active}
      capStart={s.i === 0}
      capEnd={s.i === GROUPS.length - 1}
    />
  );

  return (
    <div className={`w-full max-w-[640px] font-plex ${className}`}>
      <div
        ref={wrapperRef}
        tabIndex={0}
        role="group"
        aria-roledescription="interactive diagram"
        aria-label="Hack Day clock. Use the left and right arrow keys to step through the schedule."
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => {
          setHovered(false);
          if (!focused) setManual(null);
        }}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
            if (!hovered) setManual(null);
          }
        }}
        onKeyDown={onKeyDown}
        className="outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
      >
        <svg ref={svgRef} viewBox="-292 -196 616 406" role="img" aria-label={ARIA_LABEL} className="block h-auto w-full">
          <Case />
          {/* back to front: the train, the far half of the bezel, the main wheel, the near half */}
          <Gear g={SMALL} tone={TONES.raised} spokes={false} />
          <Gear g={MID} tone={TONES.raised} spokes />
          {back.map(segment)}
          <Gear g={MAIN} tone={TONES.bright} spokes />
          {front.map(segment)}
          <DialMarks active={active} />
          <Hub />
          <Hand />
          {GROUPS.map((grp, i) => (
            <DialLabel key={grp.start} i={i} lit={i === active} onPick={goTo} />
          ))}
        </svg>

        <p className="mt-2 text-center font-pixel text-[10px] uppercase tracking-[0.25em] text-lightgray">{TAGLINE}</p>

        {/* Readout. Invisible copies of every slot share one grid cell with
            the live one, so the panel is always as tall as the longest and
            never shifts the layout. */}
        <div className="mt-5 grid border border-dashed border-hairline bg-surface p-4">
          {GROUPS.map((grp) => (
            <div key={grp.start} aria-hidden="true" className="invisible col-start-1 row-start-1">
              <ReadoutBody time={grp.start} group={grp} status="Paused" />
            </div>
          ))}
          <div aria-live="polite" aria-atomic="true" className="col-start-1 row-start-1">
            <ReadoutBody time={readTime} group={GROUPS[active]} status={status} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadoutBody({ time, group, status }: { time: string; group: Group; status: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="min-w-[2.6em] font-dots text-5xl leading-none text-lime">{to12h(time)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex justify-end">
          <span aria-hidden="true" className="font-pixel text-[9px] uppercase tracking-[0.25em] text-lightgray">
            {status}
          </span>
        </div>
        <ul className="mt-1 space-y-2">
          {group.slots.map((s) => (
            <li key={s.title}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-pixel text-[11px] uppercase tracking-[0.25em] text-bright">{s.title}</span>
                {s.deadline && (
                  <span className="border border-lime px-1.5 py-0.5 font-pixel text-[9px] uppercase tracking-[0.25em] text-lime">
                    Due
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed text-lightgray">
                {slotLabel(s)}
                {s.note ? ` · ${s.note}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
