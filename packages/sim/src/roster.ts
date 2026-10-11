/**
 * The computer's pre-drawn fighters: a small roster in the same notebook-pencil style as the player's
 * own drawing (wobbly lines, a few parts gone over again). They are ordinary drawings, read by the same
 * rig reader, so they move, get stats and fall over exactly like a drawn fighter. Coordinates are the
 * notebook box (0..1, y down), standing roughly from y 0.08 (top of the head) to 0.93 (feet), facing +x.
 */
import type { InkStroke, Pt } from "@nf/shared";
import type { Difficulty } from "./sim";
import type { Pose } from "./anim";
import type { Signature } from "./powers";

export type RosterId = "bodybuilder" | "ninja" | "pehelwan" | "boxer" | "kid" | "karate" | "swordsman" | "dog" | "halloween" | "skeleton";
export type RosterEntry = {
  id: RosterId;
  name: string;
  blurb: string;
  tier: 1 | 2 | 3;
  strokes: InkStroke[];
  /** drawn this many times the usual figure height in the fight (stats are read from the drawing, not the size) */
  size?: number;
  /** pose offsets for how this body stands (see Animator.stance) */
  stance?: Partial<Pose>;
  /** its own special (instead of drawing itself a power to match yours) */
  signature?: Signature;
};

function pencil(seed: number) {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280 - 0.5;
  };
  const wob = (p: Pt, k = 0.004): Pt => ({ x: p.x + rnd() * k, y: p.y + rnd() * k });
  /** a hand-drawn line through the given points (each segment split into ~0.02 steps) */
  const path = (pts: [number, number][], k = 0.004): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 0.02));
      for (let j = i === 0 ? 0 : 1; j <= n; j++) out.push(wob({ x: ax + ((bx - ax) * j) / n, y: ay + ((by - ay) * j) / n }, k));
    }
    return out;
  };
  /** an ellipse (closed, a little overlap at the end like a real pencil circle) */
  const ellipse = (cx: number, cy: number, rx: number, ry: number, from = -Math.PI / 2, turn = 1.04, n = 26): Pt[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = from + (i / n) * Math.PI * 2 * turn;
      return wob({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }, 0.005);
    });
  /** an open arc of an ellipse from angle a0 to a1 */
  const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): Pt[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n;
      return wob({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }, 0.004);
    });
  return { path, ellipse, arc };
}

/** a line drawn n times side by side (a thick, dark, strong part): offsets stay inside the pass radius */
const thick = (color: string, pts: [number, number][], n: number, off: number, seed: number): InkStroke[] =>
  Array.from({ length: n }, (_, k) => {
    const d = (k - (n - 1) / 2) * off;
    return { color, points: pencil(seed + k).path(pts.map(([x, y]) => [x + d, y - d * 0.4] as [number, number])) };
  });

/** a costume line: drawn and skinned with the fighter, never read (see InkStroke.deco) */
const deco = (color: string, points: Pt[], where: "head" | "torso" | "auto" = "auto", w = 1): InkStroke => ({ color, points, deco: where, w });
/** a muscle bulge drawn alongside the bone a→b (side +1 / −1 picks which side), peaking amp away from it */
function bulge(seed: number, a: [number, number], b: [number, number], amp: number, side: 1 | -1, from = 0.08, to = 0.92): Pt[] {
  const p = pencil(seed);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = (-dy / L) * side;
  const ny = (dx / L) * side;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = from + ((to - from) * i) / 10;
    const o = 0.008 + amp * Math.sin(Math.PI * ((t - from) / (to - from)));
    pts.push([a[0] + dx * t + nx * o, a[1] + dy * t + ny * o]);
  }
  return p.path(pts, 0.002);
}
/** a quick back-and-forth scribble filling a band (masks, gloves) */
function scribble(seed: number, x0: number, x1: number, y0: number, y1: number, rows = 4): Pt[] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= rows; i++) {
    const y = y0 + ((y1 - y0) * i) / rows;
    pts.push(i % 2 ? [x1, y] : [x0, y]);
  }
  return pencil(seed).path(pts, 0.003);
}

/** heavier lead for the big guys (only how thick the line is drawn; the reading ignores it) */
const weigh = (w: number, strokes: InkStroke[]): InkStroke[] => strokes.map((st) => ({ ...st, w }));

/** a stroke and the same stroke drawn over again (a darker, stronger part) */
const twice = (color: string, pts: Pt[], again: Pt[]): InkStroke[] => [
  { color, points: pts },
  { color, points: again },
];

/** a point on the bone a→b at t, pushed o off it (positive o: the left of a→b with y down) */
function onBone(a: [number, number], b: [number, number], t: number, o: number): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  return [a[0] + dx * t + (dy / L) * o, a[1] + dy * t - (dx / L) * o];
}
/** a muscle contour along a bone: base offset, swelling by amp in the middle (a pencil line, gone over `passes` times) */
function muscle(_seed: number, a: [number, number], b: [number, number], side: 1 | -1, t0: number, t1: number, base: number, amp: number, peak = 0.5): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    const t = t0 + (t1 - t0) * u;
    const sw = u < peak ? Math.sin((Math.PI / 2) * (u / peak)) : Math.cos((Math.PI / 2) * ((u - peak) / (1 - peak)));
    pts.push(onBone(a, b, t, side * (base + amp * Math.max(0, sw))));
  }
  return pts;
}
/** pencil hatching: short parallel slanted strokes along a bone a→b, between offsets o0..o1 from it
 * (`gap` is the spacing of the strokes in drawing units, `slant` how far each stroke leans along the bone) */
function hatch(seed: number, a: [number, number], b: [number, number], t0: number, t1: number, o0: number, o1: number, gap = 0.011, slant = 1.1): Pt[][] {
  return shadeLines(seed, a, b, t0, t1, () => o0, () => o1, gap, slant);
}
function shadeLines(seed: number, a: [number, number], b: [number, number], t0: number, t1: number, in0: (u: number) => number, in1: (u: number) => number, gap: number, slant: number): Pt[][] {
  const BL = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n = Math.max(2, Math.round((BL * Math.abs(t1 - t0)) / gap));
  const p = pencil(seed);
  const out: Pt[][] = [];
  for (let i = 0; i <= n; i++) {
    const u = (i + 0.15 * Math.sin(seed + i * 2.3)) / n;
    const t = t0 + (t1 - t0) * u;
    const o0 = in0(u);
    const o1 = in1(u);
    const dt = (slant * Math.abs(o1 - o0)) / BL;
    const A = onBone(a, b, t, o0);
    const B = onBone(a, b, t + dt, o1);
    out.push(p.path([A, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], B], 0.0012));
  }
  return out;
}
/** shading inside a muscle contour (same shape args as `muscle`): strokes between fractions f0..f1 of its offset, over u0..u1 */
function shade(seed: number, a: [number, number], b: [number, number], side: 1 | -1, t0: number, t1: number, base: number, amp: number, peak: number, f0: number, f1: number, u0 = 0.1, u1 = 0.9, gap = 0.014, slant = 1.1): Pt[][] {
  const m = (u: number) => base + amp * Math.max(0, u < peak ? Math.sin((Math.PI / 2) * (u / peak)) : Math.cos((Math.PI / 2) * ((u - peak) / (1 - peak))));
  const U = (u: number) => u0 + (u1 - u0) * u;
  return shadeLines(seed, a, b, t0 + (t1 - t0) * u0, t0 + (t1 - t0) * u1, (u) => side * m(U(u)) * f0, (u) => side * m(U(u)) * f1, gap, slant);
}
const strokes = (color: string, lines: Pt[][], where: "head" | "torso" | "auto", w: number): InkStroke[] => lines.map((pts) => deco(color, pts, where, w));
/** the same line gone over a few times by a heavy pencil: a dark contour, then lighter wobbly re-traces */
function passes(color: string, seed: number, pts: [number, number][], where: "head" | "torso" | "auto", w: number, n = 2): InkStroke[] {
  return Array.from({ length: n }, (_, k) => deco(color, pencil(seed + k * 17).path(pts.map(([x, y]) => [x + (k ? 0.003 * Math.sin(seed + k) : 0), y + (k ? 0.003 * Math.cos(seed * 3 + k) : 0)] as [number, number]), 0.0035), where, k === 0 ? w : w * 0.55));
}
const mirror = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [1 - x, y]);

/**
 * The Bodybuilder: a hulking brute scribbled with a heavy green-graphite pencil. The skeleton lines
 * (what the reader rigs and scores) stay exactly as before but are drawn as faint construction lines;
 * the muscles, face and torn shorts are costume (deco) lines skinned onto those bones, so the reading,
 * the stats and every animation are unchanged while the drawing looks like a massive hunched hulk.
 */
function bodybuilder(): InkStroke[] {
  // graphite with a green tint; the same luminance as the old rust red, so the drawn strength is the same
  const c = "#3f5a2a";
  const shorts = "#5b3c7c";
  const p = pencil(21);
  // ---- the read skeleton (unchanged geometry), drawn light like a sketch's construction lines
  const read: InkStroke[] = [
    { color: c, points: p.ellipse(0.5, 0.145, 0.06, 0.065), w: 0.62 },
    ...weigh(0.16, thick(c, [[0.5, 0.215], [0.5, 0.56]], 3, 0.014, 210)),
    ...weigh(0.16, thick(c, [[0.5, 0.29], [0.37, 0.36], [0.33, 0.24]], 3, 0.011, 220)),
    ...weigh(0.16, thick(c, [[0.5, 0.29], [0.64, 0.35], [0.69, 0.24]], 3, 0.011, 230)),
    ...weigh(0.16, twice(c, p.path([[0.5, 0.56], [0.42, 0.74], [0.4, 0.93]]), pencil(24).path([[0.512, 0.56], [0.432, 0.74], [0.41, 0.93]]))),
    ...weigh(0.16, twice(c, p.path([[0.5, 0.56], [0.59, 0.74], [0.62, 0.93]]), pencil(25).path([[0.488, 0.56], [0.578, 0.74], [0.608, 0.93]]))),
    ...weigh(0.16, [{ color: c, points: p.arc(0.5, 0.3, 0.1, 0.07, 0.25, 2.9, 14) }, { color: c, points: pencil(26).arc(0.5, 0.305, 0.095, 0.065, 0.3, 2.85, 14) }]),
  ];
  // bones (drawing coordinates, facing +x: the front arm and leg are on the right)
  const sh: [number, number] = [0.5, 0.29];
  const eB: [number, number] = [0.37, 0.36], hB: [number, number] = [0.33, 0.24];
  const eF: [number, number] = [0.64, 0.35], hF: [number, number] = [0.69, 0.24];
  const hip: [number, number] = [0.5, 0.56];
  const kB: [number, number] = [0.42, 0.74], fB: [number, number] = [0.4, 0.93];
  const kF: [number, number] = [0.59, 0.74], fF: [number, number] = [0.62, 0.93];
  const D: InkStroke[] = [];
  const add = (...s: InkStroke[]) => D.push(...s);
  const line = (seed: number, pts: [number, number][], where: "head" | "torso" | "auto", w: number, col = c) => deco(col, pencil(seed).path(pts, 0.0025), where, w);
  const both = (seed: number, pts: [number, number][], where: "torso" | "auto", w: number, n = 2) => add(...passes(c, seed, pts, where, w, n), ...passes(c, seed + 500, mirror(pts), where, w, n));
  const H = 0.55; // hatching lead

  // ---- head: square jaw, angry brow, gritted teeth, messy hair (rigid with the head)
  add(...passes(c, 401, [[0.443, 0.148], [0.447, 0.186], [0.468, 0.207], [0.5, 0.212], [0.532, 0.207], [0.553, 0.186], [0.557, 0.148]], "head", 1.3));
  add(...passes(c, 402, [[0.45, 0.113], [0.474, 0.121], [0.498, 0.139]], "head", 1.9));
  add(...passes(c, 403, [[0.55, 0.113], [0.526, 0.121], [0.502, 0.139]], "head", 1.9));
  add(line(404, [[0.466, 0.143], [0.484, 0.148]], "head", 1.0), line(405, [[0.516, 0.148], [0.534, 0.143]], "head", 1.0));
  add(line(406, [[0.499, 0.145], [0.491, 0.163], [0.508, 0.164]], "head", 0.7));
  add(line(407, [[0.466, 0.172], [0.534, 0.172], [0.534, 0.193], [0.466, 0.193], [0.466, 0.172]], "head", 0.85));
  add(line(408, [[0.466, 0.1825], [0.534, 0.1825]], "head", 0.55));
  for (const [k, x] of [0.48, 0.494, 0.507, 0.52].entries()) add(line(409 + k * 3, [[x, 0.173], [x + 0.001, 0.192]], "head", 0.5));
  add(line(425, [[0.444, 0.106], [0.45, 0.073], [0.466, 0.094], [0.477, 0.062], [0.492, 0.09], [0.505, 0.058], [0.518, 0.089], [0.531, 0.064], [0.541, 0.093], [0.556, 0.074], [0.557, 0.108]], "head", 1.1));
  add(line(426, [[0.452, 0.098], [0.47, 0.082], [0.488, 0.096], [0.508, 0.079], [0.527, 0.094], [0.55, 0.085]], "head", 0.5));
  add(line(427, [[0.452, 0.16], [0.46, 0.168]], "head", 0.5), line(428, [[0.548, 0.16], [0.54, 0.168]], "head", 0.5));

  // ---- a thick neck and huge traps rising up the sides of the head: the head sinks between them
  both(430, [[0.462, 0.2], [0.458, 0.222], [0.452, 0.24]], "torso", 1.2);
  both(431, [[0.449, 0.168], [0.432, 0.195], [0.405, 0.218], [0.375, 0.237], [0.348, 0.256], [0.333, 0.272]], "auto", 1.45);
  add(...strokes(c, hatch(432, [0.446, 0.18], [0.36, 0.25], 0.05, 0.9, -0.002, 0.016, 0.012), "auto", H), ...strokes(c, hatch(932, [0.554, 0.18], [0.64, 0.25], 0.05, 0.9, 0.002, -0.016, 0.012), "auto", H));

  // ---- shoulders: big round deltoid caps riding on the upper arms
  add(...passes(c, 440, [[0.36, 0.25], [0.33, 0.268], [0.312, 0.298], [0.315, 0.334], [0.338, 0.358]], "auto", 1.4));
  add(...passes(c, 441, [[0.64, 0.25], [0.67, 0.268], [0.688, 0.298], [0.685, 0.334], [0.662, 0.356]], "auto", 1.4));
  add(line(442, [[0.352, 0.262], [0.345, 0.3], [0.358, 0.335]], "auto", 0.55), line(443, [[0.648, 0.262], [0.655, 0.3], [0.642, 0.333]], "auto", 0.55));
  add(...strokes(c, hatch(444, sh, eB, 0.62, 0.92, 0.05, 0.075), "auto", H), ...strokes(c, hatch(445, sh, eF, 0.62, 0.92, -0.05, -0.075), "auto", H));

  // ---- chest: a big V, two slab pecs shaded underneath, an 8-pack and a narrow waist
  both(450, [[0.5, 0.252], [0.46, 0.244], [0.425, 0.253], [0.4, 0.278], [0.394, 0.312], [0.414, 0.34], [0.455, 0.353], [0.5, 0.35]], "torso", 1.4);
  both(451, [[0.396, 0.33], [0.404, 0.385], [0.42, 0.44], [0.438, 0.495], [0.448, 0.54]], "torso", 1.4);
  add(...strokes(c, hatch(452, [0.415, 0.338], [0.498, 0.351], 0.05, 0.95, 0.0, 0.016, 0.011), "torso", H), ...strokes(c, hatch(952, [0.585, 0.338], [0.502, 0.351], 0.05, 0.95, 0.0, -0.016, 0.011), "torso", H));
  add(...strokes(c, hatch(453, [0.404, 0.36], [0.442, 0.52], 0.05, 0.95, 0.004, 0.02, 0.012), "torso", H), ...strokes(c, hatch(953, [0.596, 0.36], [0.558, 0.52], 0.05, 0.95, -0.004, -0.02, 0.012), "torso", H));
  add(line(455, [[0.5, 0.262], [0.5, 0.345]], "torso", 0.6));
  add(line(456, [[0.5, 0.362], [0.499, 0.44], [0.5, 0.525]], "torso", 0.8));
  both(458, [[0.468, 0.362], [0.462, 0.4], [0.464, 0.44], [0.468, 0.48], [0.476, 0.515]], "torso", 0.85, 1);
  for (const [k, y] of [0.395, 0.43, 0.465].entries()) {
    const hw = 0.036 - k * 0.002;
    add(line(460 + k, [[0.5 - hw, y - 0.004], [0.484, y + 0.002], [0.5, y - 0.002]], "torso", 0.75));
    add(line(470 + k, [[0.5, y - 0.002], [0.516, y + 0.002], [0.5 + hw, y - 0.004]], "torso", 0.75));
  }
  both(480, [[0.43, 0.43], [0.438, 0.47], [0.445, 0.505]], "torso", 0.6, 1);

  // ---- giant arms: biceps, triceps, veiny forearms, big clenched fists
  const arm = (seed: number, e: [number, number], h: [number, number], up: 1 | -1, fist: [number, number], far = false) => {
    const np = far ? 1 : 2;
    add(...passes(c, seed, muscle(seed, sh, e, up, 0.46, 1.05, 0.034, 0.07, 0.6), "auto", 1.4, np));
    add(...passes(c, seed + 1, muscle(seed + 1, sh, e, -up as 1 | -1, 0.55, 1.05, 0.03, 0.035, 0.45), "auto", 1.35, np));
    add(...strokes(c, shade(seed + 2, sh, e, -up as 1 | -1, 0.55, 1.05, 0.03, 0.035, 0.45, 0.3, 0.85), "auto", H), ...strokes(c, shade(seed + 12, sh, e, up, 0.46, 1.05, 0.034, 0.07, 0.6, 0.55, 0.9, 0.3, 0.85).filter(() => !far), "auto", H * 0.8));
    add(line(seed + 3, [onBone(sh, e, 0.62, up * 0.05), onBone(sh, e, 0.8, up * 0.07), onBone(sh, e, 0.98, up * 0.05)], "auto", 0.5));
    // forearm: from the elbow (bone e→h), widest near the elbow
    const fs = (up === 1 ? -1 : 1) as 1 | -1;
    add(...passes(c, seed + 4, muscle(seed + 4, e, h, fs, -0.08, 0.84, 0.028, 0.05, 0.3), "auto", 1.35, np));
    add(...passes(c, seed + 5, muscle(seed + 5, e, h, -fs as 1 | -1, -0.04, 0.84, 0.022, 0.03, 0.3), "auto", 1.3, np));
    add(...strokes(c, shade(seed + 6, e, h, fs, -0.08, 0.84, 0.028, 0.05, 0.3, 0.3, 0.85), "auto", H));
    add(line(seed + 7, [onBone(e, h, 0.15, -fs * 0.012), onBone(e, h, 0.35, -fs * 0.02), onBone(e, h, 0.5, -fs * 0.008), onBone(e, h, 0.7, -fs * 0.016)], "auto", far ? 0.2 : 0.4));
    // the fist: a big knuckly block around the hand, knuckle lines across it, shaded
    const [fx, fy] = fist;
    const r = 0.062;
    add(...passes(c, seed + 8, [[fx - r * 0.85, fy + r * 0.8], [fx - r, fy - r * 0.05], [fx - r * 0.75, fy - r * 0.85], [fx, fy - r], [fx + r * 0.75, fy - r * 0.85], [fx + r, fy - r * 0.05], [fx + r * 0.85, fy + r * 0.75], [fx, fy + r * 0.95], [fx - r * 0.85, fy + r * 0.8]], "auto", 1.4));
    add(line(seed + 9, [[fx - r * 0.82, fy - r * 0.3], [fx + r * 0.82, fy - r * 0.3]], "auto", 0.6));
    for (const k of [-0.42, 0, 0.42]) add(line(seed + 10 + k * 10, [[fx + r * k, fy - r * 0.92], [fx + r * k, fy - r * 0.32]], "auto", 0.45));
    add(line(seed + 15, [[fx - r * 0.75, fy + r * 0.1], [fx - r * 0.1, fy + r * 0.25], [fx - r * 0.05, fy + r * 0.6]], "auto", 0.5));
    add(...strokes(c, hatch(seed + 16, [fx - r * 0.7, fy + r * 0.35], [fx + r * 0.7, fy + r * 0.35], 0, 1, 0, -r * 0.45, 0.007), "auto", H));
  };
  arm(500, eB, hB, 1, [0.322, 0.21], true);
  arm(540, eF, hF, -1, [0.698, 0.21]);

  // ---- torn shorts (purple pencil): waistband, legs ripped into a jagged hem, scribbled in
  add(...passes(shorts, 600, [[0.446, 0.532], [0.5, 0.538], [0.554, 0.532]], "torso", 1.3));
  const legShorts = (seed: number, k: [number, number], s: 1 | -1) => {
    add(...passes(shorts, seed, [onBone(hip, k, -0.04, s * 0.066), onBone(hip, k, 0.25, s * 0.078), onBone(hip, k, 0.5, s * 0.076)], "auto", 1.25));
    add(line(seed + 1, [onBone(hip, k, 0.5, s * 0.076), onBone(hip, k, 0.6, s * 0.052), onBone(hip, k, 0.52, s * 0.03), onBone(hip, k, 0.63, s * 0.008), onBone(hip, k, 0.53, -s * 0.016), onBone(hip, k, 0.62, -s * 0.038), onBone(hip, k, 0.51, -s * 0.06)], "auto", 1.2, shorts));
    add(...strokes(shorts, hatch(seed + 2, hip, k, 0.1, 0.42, s * 0.012, s * 0.066, 0.013, 0.8), "auto", H));
    add(line(seed + 3, [onBone(hip, k, 0.6, s * 0.04), onBone(hip, k, 0.69, s * 0.044)], "auto", 0.45, shorts));
    add(line(seed + 4, [onBone(hip, k, 0.62, -s * 0.03), onBone(hip, k, 0.7, -s * 0.026)], "auto", 0.45, shorts));
  };
  legShorts(610, kB, -1);
  legShorts(620, kF, 1);
  add(line(630, [[0.47, 0.6], [0.5, 0.572], [0.53, 0.6]], "torso", 0.9, shorts));

  // ---- thick thighs and calves, heavy bare feet planted wide
  const leg = (seed: number, k: [number, number], f: [number, number], out: 1 | -1, toe: number) => {
    add(...passes(c, seed, muscle(seed, hip, k, out, 0.5, 1.04, 0.036, 0.034, 0.25), "auto", 1.35));
    add(...passes(c, seed + 1, muscle(seed + 1, hip, k, -out as 1 | -1, 0.52, 1.04, 0.03, 0.026, 0.3), "auto", 1.3));
    add(...passes(c, seed + 2, muscle(seed + 2, k, f, out, 0.04, 0.9, 0.022, 0.034, 0.3), "auto", 1.35));
    add(...passes(c, seed + 3, muscle(seed + 3, k, f, -out as 1 | -1, 0.04, 0.9, 0.02, 0.02, 0.35), "auto", 1.3));
    add(...strokes(c, shade(seed + 4, hip, k, out, 0.5, 1.04, 0.036, 0.034, 0.25, 0.45, 0.85, 0.42, 0.92, 0.014, 0.5), "auto", H));
    add(...strokes(c, shade(seed + 5, k, f, out, 0.04, 0.9, 0.022, 0.034, 0.3, 0.4, 0.85, 0.08, 0.8, 0.014, 0.5), "auto", H));
    add(line(seed + 6, [onBone(hip, k, 0.94, -0.016), onBone(hip, k, 1.0, 0), onBone(hip, k, 0.94, 0.016)], "auto", 0.55));
    add(line(seed + 7, [onBone(hip, k, 0.66, -out * 0.01), onBone(hip, k, 0.8, out * 0.004), onBone(hip, k, 0.9, -out * 0.006)], "auto", 0.45));
    const [x, y] = f;
    add(...passes(c, seed + 8, [[x - toe * 0.022, y - 0.036], [x - toe * 0.028, y + 0.004], [x + toe * 0.064, y + 0.007], [x + toe * 0.076, y - 0.012], [x + toe * 0.034, y - 0.024], [x + toe * 0.018, y - 0.036]], "auto", 1.35));
    add(line(seed + 9, [[x + toe * 0.05, y - 0.012], [x + toe * 0.05, y + 0.004]], "auto", 0.4));
  };
  leg(700, kB, fB, -1, -1);
  leg(720, kF, fF, 1, 1);
  // a sharp pencil: contours about half the default lead, hatching and face details finer still
  return [...read, ...D.map((st) => ({ ...st, w: (st.w ?? 1) * ((st.w ?? 1) >= 1.2 ? 0.45 : 0.3) }))];
}
function ninja(): InkStroke[] {
  const c = "#3a3470";
  const r = "#c23b32";
  const p = pencil(31);
  return [
    { color: c, points: p.ellipse(0.5, 0.15, 0.06, 0.068) },
    { color: c, points: p.path([[0.5, 0.22], [0.5, 0.55]]) },
    { color: c, points: p.path([[0.5, 0.29], [0.4, 0.37], [0.33, 0.33]]) },
    { color: c, points: p.path([[0.5, 0.29], [0.6, 0.37], [0.67, 0.34]]) },
    // a low stance
    { color: c, points: p.path([[0.5, 0.55], [0.4, 0.72], [0.36, 0.93]]) },
    { color: c, points: p.path([[0.5, 0.55], [0.62, 0.71], [0.64, 0.93]]) },
    // mask slit and the red headband with its tails
    { color: c, points: p.path([[0.46, 0.15], [0.55, 0.15]]) },
    { color: r, points: p.path([[0.442, 0.115], [0.56, 0.115]]) },
    { color: r, points: p.path([[0.442, 0.115], [0.4, 0.13], [0.37, 0.12]]) },
    // a short blade in the front hand
    { color: c, points: p.path([[0.67, 0.34], [0.76, 0.24]]) },
    // costume: the hood over the top of the head, the mask over the mouth, a red sash
    deco(c, scribble(321, 0.452, 0.548, 0.095, 0.13, 3), "head", 1.4),
    deco(c, scribble(322, 0.455, 0.545, 0.17, 0.205, 4), "head", 1.4),
    deco(r, pencil(323).path([[0.455, 0.45], [0.545, 0.45]]), "torso", 1.8),
    deco(r, pencil(324).path([[0.545, 0.45], [0.58, 0.5], [0.6, 0.53]]), "torso", 1.2),
  ];
}

function pehelwan(): InkStroke[] {
  const c = "#7a4a2a";
  const k = "#c23b32";
  const p = pencil(41);
  const q = pencil(42);
  return [
    { color: c, points: p.ellipse(0.5, 0.15, 0.065, 0.07) },
    ...weigh(2.2, twice(c, p.path([[0.5, 0.225], [0.5, 0.57]]), q.path([[0.503, 0.23], [0.497, 0.565]]))),
    // a big round belly around the trunk
    ...weigh(1.8, [{ color: c, points: p.arc(0.5, 0.38, 0.1, 0.12, 0.35, 2.8, 16) }]),
    ...weigh(1.7, [{ color: c, points: p.path([[0.5, 0.29], [0.37, 0.35], [0.31, 0.43]]) }, { color: c, points: p.path([[0.5, 0.29], [0.63, 0.35], [0.69, 0.43]]) }]),
    ...weigh(1.9, twice(c, p.path([[0.5, 0.57], [0.39, 0.73], [0.37, 0.93]]), q.path([[0.5, 0.572], [0.392, 0.732], [0.372, 0.928]]))),
    ...weigh(1.9, twice(c, p.path([[0.5, 0.57], [0.61, 0.73], [0.63, 0.93]]), q.path([[0.5, 0.572], [0.608, 0.732], [0.628, 0.928]]))),
    // langot / mawashi and a moustache
    { color: k, points: p.path([[0.41, 0.54], [0.5, 0.58], [0.59, 0.54]]) },
    { color: c, points: p.path([[0.47, 0.18], [0.5, 0.17], [0.535, 0.18]]) },
    // costume: the whole round belly, a navel, heavy thighs and shoulders
    deco(c, pencil(331).ellipse(0.5, 0.41, 0.115, 0.13, -Math.PI / 2, 1.02, 30), "torso", 1.6),
    deco(c, pencil(332).ellipse(0.5, 0.44, 0.008, 0.008, 0, 1, 8), "torso", 1.2),
    deco(c, bulge(333, [0.5, 0.57], [0.39, 0.73], 0.04, -1), "auto", 1.5),
    deco(c, bulge(334, [0.5, 0.57], [0.61, 0.73], 0.04, 1), "auto", 1.5),
    deco(c, bulge(335, [0.5, 0.29], [0.37, 0.35], 0.03, 1), "auto", 1.4),
    deco(c, bulge(336, [0.5, 0.29], [0.63, 0.35], 0.03, -1), "auto", 1.4),
    deco(k, scribble(337, 0.43, 0.57, 0.545, 0.6, 4), "torso", 1.4),
  ];
}

function boxer(): InkStroke[] {
  const c = "#6b2f6b";
  const g = "#c23b32";
  const p = pencil(51);
  return [
    { color: c, points: p.ellipse(0.5, 0.15, 0.06, 0.068) },
    { color: c, points: p.path([[0.5, 0.22], [0.5, 0.55]]) },
    // guard up: fists by the chin
    { color: c, points: p.path([[0.5, 0.29], [0.41, 0.37], [0.43, 0.27]]) },
    { color: c, points: p.path([[0.5, 0.29], [0.6, 0.38], [0.66, 0.29]]) },
    { color: c, points: p.path([[0.5, 0.55], [0.42, 0.73], [0.38, 0.93]]) },
    { color: c, points: p.path([[0.5, 0.55], [0.6, 0.73], [0.63, 0.93]]) },
    // gloves (round fists) and red trunks
    { color: c, points: p.ellipse(0.665, 0.275, 0.026, 0.024, -Math.PI / 2, 1.05, 14) },
    { color: c, points: p.ellipse(0.43, 0.26, 0.026, 0.024, -Math.PI / 2, 1.05, 14) },
    { color: g, points: p.path([[0.44, 0.55], [0.56, 0.55], [0.58, 0.62]]) },
    // costume: red gloves filled in, the trunks filled in, a waistband
    deco(g, scribble(341, 0.645, 0.685, 0.257, 0.293, 4), "auto", 1.5),
    deco(g, scribble(342, 0.41, 0.45, 0.242, 0.278, 4), "auto", 1.5),
    deco(g, scribble(343, 0.44, 0.56, 0.535, 0.6, 5), "torso", 1.4),
  ];
}

function kid(): InkStroke[] {
  const c = "#2f7d4a";
  const p = pencil(61);
  return [
    { color: c, points: p.ellipse(0.5, 0.16, 0.068, 0.075) },
    { color: c, points: p.path([[0.5, 0.235], [0.5, 0.57]]) },
    { color: c, points: p.path([[0.5, 0.31], [0.41, 0.4], [0.38, 0.49]]) },
    { color: c, points: p.path([[0.5, 0.31], [0.6, 0.4], [0.63, 0.48]]) },
    { color: c, points: p.path([[0.5, 0.57], [0.45, 0.75], [0.44, 0.93]]) },
    { color: c, points: p.path([[0.5, 0.57], [0.56, 0.75], [0.57, 0.93]]) },
    // a cap with a peak, and a grin
    { color: c, points: p.path([[0.435, 0.11], [0.5, 0.075], [0.565, 0.11], [0.62, 0.115]]) },
    { color: c, points: p.arc(0.51, 0.17, 0.025, 0.018, 0.3, 2.8, 6) },
  ];
}

function karate(): InkStroke[] {
  const c = "#1f6f78";
  const p = pencil(71);
  const q = pencil(72);
  return [
    { color: c, points: p.ellipse(0.5, 0.15, 0.062, 0.07) },
    { color: c, points: p.path([[0.5, 0.22], [0.5, 0.55]]) },
    // one fist chambered at the hip, one punching out
    { color: c, points: p.path([[0.5, 0.29], [0.42, 0.38], [0.45, 0.46]]) },
    ...twice(c, p.path([[0.5, 0.29], [0.62, 0.32], [0.74, 0.3]]), q.path([[0.5, 0.292], [0.618, 0.322], [0.738, 0.302]])),
    // a wide front stance
    { color: c, points: p.path([[0.5, 0.55], [0.39, 0.72], [0.33, 0.93]]) },
    ...twice(c, p.path([[0.5, 0.55], [0.63, 0.7], [0.68, 0.93]]), q.path([[0.5, 0.552], [0.628, 0.702], [0.678, 0.928]])),
    // gi lapels, black belt with its knot, headband
    { color: c, points: p.path([[0.46, 0.25], [0.5, 0.33], [0.54, 0.25]]) },
    { color: c, points: p.path([[0.44, 0.5], [0.56, 0.5]]) },
    { color: c, points: p.path([[0.5, 0.5], [0.47, 0.56], [0.53, 0.57]]) },
    { color: "#c4962c", points: p.path([[0.44, 0.115], [0.56, 0.115]]) },
    // costume: the gi jacket's sides and sleeves, a thick black belt
    deco(c, pencil(351).path([[0.43, 0.27], [0.43, 0.52]]), "torso", 1.1),
    deco(c, pencil(352).path([[0.57, 0.27], [0.57, 0.52]]), "torso", 1.1),
    deco(c, bulge(353, [0.5, 0.29], [0.42, 0.38], 0.022, 1), "auto", 1.1),
    deco(c, bulge(354, [0.5, 0.29], [0.62, 0.32], 0.022, -1), "auto", 1.1),
    deco("#2a241c", pencil(355).path([[0.43, 0.5], [0.57, 0.5]]), "torso", 2.4),
  ];
}

function swordsman(): InkStroke[] {
  const c = "#1d4f89";
  const s = "#2a241c";
  const p = pencil(81);
  return [
    { color: c, points: p.ellipse(0.5, 0.15, 0.06, 0.068) },
    { color: c, points: p.path([[0.5, 0.22], [0.5, 0.55]]) },
    { color: c, points: p.path([[0.5, 0.29], [0.4, 0.37], [0.36, 0.45]]) },
    { color: c, points: p.path([[0.5, 0.29], [0.6, 0.36], [0.66, 0.4]]) },
    { color: c, points: p.path([[0.5, 0.55], [0.42, 0.73], [0.38, 0.93]]) },
    { color: c, points: p.path([[0.5, 0.55], [0.6, 0.73], [0.63, 0.93]]) },
    // the sword held out front, with a crossguard; a plume on the helmet
    { color: s, points: p.path([[0.66, 0.4], [0.86, 0.2]]) },
    { color: s, points: p.path([[0.65, 0.36], [0.7, 0.42]]) },
    { color: "#c23b32", points: p.path([[0.5, 0.082], [0.47, 0.04], [0.43, 0.05]]) },
  ];
}

function dog(): InkStroke[] {
  const c = "#7a4a2a";
  const p = pencil(91);
  return [
    { color: c, points: p.ellipse(0.74, 0.36, 0.07, 0.065) },
    { color: c, points: p.path([[0.28, 0.5], [0.68, 0.48]]) },
    { color: c, points: p.path([[0.3, 0.5], [0.26, 0.7], [0.27, 0.9]]) },
    { color: c, points: p.path([[0.36, 0.5], [0.38, 0.7], [0.36, 0.9]]) },
    { color: c, points: p.path([[0.62, 0.49], [0.6, 0.7], [0.62, 0.9]]) },
    { color: c, points: p.path([[0.67, 0.49], [0.7, 0.7], [0.69, 0.9]]) },
    { color: c, points: p.path([[0.28, 0.5], [0.2, 0.42], [0.16, 0.34]]) },
    { color: c, points: p.path([[0.72, 0.3], [0.7, 0.24], [0.76, 0.29]]) },
  ];
}

/** the Bodybuilder stands like a hulk: arms hanging wide, elbows loose, feet planted wide */
/** a pumpkin-headed scarecrow: a carved jack-o'-lantern on a ragged black cloak, scribbled like the Hulk */
function halloween(): InkStroke[] {
  const o = "#e07a2f";
  const k = "#2a241c";
  const g = "#2f7d4a";
  const p = pencil(91);
  const read: InkStroke[] = [
    // the pumpkin is the head (a wide loop), then a plain stick body under the cloak
    { color: o, points: p.ellipse(0.5, 0.155, 0.078, 0.066) },
    { color: k, points: p.path([[0.5, 0.222], [0.5, 0.56]]) },
    { color: k, points: p.path([[0.5, 0.3], [0.405, 0.39], [0.37, 0.47]]) },
    { color: k, points: p.path([[0.5, 0.3], [0.6, 0.385], [0.64, 0.46]]) },
    { color: k, points: p.path([[0.5, 0.56], [0.45, 0.745], [0.44, 0.93]]) },
    { color: k, points: p.path([[0.5, 0.56], [0.56, 0.745], [0.575, 0.93]]) },
  ];
  const q = pencil(92);
  const D: InkStroke[] = [
    // pumpkin ribs, stem and curly vine
    deco(o, q.arc(0.5, 0.155, 0.035, 0.064, -1.45, 1.45, 10), "head", 0.7),
    deco(o, q.arc(0.5, 0.155, 0.035, 0.064, 1.69, 4.59, 10), "head", 0.7),
    deco(g, q.path([[0.495, 0.092], [0.5, 0.07], [0.515, 0.062]]), "head", 1.1),
    deco(g, q.arc(0.53, 0.075, 0.016, 0.012, 3.4, 8.6, 10), "head", 0.6),
    // carved face: triangle eyes, a jagged grin
    deco(k, q.path([[0.47, 0.145], [0.485, 0.122], [0.497, 0.145], [0.47, 0.145]]), "head", 0.9),
    deco(k, q.path([[0.515, 0.145], [0.53, 0.122], [0.542, 0.145], [0.515, 0.145]]), "head", 0.9),
    deco(k, q.path([[0.462, 0.172], [0.477, 0.188], [0.49, 0.176], [0.503, 0.192], [0.516, 0.177], [0.53, 0.19], [0.548, 0.17]]), "head", 0.9),
    // a ragged cloak from the shoulders to the knees, torn at the hem
    deco(k, q.path([[0.47, 0.235], [0.43, 0.32], [0.415, 0.45], [0.41, 0.6], [0.42, 0.66]]), "torso", 1.1),
    deco(k, q.path([[0.53, 0.235], [0.57, 0.32], [0.585, 0.45], [0.59, 0.6], [0.58, 0.66]]), "torso", 1.1),
    deco(k, q.path([[0.42, 0.66], [0.44, 0.62], [0.46, 0.67], [0.48, 0.62], [0.5, 0.68], [0.52, 0.62], [0.54, 0.67], [0.56, 0.62], [0.58, 0.66]]), "torso", 0.9),
    deco(k, scribble(93, 0.435, 0.565, 0.32, 0.58, 6), "torso", 0.35),
    // a rope belt, straw poking out of the sleeves
    deco("#8a5a32", q.path([[0.43, 0.47], [0.5, 0.485], [0.57, 0.47]]), "torso", 0.8),
    deco("#c4962c", q.path([[0.37, 0.47], [0.355, 0.495]]), "auto", 0.6),
    deco("#c4962c", q.path([[0.37, 0.47], [0.375, 0.5]]), "auto", 0.6),
    deco("#c4962c", q.path([[0.64, 0.46], [0.655, 0.49]]), "auto", 0.6),
    deco("#c4962c", q.path([[0.64, 0.46], [0.635, 0.492]]), "auto", 0.6),
  ];
  return [...read, ...D];
}

/** a rattling skeleton: skull, spine and ribs, knobbly bones */
function skeleton(): InkStroke[] {
  const k = "#3b3632";
  const p = pencil(101);
  const read: InkStroke[] = [
    { color: k, points: p.ellipse(0.5, 0.15, 0.06, 0.07) },
    { color: k, points: p.path([[0.5, 0.222], [0.5, 0.56]]) },
    { color: k, points: p.path([[0.5, 0.3], [0.41, 0.39], [0.38, 0.48]]) },
    { color: k, points: p.path([[0.5, 0.3], [0.6, 0.385], [0.635, 0.47]]) },
    { color: k, points: p.path([[0.5, 0.56], [0.455, 0.745], [0.445, 0.93]]) },
    { color: k, points: p.path([[0.5, 0.56], [0.555, 0.745], [0.57, 0.93]]) },
  ];
  const q = pencil(102);
  const D: InkStroke[] = [
    // skull: hollow eyes, a nose hole, a row of teeth
    deco(k, q.ellipse(0.478, 0.145, 0.014, 0.016), "head", 1),
    deco(k, q.ellipse(0.522, 0.145, 0.014, 0.016), "head", 1),
    deco(k, q.path([[0.495, 0.17], [0.5, 0.162], [0.505, 0.17]]), "head", 0.7),
    deco(k, q.path([[0.474, 0.19], [0.526, 0.19]]), "head", 0.7),
    ...[0.482, 0.494, 0.506, 0.518].map((x) => deco(k, q.path([[x, 0.183], [x, 0.197]]), "head", 0.5)),
    // ribcage: curved ribs on both sides of the spine, and a pelvis bowl
    ...[0.27, 0.31, 0.35, 0.39].map((y, i) => deco(k, q.arc(0.5, y, 0.055 - i * 0.004, 0.022, 0.2, Math.PI - 0.2, 10), "torso", 0.8)),
    deco(k, q.arc(0.5, 0.545, 0.05, 0.03, 0.1, Math.PI - 0.1, 10), "torso", 0.9),
    // knobbly joints: little double bumps at elbows, knees, hands and feet
    ...([[0.41, 0.39], [0.6, 0.385], [0.455, 0.745], [0.555, 0.745]] as [number, number][]).map(([x, y]) => deco(k, q.ellipse(x, y, 0.011, 0.011), "auto", 0.7)),
    ...([[0.38, 0.48], [0.635, 0.47]] as [number, number][]).map(([x, y]) => deco(k, q.path([[x - 0.012, y + 0.008], [x, y + 0.02], [x + 0.012, y + 0.008]]), "auto", 0.6)),
    deco(k, q.path([[0.43, 0.93], [0.465, 0.93]]), "auto", 0.7),
    deco(k, q.path([[0.56, 0.93], [0.6, 0.93]]), "auto", 0.7),
  ];
  return [...read, ...D];
}

const HULK_STANCE: Partial<Pose> = { armF: -0.05, elbowF: -1.75, armB: -1.2, elbowB: -1.9, thighF: 0.14, thighB: -0.14, lean: 0.06 };

export const ROSTER: RosterEntry[] = [
  { id: "kid", name: "Skinny kid", blurb: "quick on his feet, light hits", tier: 1, strokes: weigh(0.8, kid()) },
  { id: "dog", name: "Dog", blurb: "trots fast, bites", tier: 1, strokes: dog() },
  { id: "boxer", name: "Boxer", blurb: "fast fists, gloves up", tier: 2, strokes: boxer() },
  { id: "karate", name: "Karate guy", blurb: "strong straight punch and kick", tier: 2, strokes: karate() },
  { id: "ninja", name: "Ninja", blurb: "low stance, short blade", tier: 2, strokes: ninja() },
  { id: "swordsman", name: "Swordsman", blurb: "long reach with the sword", tier: 2, strokes: swordsman() },
  { id: "pehelwan", name: "Pehelwan", blurb: "sumo-wrestler bulk, a stomp that shakes the ground", tier: 3, strokes: pehelwan(), signature: "quake" },
  { id: "halloween", name: "Halloween", blurb: "pumpkin head, throws pumpkins", tier: 3, strokes: halloween(), signature: "pumpkin" },
  { id: "skeleton", name: "Skeleton", blurb: "falls to bits, snaps back next to you", tier: 3, strokes: skeleton(), signature: "bones" },
  { id: "bodybuilder", name: "Bodybuilder", blurb: "hulking, huge arms, a leap across the arena", tier: 3, strokes: bodybuilder(), size: 1.2, stance: HULK_STANCE, signature: "leap" },
];

export const rosterById = (id: string | null | undefined) => ROSTER.find((r) => r.id === id) ?? null;

/**
 * The computer picks an opponent that makes sense for the level and for your drawing: Easy brings a
 * light fighter, Hard a heavy one, Normal a fair middleweight. It is deterministic (your strokes pick
 * which one of the tier), so a rematch is the same opponent.
 */
export function pickRival(player: InkStroke[] | null, difficulty: Difficulty, round = 0): RosterEntry {
  const tier = difficulty === "easy" ? 1 : difficulty === "hard" ? 3 : 2;
  const pool = ROSTER.filter((r) => r.tier === tier);
  const ink = player ? player.reduce((a, s) => a + s.points.length, 0) : 0;
  return pool[(ink + (player?.length ?? 0) * 7 + round) % pool.length];
}
