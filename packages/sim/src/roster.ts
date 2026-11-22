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

export type RosterId = "bodybuilder" | "ninja" | "pehelwan" | "boxer" | "kid" | "karate" | "swordsman" | "dog" | "halloween" | "skeleton" | "phantom";
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
  // vivid green-graphite palette: deep muscular hulk green, dark contour shadows, highlight ridges & royal purple shorts
  const c = "#2d5222";
  const cDark = "#183212";
  const cLight = "#4c8238";
  const shorts = "#673a94";
  const shortsDark = "#452269";
  const white = "#eef4ea";
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
  const line = (seed: number, pts: [number, number][], where: "head" | "torso" | "auto", w: number, col = c) => deco(col, pencil(seed).path(pts, 0.002), where, w);
  const both = (seed: number, pts: [number, number][], where: "torso" | "auto", w: number, n = 2, col = c) => add(...passes(col, seed, pts, where, w, n), ...passes(col, seed + 500, mirror(pts), where, w, n));
  const H = 0.6; // hatching lead

  // ---- HEAD & FACE: square jaw with chin cleft, furious scowling brow, glowing furious eyes, gritted fangs, wild hair
  // chiseled jawline with cleft chin
  add(...passes(cDark, 401, [[0.442, 0.146], [0.446, 0.186], [0.466, 0.207], [0.485, 0.213], [0.5, 0.208], [0.515, 0.213], [0.534, 0.207], [0.554, 0.186], [0.558, 0.146]], "head", 1.5));
  add(line(402, [[0.5, 0.202], [0.5, 0.213]], "head", 0.9, cDark)); // chin cleft
  // heavy angled brow ridges sloping down in rage
  add(...passes(cDark, 403, [[0.444, 0.112], [0.472, 0.122], [0.498, 0.142]], "head", 2.2));
  add(...passes(cDark, 404, [[0.556, 0.112], [0.528, 0.122], [0.502, 0.142]], "head", 2.2));
  // furious white eyes with dark pupils
  add(line(405, [[0.463, 0.136], [0.488, 0.145], [0.466, 0.149], [0.463, 0.136]], "head", 1.1, white));
  add(line(406, [[0.537, 0.136], [0.512, 0.145], [0.534, 0.149], [0.537, 0.136]], "head", 1.1, white));
  add(line(407, [[0.473, 0.140], [0.477, 0.143]], "head", 1.5, cDark));
  add(line(408, [[0.527, 0.140], [0.523, 0.143]], "head", 1.5, cDark));
  // flared sneering nose with nostrils
  add(line(409, [[0.5, 0.142], [0.490, 0.160], [0.510, 0.160], [0.5, 0.142]], "head", 0.95, cDark));
  add(line(410, [[0.493, 0.158], [0.491, 0.161]], "head", 1.2, cDark), line(411, [[0.507, 0.158], [0.509, 0.161]], "head", 1.2, cDark));
  // roaring gritted mouth: dark mouth cavity, white teeth row, tooth separators
  add(deco(cDark, scribble(412, 0.462, 0.538, 0.170, 0.194, 4), "head", 0.85));
  add(line(413, [[0.464, 0.172], [0.536, 0.172], [0.536, 0.193], [0.464, 0.193], [0.464, 0.172]], "head", 1.2, white));
  add(line(414, [[0.464, 0.1825], [0.536, 0.1825]], "head", 0.85, cDark));
  for (const [k, x] of [0.476, 0.488, 0.500, 0.512, 0.524].entries()) add(line(415 + k, [[x, 0.173], [x, 0.192]], "head", 0.75, cDark));
  // wild, jagged barbarian hair with volume and highlight tufts
  add(...passes(cDark, 420, [[0.440, 0.106], [0.446, 0.068], [0.462, 0.092], [0.476, 0.056], [0.492, 0.088], [0.505, 0.052], [0.518, 0.086], [0.534, 0.058], [0.548, 0.092], [0.560, 0.068], [0.560, 0.108]], "head", 1.4));
  add(line(421, [[0.448, 0.094], [0.470, 0.076], [0.490, 0.092], [0.510, 0.074], [0.530, 0.090], [0.552, 0.080]], "head", 0.9, cLight));
  add(line(422, [[0.435, 0.14], [0.444, 0.165]], "head", 0.85, cDark), line(423, [[0.565, 0.14], [0.556, 0.165]], "head", 0.85, cDark)); // ear outlines

  // ---- TRAPS & NECK: mountainous trapezius muscles flanking the head, neck tendons
  both(430, [[0.462, 0.195], [0.456, 0.222], [0.448, 0.245]], "torso", 1.35, 2, cDark);
  both(431, [[0.448, 0.165], [0.430, 0.192], [0.400, 0.215], [0.368, 0.235], [0.342, 0.254], [0.328, 0.272]], "auto", 1.6, 2, cDark);
  both(432, [[0.442, 0.180], [0.415, 0.210], [0.380, 0.236]], "auto", 0.85, 1, cLight); // trap highlight ridge
  add(...strokes(c, hatch(433, [0.446, 0.18], [0.36, 0.25], 0.05, 0.9, -0.002, 0.016, 0.012), "auto", H), ...strokes(c, hatch(933, [0.554, 0.18], [0.64, 0.25], 0.05, 0.9, 0.002, -0.016, 0.012), "auto", H));

  // ---- SHOULDERS (DELTOIDS): massive 3-headed deltoid boulder caps
  add(...passes(cDark, 440, [[0.36, 0.25], [0.325, 0.268], [0.306, 0.298], [0.310, 0.338], [0.336, 0.364]], "auto", 1.55));
  add(...passes(cDark, 441, [[0.64, 0.25], [0.675, 0.268], [0.694, 0.298], [0.690, 0.338], [0.664, 0.364]], "auto", 1.55));
  // deltoid head separation cuts (anterior / lateral / posterior heads)
  add(line(442, [[0.345, 0.262], [0.335, 0.305], [0.348, 0.342]], "auto", 0.9, cDark), line(443, [[0.655, 0.262], [0.665, 0.305], [0.652, 0.342]], "auto", 0.9, cDark));
  add(line(444, [[0.332, 0.280], [0.322, 0.315]], "auto", 0.85, cLight), line(445, [[0.668, 0.280], [0.678, 0.315]], "auto", 0.85, cLight)); // highlight
  add(...strokes(c, hatch(446, sh, eB, 0.62, 0.92, 0.05, 0.075), "auto", H), ...strokes(c, hatch(447, sh, eF, 0.62, 0.92, -0.05, -0.075), "auto", H));

  // ---- CHEST & 8-PACK ABS: armor-plate slab pecs, deep sternum, chiseled abs, serratus cuts
  // pectoral slabs
  both(450, [[0.5, 0.250], [0.458, 0.242], [0.420, 0.252], [0.392, 0.278], [0.388, 0.315], [0.410, 0.346], [0.455, 0.358], [0.5, 0.354]], "torso", 1.55, 2, cDark);
  both(451, [[0.392, 0.335], [0.402, 0.385], [0.418, 0.440], [0.436, 0.495], [0.446, 0.540]], "torso", 1.45, 2, cDark);
  // deep sternum cleavage & pec lower shelf shadow
  add(line(452, [[0.5, 0.254], [0.5, 0.354]], "torso", 1.2, cDark));
  both(453, [[0.412, 0.344], [0.455, 0.356], [0.498, 0.353]], "torso", 1.2, 1, cDark);
  add(...strokes(c, hatch(454, [0.415, 0.338], [0.498, 0.351], 0.05, 0.95, 0.0, 0.016, 0.011), "torso", H), ...strokes(c, hatch(954, [0.585, 0.338], [0.502, 0.351], 0.05, 0.95, 0.0, -0.016, 0.011), "torso", H));
  // pectoral highlight ridges
  both(455, [[0.445, 0.260], [0.420, 0.285], [0.425, 0.320]], "torso", 0.85, 1, cLight);
  // 8-pack abdominal wall: linea alba and rectus abdominis cuts
  add(line(456, [[0.5, 0.362], [0.499, 0.440], [0.5, 0.528]], "torso", 1.2, cDark));
  both(457, [[0.466, 0.362], [0.460, 0.400], [0.462, 0.440], [0.466, 0.480], [0.474, 0.518]], "torso", 1.1, 1, cDark);
  for (const [k, y] of [0.395, 0.432, 0.468].entries()) {
    const hw = 0.036 - k * 0.002;
    add(line(460 + k, [[0.5 - hw, y - 0.004], [0.484, y + 0.003], [0.5, y - 0.001]], "torso", 1.0, cDark));
    add(line(470 + k, [[0.5, y - 0.001], [0.516, y + 0.003], [0.5 + hw, y - 0.004]], "torso", 1.0, cDark));
    // ab muscle highlight curves
    add(line(475 + k, [[0.5 - hw * 0.7, y - 0.018], [0.49, y - 0.012]], "torso", 0.75, cLight));
    add(line(480 + k, [[0.51, y - 0.012], [0.5 + hw * 0.7, y - 0.018]], "torso", 0.75, cLight));
  }
  // serratus anterior "finger" muscles along the ribs
  both(485, [[0.422, 0.400], [0.438, 0.412]], "torso", 0.9, 1, cDark);
  both(486, [[0.426, 0.435], [0.444, 0.448]], "torso", 0.9, 1, cDark);
  both(487, [[0.432, 0.470], [0.450, 0.482]], "torso", 0.9, 1, cDark);
  // vascular abdominal vein snaking down the flank
  add(line(488, [[0.455, 0.370], [0.448, 0.415], [0.452, 0.460], [0.446, 0.505]], "torso", 0.75, cLight));

  // ---- GIANT ARMS: peaked biceps, split triceps, veiny forearms, knuckled clenched fists
  const arm = (seed: number, e: [number, number], h: [number, number], up: 1 | -1, fist: [number, number], far = false) => {
    const np = far ? 1 : 2;
    // bicep peak contour & tricep bulge
    add(...passes(cDark, seed, muscle(seed, sh, e, up, 0.46, 1.05, 0.034, 0.07, 0.6), "auto", 1.5, np));
    add(...passes(cDark, seed + 1, muscle(seed + 1, sh, e, -up as 1 | -1, 0.55, 1.05, 0.03, 0.035, 0.45), "auto", 1.45, np));
    // bicep highlight peak ridge
    add(line(seed + 2, [onBone(sh, e, 0.55, up * 0.06), onBone(sh, e, 0.75, up * 0.085), onBone(sh, e, 0.95, up * 0.055)], "auto", 0.9, cLight));
    // pulsing bicep vein
    add(line(seed + 3, [onBone(sh, e, 0.52, up * 0.045), onBone(sh, e, 0.68, up * 0.055), onBone(sh, e, 0.82, up * 0.038), onBone(sh, e, 0.98, up * 0.048)], "auto", 0.8, cLight));
    add(...strokes(c, shade(seed + 4, sh, e, -up as 1 | -1, 0.55, 1.05, 0.03, 0.035, 0.45, 0.3, 0.85), "auto", H));
    // forearm contours & brachioradialis muscle
    const fs = (up === 1 ? -1 : 1) as 1 | -1;
    add(...passes(cDark, seed + 5, muscle(seed + 5, e, h, fs, -0.08, 0.84, 0.028, 0.05, 0.3), "auto", 1.45, np));
    add(...passes(cDark, seed + 6, muscle(seed + 6, e, h, -fs as 1 | -1, -0.04, 0.84, 0.022, 0.03, 0.3), "auto", 1.4, np));
    // branching forearm veins
    add(line(seed + 7, [onBone(e, h, 0.15, -fs * 0.012), onBone(e, h, 0.35, -fs * 0.020), onBone(e, h, 0.55, -fs * 0.010), onBone(e, h, 0.75, -fs * 0.018)], "auto", far ? 0.5 : 0.85, cLight));
    add(line(seed + 8, [onBone(e, h, 0.35, -fs * 0.020), onBone(e, h, 0.48, 0), onBone(e, h, 0.65, fs * 0.008)], "auto", far ? 0.4 : 0.75, cLight));
    add(...strokes(c, shade(seed + 9, e, h, fs, -0.08, 0.84, 0.028, 0.05, 0.3, 0.3, 0.85), "auto", H));
    // clenched fist: knuckled block, finger segments, folded thumb and wrist tendon
    const [fx, fy] = fist;
    const r = 0.062;
    add(...passes(cDark, seed + 10, [[fx - r * 0.85, fy + r * 0.8], [fx - r, fy - r * 0.05], [fx - r * 0.75, fy - r * 0.85], [fx, fy - r], [fx + r * 0.75, fy - r * 0.85], [fx + r, fy - r * 0.05], [fx + r * 0.85, fy + r * 0.75], [fx, fy + r * 0.95], [fx - r * 0.85, fy + r * 0.8]], "auto", 1.5));
    // knuckle line & finger separations
    add(line(seed + 11, [[fx - r * 0.82, fy - r * 0.3], [fx + r * 0.82, fy - r * 0.3]], "auto", 0.9, cDark));
    for (const k of [-0.42, 0, 0.42]) add(line(seed + 12 + k * 10, [[fx + r * k, fy - r * 0.92], [fx + r * k, fy - r * 0.32]], "auto", 0.75, cDark));
    // folded thumb across fingers
    add(line(seed + 15, [[fx - r * 0.75, fy + r * 0.1], [fx - r * 0.1, fy + r * 0.25], [fx - r * 0.05, fy + r * 0.6]], "auto", 0.9, cDark));
    add(line(seed + 16, [[fx - r * 0.65, fy + r * 0.15], [fx - r * 0.15, fy + r * 0.28]], "auto", 0.75, cLight)); // thumb highlight
    add(...strokes(c, hatch(seed + 17, [fx - r * 0.7, fy + r * 0.35], [fx + r * 0.7, fy + r * 0.35], 0, 1, 0, -r * 0.45, 0.007), "auto", H));
  };
  arm(500, eB, hB, 1, [0.322, 0.21], true);
  arm(540, eF, hF, -1, [0.698, 0.21]);

  // ---- SHREDDED TORN SHORTS: royal purple textured canvas, ragged frayed hem, tears & waistband
  add(...passes(shortsDark, 600, [[0.444, 0.528], [0.5, 0.534], [0.556, 0.528]], "torso", 1.6));
  add(...passes(shorts, 601, [[0.444, 0.538], [0.5, 0.544], [0.556, 0.538]], "torso", 1.4));
  const legShorts = (seed: number, k: [number, number], s: 1 | -1) => {
    // outer and inner leg seams of shorts
    add(...passes(shortsDark, seed, [onBone(hip, k, -0.04, s * 0.068), onBone(hip, k, 0.25, s * 0.080), onBone(hip, k, 0.5, s * 0.078)], "auto", 1.45));
    // jagged, frayed, torn hem with hanging threads
    add(line(seed + 1, [onBone(hip, k, 0.5, s * 0.078), onBone(hip, k, 0.62, s * 0.054), onBone(hip, k, 0.52, s * 0.032), onBone(hip, k, 0.65, s * 0.008), onBone(hip, k, 0.53, -s * 0.016), onBone(hip, k, 0.64, -s * 0.038), onBone(hip, k, 0.51, -s * 0.062)], "auto", 1.4, shortsDark));
    // hanging fray threads
    add(line(seed + 2, [onBone(hip, k, 0.62, s * 0.054), onBone(hip, k, 0.71, s * 0.056)], "auto", 0.7, shorts));
    add(line(seed + 3, [onBone(hip, k, 0.65, s * 0.008), onBone(hip, k, 0.73, s * 0.006)], "auto", 0.7, shorts));
    add(line(seed + 4, [onBone(hip, k, 0.64, -s * 0.038), onBone(hip, k, 0.72, -s * 0.035)], "auto", 0.7, shorts));
    // rich fabric hatch shading
    add(...strokes(shorts, hatch(seed + 5, hip, k, 0.1, 0.44, s * 0.012, s * 0.068, 0.012, 0.8), "auto", H));
    // fabric tear slash with exposed green muscle underneath
    add(line(seed + 6, [onBone(hip, k, 0.28, s * 0.05), onBone(hip, k, 0.36, s * 0.065)], "auto", 1.2, shortsDark));
    add(line(seed + 7, [onBone(hip, k, 0.30, s * 0.055), onBone(hip, k, 0.34, s * 0.060)], "auto", 0.9, cLight));
  };
  legShorts(610, kB, -1);
  legShorts(620, kF, 1);
  add(line(630, [[0.468, 0.60], [0.5, 0.570], [0.532, 0.60]], "torso", 1.2, shortsDark));

  // ---- MASSIVE LEGS, QUADS & PLANTED BARE FEET: teardrop quads, calf diamonds, vascular calves, wide toes
  const leg = (seed: number, k: [number, number], f: [number, number], out: 1 | -1, toe: number) => {
    // outer quad sweep & inner teardrop (vastus medialis)
    add(...passes(cDark, seed, muscle(seed, hip, k, out, 0.48, 1.04, 0.038, 0.038, 0.25), "auto", 1.5));
    add(...passes(cDark, seed + 1, muscle(seed + 1, hip, k, -out as 1 | -1, 0.50, 1.04, 0.032, 0.030, 0.3), "auto", 1.45));
    // quad teardrop highlight ridge
    add(line(seed + 2, [onBone(hip, k, 0.82, -out * 0.015), onBone(hip, k, 0.94, -out * 0.035), onBone(hip, k, 1.0, 0)], "auto", 1.0, cLight));
    // massive bulging diamond calf (gastrocnemius)
    add(...passes(cDark, seed + 3, muscle(seed + 3, k, f, out, 0.04, 0.90, 0.024, 0.038, 0.3), "auto", 1.5));
    add(...passes(cDark, seed + 4, muscle(seed + 4, k, f, -out as 1 | -1, 0.04, 0.90, 0.022, 0.024, 0.35), "auto", 1.45));
    // vascular calf vein
    add(line(seed + 5, [onBone(k, f, 0.15, out * 0.015), onBone(k, f, 0.45, out * 0.028), onBone(k, f, 0.75, out * 0.012)], "auto", 0.85, cLight));
    // knee cap (patella)
    add(line(seed + 6, [onBone(hip, k, 0.94, -0.018), onBone(hip, k, 1.01, 0), onBone(hip, k, 0.94, 0.018)], "auto", 1.1, cDark));
    add(...strokes(c, shade(seed + 7, hip, k, out, 0.5, 1.04, 0.038, 0.038, 0.25, 0.45, 0.85, 0.42, 0.92, 0.014, 0.5), "auto", H));
    add(...strokes(c, shade(seed + 8, k, f, out, 0.04, 0.90, 0.024, 0.038, 0.3, 0.4, 0.85, 0.08, 0.8, 0.014, 0.5), "auto", H));
    // heavy planted bare foot with distinct toes gripped on ground
    const [x, y] = f;
    add(...passes(cDark, seed + 9, [[x - toe * 0.022, y - 0.036], [x - toe * 0.028, y + 0.004], [x + toe * 0.068, y + 0.007], [x + toe * 0.080, y - 0.012], [x + toe * 0.038, y - 0.026], [x + toe * 0.018, y - 0.036]], "auto", 1.5));
    // individual toe cuts
    add(line(seed + 10, [[x + toe * 0.055, y - 0.014], [x + toe * 0.055, y + 0.006]], "auto", 0.85, cDark));
    add(line(seed + 11, [[x + toe * 0.040, y - 0.016], [x + toe * 0.040, y + 0.005]], "auto", 0.8, cDark));
    add(line(seed + 12, [[x + toe * 0.025, y - 0.018], [x + toe * 0.025, y + 0.004]], "auto", 0.75, cDark));
  };
  leg(700, kB, fB, -1, -1);
  leg(720, kF, fF, 1, 1);

  return [...read, ...D];
}
function ninja(): InkStroke[] {
  const c = "#3a3470";
  const r = "#c23b32";
  const gold = "#c4962c";
  const w = "#e8e4dc";
  const p = pencil(31);
  const q = pencil(32);
  const read: InkStroke[] = [
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
  ];
  const D: InkStroke[] = [
    // costume: the hood over the top of the head, the mask over the mouth, a red sash
    deco(c, scribble(321, 0.452, 0.548, 0.095, 0.13, 3), "head", 1.4),
    deco(c, scribble(322, 0.455, 0.545, 0.17, 0.205, 4), "head", 1.4),
    deco(r, pencil(323).path([[0.455, 0.45], [0.545, 0.45]]), "torso", 1.8),
    deco(r, pencil(324).path([[0.545, 0.45], [0.58, 0.5], [0.6, 0.53]]), "torso", 1.2),
    // cowl hood wrap around cheeks and chin
    deco(c, q.path([[0.44, 0.12], [0.435, 0.18], [0.47, 0.215], [0.5, 0.22]]), "head", 1.1),
    deco(c, q.path([[0.56, 0.12], [0.565, 0.18], [0.53, 0.215], [0.5, 0.22]]), "head", 1.1),
    // steely assassin eyes peeking through the slit
    deco(w, q.path([[0.48, 0.148], [0.505, 0.148]]), "head", 0.7),
    deco("#2a241c", q.ellipse(0.495, 0.148, 0.004, 0.005), "head", 1.0),
    deco(w, q.path([[0.525, 0.148], [0.548, 0.148]]), "head", 0.7),
    deco("#2a241c", q.ellipse(0.538, 0.148, 0.004, 0.005), "head", 1.0),
    // dynamic flowing red headband ribbons
    deco(r, q.path([[0.37, 0.12], [0.32, 0.10], [0.27, 0.125]]), "head", 1.2),
    deco(r, q.path([[0.37, 0.12], [0.33, 0.15], [0.28, 0.175]]), "head", 1.1),
    // cross-body tactical strap with golden buckle
    deco("#2a241c", q.path([[0.44, 0.26], [0.55, 0.44]]), "torso", 1.3),
    deco(gold, q.ellipse(0.495, 0.35, 0.007, 0.006), "torso", 1.2),
    // vest contours & hip weapon pouch
    deco(c, q.path([[0.44, 0.30], [0.435, 0.45], [0.45, 0.54]]), "torso", 1.0),
    deco(c, q.path([[0.56, 0.30], [0.565, 0.45], [0.55, 0.54]]), "torso", 1.0),
    deco("#2a241c", q.ellipse(0.44, 0.47, 0.015, 0.012), "torso", 1.0),
    // blade edge highlight & golden tsuba handguard
    deco(w, q.path([[0.675, 0.335], [0.76, 0.235]]), "auto", 0.9),
    deco(gold, q.path([[0.66, 0.355], [0.685, 0.325]]), "auto", 1.4),
    deco("#2a241c", q.path([[0.655, 0.36], [0.635, 0.38]]), "auto", 1.4),
    // arm wraps (tekko) on forearms
    deco(c, q.path([[0.38, 0.36], [0.35, 0.34]]), "auto", 0.8),
    deco(c, q.path([[0.37, 0.34], [0.34, 0.36]]), "auto", 0.8),
    deco(c, q.path([[0.62, 0.36], [0.65, 0.35]]), "auto", 0.8),
    deco(c, q.path([[0.61, 0.35], [0.64, 0.37]]), "auto", 0.8),
    // leg wraps (kyahan) and split-toe tabi boots
    deco(c, q.path([[0.39, 0.77], [0.37, 0.83]]), "auto", 0.8),
    deco(c, q.path([[0.38, 0.83], [0.40, 0.89]]), "auto", 0.8),
    deco(c, q.path([[0.61, 0.77], [0.63, 0.83]]), "auto", 0.8),
    deco(c, q.path([[0.64, 0.83], [0.62, 0.89]]), "auto", 0.8),
    deco(c, q.path([[0.33, 0.93], [0.38, 0.93]]), "auto", 1.3),
    deco(c, q.path([[0.61, 0.93], [0.67, 0.93]]), "auto", 1.3),
  ];
  return [...read, ...D];
}

function pehelwan(): InkStroke[] {
  const c = "#7a4a2a";
  const k = "#c23b32";
  const g = "#c4962c";
  const p = pencil(41);
  const q = pencil(42);
  const r = pencil(43);
  const read: InkStroke[] = [
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
  ];
  const D: InkStroke[] = [
    // costume: the whole round belly, a navel, heavy thighs and shoulders
    deco(c, pencil(331).ellipse(0.5, 0.41, 0.115, 0.13, -Math.PI / 2, 1.02, 30), "torso", 1.6),
    deco(c, pencil(332).ellipse(0.5, 0.44, 0.008, 0.008, 0, 1, 8), "torso", 1.2),
    deco(c, bulge(333, [0.5, 0.57], [0.39, 0.73], 0.04, -1), "auto", 1.5),
    deco(c, bulge(334, [0.5, 0.57], [0.61, 0.73], 0.04, 1), "auto", 1.5),
    deco(c, bulge(335, [0.5, 0.29], [0.37, 0.35], 0.03, 1), "auto", 1.4),
    deco(c, bulge(336, [0.5, 0.29], [0.63, 0.35], 0.03, -1), "auto", 1.4),
    deco(k, scribble(337, 0.43, 0.57, 0.545, 0.6, 4), "torso", 1.4),
    // magnificent curled moustache (mouchh) tips
    deco(c, r.path([[0.47, 0.18], [0.44, 0.175], [0.415, 0.155]]), "head", 1.4),
    deco(c, r.path([[0.535, 0.18], [0.565, 0.175], [0.59, 0.155]]), "head", 1.4),
    // vermilion tilak & gold bindi on forehead
    deco(k, r.path([[0.50, 0.105], [0.50, 0.125]]), "head", 1.8),
    deco(g, r.ellipse(0.50, 0.128, 0.004, 0.004), "head", 1.2),
    // fierce eyes and wrestler shikha top-knot
    deco(c, r.path([[0.46, 0.135], [0.49, 0.14]]), "head", 1.2),
    deco(c, r.path([[0.54, 0.135], [0.51, 0.14]]), "head", 1.2),
    deco(c, r.ellipse(0.48, 0.146, 0.004, 0.006), "head", 1.0),
    deco(c, r.ellipse(0.52, 0.146, 0.004, 0.006), "head", 1.0),
    deco(c, r.path([[0.50, 0.08], [0.49, 0.05], [0.465, 0.055]]), "head", 1.3),
    // massive neck and traps
    deco(c, r.path([[0.44, 0.22], [0.39, 0.28]]), "torso", 1.2),
    deco(c, r.path([[0.56, 0.22], [0.61, 0.28]]), "torso", 1.2),
    // powerful wrestler pecs
    deco(c, r.path([[0.42, 0.28], [0.46, 0.32], [0.50, 0.31]]), "torso", 1.2),
    deco(c, r.path([[0.58, 0.28], [0.54, 0.32], [0.50, 0.31]]), "torso", 1.2),
    // victory sash / sacred cord diagonal across chest
    deco(g, r.path([[0.42, 0.26], [0.47, 0.36], [0.54, 0.48], [0.58, 0.54]]), "torso", 1.0),
    // red langot knot & loincloth flap
    deco(k, r.path([[0.42, 0.53], [0.58, 0.53]]), "torso", 1.8),
    deco(k, r.ellipse(0.50, 0.545, 0.012, 0.01), "torso", 1.6),
    deco(k, r.path([[0.50, 0.55], [0.485, 0.62], [0.515, 0.62], [0.50, 0.55]]), "torso", 1.2),
    // heavy calves muscle bulges
    deco(c, bulge(338, [0.39, 0.73], [0.37, 0.93], 0.025, -1), "auto", 1.3),
    deco(c, bulge(339, [0.61, 0.73], [0.63, 0.93], 0.025, 1), "auto", 1.3),
    // red wristbands on hands
    deco(k, r.path([[0.30, 0.41], [0.32, 0.45]]), "auto", 1.8),
    deco(k, r.path([[0.68, 0.41], [0.70, 0.45]]), "auto", 1.8),
    // planted bare feet
    deco(c, r.path([[0.33, 0.93], [0.40, 0.93]]), "auto", 1.5),
    deco(c, r.path([[0.60, 0.93], [0.67, 0.93]]), "auto", 1.5),
  ];
  return [...read, ...D];
}

function boxer(): InkStroke[] {
  const c = "#6b2f6b";
  const g = "#c23b32";
  const w = "#e8e4dc";
  const gold = "#c4962c";
  const p = pencil(51);
  const q = pencil(52);
  const read: InkStroke[] = [
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
  ];
  const D: InkStroke[] = [
    // costume: red gloves filled in, the trunks filled in, a waistband
    deco(g, scribble(341, 0.645, 0.685, 0.257, 0.293, 4), "auto", 1.5),
    deco(g, scribble(342, 0.41, 0.45, 0.242, 0.278, 4), "auto", 1.5),
    deco(g, scribble(343, 0.44, 0.56, 0.535, 0.6, 5), "torso", 1.4),
    // headgear / sweatband, fierce brow & grimace
    deco(g, q.path([[0.445, 0.115], [0.555, 0.115]]), "head", 1.4),
    deco(c, q.path([[0.465, 0.13], [0.49, 0.138]]), "head", 0.9),
    deco(c, q.path([[0.535, 0.13], [0.51, 0.138]]), "head", 0.9),
    deco(c, q.ellipse(0.485, 0.145, 0.005, 0.007), "head", 1.1),
    deco(c, q.ellipse(0.515, 0.145, 0.005, 0.007), "head", 1.1),
    deco(c, q.path([[0.498, 0.138], [0.495, 0.155], [0.505, 0.157]]), "head", 0.65),
    deco(c, q.path([[0.475, 0.178], [0.525, 0.178]]), "head", 0.9),
    // muscular neck and traps
    deco(c, q.path([[0.46, 0.21], [0.44, 0.26]]), "torso", 0.9),
    deco(c, q.path([[0.54, 0.21], [0.56, 0.26]]), "torso", 0.9),
    // chiseled pecs and 6-pack
    deco(c, q.path([[0.43, 0.29], [0.47, 0.33], [0.5, 0.32]]), "torso", 1.0),
    deco(c, q.path([[0.57, 0.29], [0.53, 0.33], [0.5, 0.32]]), "torso", 1.0),
    deco(c, q.path([[0.5, 0.32], [0.5, 0.48]]), "torso", 0.65),
    deco(c, q.path([[0.47, 0.37], [0.53, 0.37]]), "torso", 0.75),
    deco(c, q.path([[0.465, 0.42], [0.535, 0.42]]), "torso", 0.75),
    deco(c, q.path([[0.47, 0.47], [0.53, 0.47]]), "torso", 0.75),
    deco(c, q.path([[0.425, 0.33], [0.44, 0.43], [0.45, 0.52]]), "torso", 0.9),
    deco(c, q.path([[0.575, 0.33], [0.56, 0.43], [0.55, 0.52]]), "torso", 0.9),
    // white taped wrist cuffs on gloves
    deco(w, q.path([[0.41, 0.285], [0.45, 0.285]]), "auto", 1.8),
    deco(w, q.path([[0.645, 0.305], [0.685, 0.305]]), "auto", 1.8),
    deco(w, q.arc(0.43, 0.255, 0.016, 0.014, -2.5, -0.8, 6), "auto", 0.8),
    deco(w, q.arc(0.665, 0.27, 0.016, 0.014, -2.5, -0.8, 6), "auto", 0.8),
    // gold waistband & white side stripes on trunks
    deco(gold, q.path([[0.435, 0.53], [0.565, 0.53]]), "torso", 1.8),
    deco(w, q.path([[0.435, 0.55], [0.425, 0.63]]), "auto", 1.1),
    deco(w, q.path([[0.565, 0.55], [0.585, 0.63]]), "auto", 1.1),
    // high-top boxing boots with laces and soles
    deco(c, q.path([[0.40, 0.83], [0.38, 0.93]]), "auto", 1.1),
    deco(c, q.path([[0.61, 0.83], [0.63, 0.93]]), "auto", 1.1),
    deco(g, q.path([[0.395, 0.85], [0.415, 0.86]]), "auto", 0.7),
    deco(g, q.path([[0.39, 0.88], [0.41, 0.89]]), "auto", 0.7),
    deco(g, q.path([[0.605, 0.85], [0.625, 0.86]]), "auto", 0.7),
    deco(g, q.path([[0.61, 0.88], [0.63, 0.89]]), "auto", 0.7),
    deco(c, q.path([[0.36, 0.93], [0.42, 0.93]]), "auto", 1.3),
    deco(c, q.path([[0.60, 0.93], [0.66, 0.93]]), "auto", 1.3),
  ];
  return [...read, ...D];
}

function kid(): InkStroke[] {
  const c = "#2f7d4a";
  const o = "#e07a2f";
  const b = "#1d4f89";
  const r = "#c23b32";
  const p = pencil(61);
  const q = pencil(62);
  const read: InkStroke[] = [
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
  const D: InkStroke[] = [
    // cap dome seam, peak underside & top button
    deco(c, q.arc(0.5, 0.095, 0.05, 0.03, 0.2, Math.PI - 0.2, 8), "head", 0.7),
    deco(o, q.ellipse(0.5, 0.073, 0.007, 0.005), "head", 1.2),
    deco(o, q.path([[0.54, 0.112], [0.62, 0.116], [0.615, 0.125], [0.535, 0.12]]), "head", 0.8),
    // messy boyish hair peeking out
    deco(c, q.path([[0.435, 0.125], [0.42, 0.145], [0.438, 0.14]]), "head", 0.8),
    deco(c, q.path([[0.438, 0.14], [0.425, 0.165], [0.442, 0.155]]), "head", 0.7),
    deco(c, q.path([[0.562, 0.12], [0.575, 0.138], [0.565, 0.14]]), "head", 0.75),
    // expressive cartoon face: big curious eye, brow, freckles, cheek dimple
    deco(c, q.ellipse(0.535, 0.145, 0.008, 0.012), "head", 1.0),
    deco(c, q.path([[0.52, 0.13], [0.548, 0.133]]), "head", 0.85),
    deco(c, q.path([[0.485, 0.142], [0.495, 0.145]]), "head", 0.6),
    deco(c, q.path([[0.542, 0.17], [0.548, 0.163]]), "head", 0.7),
    deco(o, q.path([[0.528, 0.16], [0.538, 0.163]]), "head", 0.65),
    // t-shirt: collar, sides, sleeves, hem and stripes
    deco(c, q.arc(0.5, 0.24, 0.026, 0.014, 0.1, Math.PI - 0.1, 8), "torso", 0.9),
    deco(c, q.path([[0.46, 0.31], [0.455, 0.42], [0.46, 0.49]]), "torso", 0.95),
    deco(c, q.path([[0.54, 0.31], [0.545, 0.42], [0.54, 0.49]]), "torso", 0.95),
    deco(c, q.path([[0.46, 0.49], [0.5, 0.495], [0.54, 0.49]]), "torso", 0.85),
    deco(o, q.path([[0.458, 0.35], [0.542, 0.35]]), "torso", 0.8),
    deco(o, q.path([[0.456, 0.40], [0.544, 0.40]]), "torso", 0.8),
    deco(o, q.path([[0.458, 0.45], [0.542, 0.45]]), "torso", 0.8),
    deco(c, q.path([[0.44, 0.36], [0.41, 0.39]]), "auto", 0.85),
    deco(c, q.path([[0.57, 0.36], [0.60, 0.39]]), "auto", 0.85),
    // denim shorts with pocket
    deco(b, q.path([[0.458, 0.49], [0.5, 0.495], [0.542, 0.49]]), "torso", 1.2),
    deco(b, q.path([[0.458, 0.49], [0.435, 0.62], [0.485, 0.63], [0.495, 0.57]]), "auto", 1.0),
    deco(b, q.path([[0.505, 0.57], [0.515, 0.63], [0.565, 0.62], [0.542, 0.49]]), "auto", 1.0),
    deco("#c4962c", q.path([[0.525, 0.51], [0.54, 0.54]]), "auto", 0.65),
    // socks & sneakers
    deco(r, q.path([[0.435, 0.86], [0.455, 0.86]]), "auto", 0.8),
    deco(r, q.path([[0.555, 0.86], [0.575, 0.86]]), "auto", 0.8),
    deco(c, q.path([[0.41, 0.93], [0.465, 0.93]]), "auto", 1.3),
    deco(c, q.path([[0.43, 0.88], [0.405, 0.915], [0.41, 0.93]]), "auto", 0.85),
    deco(o, q.path([[0.428, 0.89], [0.442, 0.89]]), "auto", 0.65),
    deco(c, q.path([[0.54, 0.93], [0.605, 0.93]]), "auto", 1.3),
    deco(c, q.path([[0.56, 0.88], [0.61, 0.915], [0.605, 0.93]]), "auto", 0.85),
    deco(o, q.path([[0.568, 0.89], [0.582, 0.89]]), "auto", 0.65),
  ];
  return [...read, ...D];
}

function karate(): InkStroke[] {
  const c = "#1f6f78";
  const h = "#c4962c";
  const b = "#2a241c";
  const p = pencil(71);
  const q = pencil(72);
  const k = pencil(73);
  const read: InkStroke[] = [
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
    { color: h, points: p.path([[0.44, 0.115], [0.56, 0.115]]) },
  ];
  const D: InkStroke[] = [
    // costume: the gi jacket's sides and sleeves, a thick black belt
    deco(c, pencil(351).path([[0.43, 0.27], [0.43, 0.52]]), "torso", 1.1),
    deco(c, pencil(352).path([[0.57, 0.27], [0.57, 0.52]]), "torso", 1.1),
    deco(c, bulge(353, [0.5, 0.29], [0.42, 0.38], 0.022, 1), "auto", 1.1),
    deco(c, bulge(354, [0.5, 0.29], [0.62, 0.32], 0.022, -1), "auto", 1.1),
    deco(b, pencil(355).path([[0.43, 0.5], [0.57, 0.5]]), "torso", 2.4),
    // headband ribbon tails fluttering in wind
    deco(h, k.path([[0.44, 0.115], [0.38, 0.10], [0.33, 0.12]]), "head", 1.2),
    deco(h, k.path([[0.44, 0.115], [0.37, 0.135], [0.32, 0.16]]), "head", 1.1),
    // spiky warrior hair
    deco(c, k.path([[0.46, 0.09], [0.48, 0.065], [0.50, 0.088], [0.52, 0.063], [0.54, 0.088]]), "head", 0.95),
    // sharp martial artist eye, brow & resolute mouth
    deco(c, k.path([[0.47, 0.135], [0.495, 0.14]]), "head", 0.9),
    deco(c, k.path([[0.535, 0.135], [0.51, 0.14]]), "head", 0.9),
    deco(c, k.ellipse(0.522, 0.146, 0.005, 0.007), "head", 1.1),
    deco(c, k.path([[0.485, 0.178], [0.525, 0.175]]), "head", 0.85),
    // gi collar crossover
    deco(c, k.path([[0.45, 0.24], [0.48, 0.36], [0.53, 0.48]]), "torso", 1.0),
    deco(c, k.path([[0.55, 0.24], [0.52, 0.36], [0.47, 0.48]]), "torso", 1.0),
    // flared gi skirt below belt
    deco(c, k.path([[0.42, 0.51], [0.39, 0.61], [0.46, 0.62]]), "torso", 1.05),
    deco(c, k.path([[0.58, 0.51], [0.61, 0.61], [0.54, 0.62]]), "torso", 1.05),
    // flared sleeve cuffs
    deco(c, k.path([[0.69, 0.26], [0.71, 0.34]]), "auto", 1.1),
    deco(c, k.path([[0.43, 0.42], [0.47, 0.45]]), "auto", 1.1),
    // dangling black belt ends with gold rank stripes
    deco(b, k.path([[0.485, 0.52], [0.465, 0.60], [0.455, 0.67]]), "torso", 1.8),
    deco(b, k.path([[0.515, 0.52], [0.535, 0.61], [0.545, 0.68]]), "torso", 1.8),
    deco(h, k.path([[0.452, 0.65], [0.458, 0.65]]), "torso", 1.2),
    deco(h, k.path([[0.542, 0.66], [0.548, 0.66]]), "torso", 1.2),
    // wide pants folds, cuffs and planted bare feet
    deco(c, k.path([[0.38, 0.72], [0.35, 0.82], [0.32, 0.91]]), "auto", 0.95),
    deco(c, k.path([[0.64, 0.70], [0.66, 0.81], [0.67, 0.91]]), "auto", 0.95),
    deco(c, k.path([[0.31, 0.90], [0.35, 0.91]]), "auto", 1.1),
    deco(c, k.path([[0.65, 0.90], [0.70, 0.91]]), "auto", 1.1),
    deco(c, k.path([[0.29, 0.93], [0.35, 0.93]]), "auto", 1.3),
    deco(c, k.path([[0.65, 0.93], [0.72, 0.93]]), "auto", 1.3),
  ];
  return [...read, ...D];
}

function swordsman(): InkStroke[] {
  const c = "#1d4f89";
  const s = "#2a241c";
  const r = "#c23b32";
  const g = "#c4962c";
  const p = pencil(81);
  const q = pencil(82);
  const read: InkStroke[] = [
    { color: c, points: p.ellipse(0.5, 0.15, 0.06, 0.068) },
    { color: c, points: p.path([[0.5, 0.22], [0.5, 0.55]]) },
    { color: c, points: p.path([[0.5, 0.29], [0.4, 0.37], [0.36, 0.45]]) },
    { color: c, points: p.path([[0.5, 0.29], [0.6, 0.36], [0.66, 0.4]]) },
    { color: c, points: p.path([[0.5, 0.55], [0.42, 0.73], [0.38, 0.93]]) },
    { color: c, points: p.path([[0.5, 0.55], [0.6, 0.73], [0.63, 0.93]]) },
    // the sword held out front, with a crossguard; a plume on the helmet
    { color: s, points: p.path([[0.66, 0.4], [0.86, 0.2]]) },
    { color: s, points: p.path([[0.65, 0.36], [0.7, 0.42]]) },
    { color: r, points: p.path([[0.5, 0.082], [0.47, 0.04], [0.43, 0.05]]) },
  ];
  const D: InkStroke[] = [
    // feathered crimson plume strands
    deco(r, q.path([[0.50, 0.08], [0.46, 0.035], [0.40, 0.045]]), "head", 1.3),
    deco(r, q.path([[0.49, 0.07], [0.44, 0.025], [0.38, 0.04]]), "head", 1.2),
    deco(r, q.path([[0.51, 0.08], [0.48, 0.05], [0.42, 0.065]]), "head", 1.1),
    // helmet crest & T-visor slit
    deco(c, q.path([[0.44, 0.12], [0.56, 0.12]]), "head", 1.3),
    deco(s, q.path([[0.46, 0.145], [0.55, 0.145]]), "head", 1.5),
    deco(s, q.path([[0.50, 0.145], [0.50, 0.175]]), "head", 1.4),
    deco(c, q.path([[0.45, 0.18], [0.50, 0.21], [0.55, 0.18]]), "head", 1.0),
    // pauldrons (shoulder armor)
    deco(c, q.arc(0.40, 0.30, 0.035, 0.025, 0.8, 3.2, 8), "auto", 1.3),
    deco(c, q.arc(0.60, 0.30, 0.035, 0.025, -0.2, 2.2, 8), "auto", 1.3),
    // plate cuirass & golden heraldic crest
    deco(c, q.path([[0.43, 0.28], [0.44, 0.44], [0.46, 0.54]]), "torso", 1.2),
    deco(c, q.path([[0.57, 0.28], [0.56, 0.44], [0.54, 0.54]]), "torso", 1.2),
    deco(c, q.path([[0.50, 0.25], [0.50, 0.52]]), "torso", 0.8),
    deco(g, q.path([[0.48, 0.32], [0.52, 0.32], [0.52, 0.36], [0.50, 0.39], [0.48, 0.36], [0.48, 0.32]]), "torso", 1.0),
    deco(s, q.path([[0.44, 0.53], [0.56, 0.53]]), "torso", 1.4),
    // billowing crimson knight cape
    deco(r, q.path([[0.42, 0.30], [0.34, 0.39], [0.30, 0.54], [0.32, 0.68]]), "torso", 1.2),
    deco(r, q.path([[0.32, 0.68], [0.35, 0.63], [0.38, 0.67], [0.41, 0.62], [0.44, 0.65]]), "torso", 0.9),
    deco(r, q.path([[0.34, 0.39], [0.33, 0.58]]), "torso", 0.7),
    // broadsword blade fuller & contour
    deco(c, q.path([[0.67, 0.39], [0.83, 0.23]]), "auto", 0.8),
    deco(s, q.path([[0.66, 0.41], [0.855, 0.215], [0.86, 0.2], [0.845, 0.185], [0.65, 0.385]]), "auto", 0.85),
    // golden crossguard quillons & pommel
    deco(g, q.ellipse(0.65, 0.36, 0.008, 0.008), "auto", 1.2),
    deco(g, q.ellipse(0.70, 0.42, 0.008, 0.008), "auto", 1.2),
    deco(g, q.ellipse(0.635, 0.425, 0.01, 0.01), "auto", 1.4),
    // armored greaves & pointed sabaton boots
    deco(c, q.ellipse(0.42, 0.73, 0.012, 0.012), "auto", 1.0),
    deco(c, q.ellipse(0.60, 0.73, 0.012, 0.012), "auto", 1.0),
    deco(c, q.path([[0.35, 0.93], [0.42, 0.93]]), "auto", 1.4),
    deco(c, q.path([[0.59, 0.93], [0.67, 0.93]]), "auto", 1.4),
  ];
  return [...read, ...D];
}

function dog(): InkStroke[] {
  const c = "#7a4a2a";
  const d = "#4a2c16";
  const r = "#c23b32";
  const g = "#c4962c";
  const k = "#d45d8c";
  const p = pencil(91);
  const q = pencil(92);
  const read: InkStroke[] = [
    { color: c, points: p.ellipse(0.74, 0.36, 0.07, 0.065) },
    { color: c, points: p.path([[0.28, 0.5], [0.68, 0.48]]) },
    { color: c, points: p.path([[0.3, 0.5], [0.26, 0.7], [0.27, 0.9]]) },
    { color: c, points: p.path([[0.36, 0.5], [0.38, 0.7], [0.36, 0.9]]) },
    { color: c, points: p.path([[0.62, 0.49], [0.6, 0.7], [0.62, 0.9]]) },
    { color: c, points: p.path([[0.67, 0.49], [0.7, 0.7], [0.69, 0.9]]) },
    { color: c, points: p.path([[0.28, 0.5], [0.2, 0.42], [0.16, 0.34]]) },
    { color: c, points: p.path([[0.72, 0.3], [0.7, 0.24], [0.76, 0.29]]) },
  ];
  const D: InkStroke[] = [
    // snout, nose and happy panting mouth with pink tongue
    deco(c, q.path([[0.78, 0.34], [0.835, 0.37], [0.81, 0.40], [0.76, 0.41]]), "head", 0.95),
    deco("#2a241c", q.ellipse(0.83, 0.368, 0.009, 0.007), "head", 1.3),
    deco("#2a241c", q.path([[0.805, 0.395], [0.76, 0.41]]), "head", 0.8),
    deco(k, q.path([[0.79, 0.405], [0.805, 0.425], [0.785, 0.43], [0.775, 0.41]]), "head", 1.2),
    // friendly eye & playful brow
    deco("#2a241c", q.ellipse(0.75, 0.33, 0.008, 0.01), "head", 1.1),
    deco("#2a241c", q.path([[0.738, 0.318], [0.758, 0.32]]), "head", 0.7),
    // floppy hound ear with shaded fold
    deco(c, q.path([[0.71, 0.31], [0.66, 0.34], [0.65, 0.39], [0.69, 0.38]]), "head", 1.0),
    deco(d, q.path([[0.67, 0.345], [0.66, 0.38]]), "head", 0.65),
    // red collar & shiny gold medal
    deco(r, q.path([[0.69, 0.42], [0.67, 0.46]]), "head", 2.2),
    deco(g, q.ellipse(0.685, 0.468, 0.009, 0.009), "head", 1.4),
    // scruffy chest fur and back/belly contour
    deco(c, q.path([[0.69, 0.45], [0.725, 0.49], [0.695, 0.52], [0.72, 0.55], [0.68, 0.56]]), "auto", 0.85),
    deco(c, q.path([[0.32, 0.47], [0.48, 0.46], [0.64, 0.46]]), "auto", 0.9),
    deco(c, q.path([[0.38, 0.54], [0.50, 0.53], [0.61, 0.52]]), "auto", 0.75),
    // spot patch on back
    deco(d, q.ellipse(0.48, 0.48, 0.038, 0.022), "auto", 0.8),
    deco(d, scribble(95, 0.45, 0.51, 0.47, 0.49, 2), "auto", 0.45),
    // bushy wagging tail tufts
    deco(c, q.path([[0.25, 0.44], [0.22, 0.40]]), "auto", 0.75),
    deco(c, q.path([[0.21, 0.38], [0.17, 0.34], [0.15, 0.31]]), "auto", 0.85),
    deco(c, q.path([[0.17, 0.35], [0.14, 0.36]]), "auto", 0.75),
    // paws & toes on ground
    deco(c, q.path([[0.59, 0.93], [0.63, 0.93]]), "auto", 1.1),
    deco(c, q.path([[0.67, 0.93], [0.71, 0.93]]), "auto", 1.1),
    deco(c, q.path([[0.25, 0.93], [0.29, 0.93]]), "auto", 1.1),
    deco(c, q.path([[0.34, 0.93], [0.38, 0.93]]), "auto", 1.1),
  ];
  return [...read, ...D];
}

/** the Bodybuilder stands like a hulk: arms hanging wide, elbows loose, feet planted wide */
/** a pumpkin-headed scarecrow: a carved jack-o'-lantern on a ragged black cloak, scribbled like the Hulk */
function halloween(): InkStroke[] {
  const o = "#e07a2f";
  const k = "#2a241c";
  const g = "#2f7d4a";
  const s = "#c4962c";
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
    deco(g, q.path([[0.54, 0.065], [0.56, 0.055], [0.55, 0.08], [0.54, 0.065]]), "head", 0.8),
    // carved face: triangle eyes, a jagged grin
    deco(k, q.path([[0.47, 0.145], [0.485, 0.122], [0.497, 0.145], [0.47, 0.145]]), "head", 0.9),
    deco(k, q.path([[0.515, 0.145], [0.53, 0.122], [0.542, 0.145], [0.515, 0.145]]), "head", 0.9),
    deco(k, q.path([[0.496, 0.152], [0.504, 0.152], [0.50, 0.160], [0.496, 0.152]]), "head", 0.8),
    deco(s, q.path([[0.475, 0.142], [0.485, 0.126], [0.495, 0.142]]), "head", 0.7),
    deco(s, q.path([[0.518, 0.142], [0.53, 0.126], [0.54, 0.142]]), "head", 0.7),
    deco(k, q.path([[0.462, 0.172], [0.477, 0.188], [0.49, 0.176], [0.503, 0.192], [0.516, 0.177], [0.53, 0.19], [0.548, 0.17]]), "head", 0.9),
    deco(s, q.path([[0.465, 0.174], [0.48, 0.19], [0.495, 0.178], [0.51, 0.194], [0.525, 0.178], [0.54, 0.192], [0.55, 0.172]]), "head", 0.65),
    // a ragged cloak from the shoulders to the knees, torn at the hem
    deco(k, q.path([[0.47, 0.235], [0.43, 0.32], [0.415, 0.45], [0.41, 0.6], [0.42, 0.66]]), "torso", 1.1),
    deco(k, q.path([[0.53, 0.235], [0.57, 0.32], [0.585, 0.45], [0.59, 0.6], [0.58, 0.66]]), "torso", 1.1),
    deco(k, q.path([[0.42, 0.66], [0.44, 0.62], [0.46, 0.67], [0.48, 0.62], [0.5, 0.68], [0.52, 0.62], [0.54, 0.67], [0.56, 0.62], [0.58, 0.66]]), "torso", 0.9),
    deco(k, scribble(93, 0.435, 0.565, 0.32, 0.58, 6), "torso", 0.35),
    // cloak folds & stitched patch with cross-threads
    deco(k, q.path([[0.45, 0.28], [0.44, 0.48], [0.43, 0.64]]), "torso", 0.8),
    deco(k, q.path([[0.55, 0.28], [0.56, 0.48], [0.57, 0.64]]), "torso", 0.8),
    deco("#8a5a32", q.path([[0.44, 0.38], [0.47, 0.38], [0.47, 0.43], [0.44, 0.43], [0.44, 0.38]]), "torso", 0.75),
    deco(s, q.path([[0.445, 0.39], [0.465, 0.42]]), "torso", 0.6),
    deco(s, q.path([[0.445, 0.42], [0.465, 0.39]]), "torso", 0.6),
    // a rope belt, straw poking out of the sleeves, collar and hem
    deco("#8a5a32", q.path([[0.43, 0.47], [0.5, 0.485], [0.57, 0.47]]), "torso", 0.8),
    deco(s, q.path([[0.37, 0.47], [0.355, 0.495]]), "auto", 0.6),
    deco(s, q.path([[0.37, 0.47], [0.375, 0.5]]), "auto", 0.6),
    deco(s, q.path([[0.64, 0.46], [0.655, 0.49]]), "auto", 0.6),
    deco(s, q.path([[0.64, 0.46], [0.635, 0.492]]), "auto", 0.6),
    deco(s, q.path([[0.48, 0.22], [0.46, 0.245]]), "torso", 0.7),
    deco(s, q.path([[0.52, 0.22], [0.54, 0.245]]), "torso", 0.7),
    deco(s, q.path([[0.44, 0.66], [0.43, 0.71]]), "torso", 0.65),
    deco(s, q.path([[0.50, 0.68], [0.50, 0.73]]), "torso", 0.65),
    deco(s, q.path([[0.56, 0.66], [0.57, 0.71]]), "torso", 0.65),
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
    // cranial suture lines
    deco(k, q.path([[0.485, 0.082], [0.495, 0.09], [0.49, 0.098], [0.50, 0.106], [0.505, 0.115]]), "head", 0.55),
    // skull: hollow eyes, a nose hole, a row of teeth
    deco(k, q.ellipse(0.478, 0.145, 0.014, 0.016), "head", 1),
    deco(k, q.ellipse(0.522, 0.145, 0.014, 0.016), "head", 1),
    deco(k, q.path([[0.495, 0.17], [0.5, 0.162], [0.505, 0.17]]), "head", 0.7),
    deco(k, q.path([[0.474, 0.19], [0.526, 0.19]]), "head", 0.7),
    ...[0.482, 0.494, 0.506, 0.518].map((x) => deco(k, q.path([[x, 0.183], [x, 0.197]]), "head", 0.5)),
    // cheekbones & jawline
    deco(k, q.path([[0.445, 0.15], [0.46, 0.17], [0.47, 0.185]]), "head", 0.75),
    deco(k, q.path([[0.555, 0.15], [0.54, 0.17], [0.53, 0.185]]), "head", 0.75),
    deco(k, q.path([[0.468, 0.205], [0.50, 0.215], [0.532, 0.205]]), "head", 0.8),
    // neck vertebrae and sternum
    deco(k, q.ellipse(0.50, 0.23, 0.012, 0.006), "torso", 0.7),
    deco(k, q.ellipse(0.50, 0.245, 0.012, 0.006), "torso", 0.7),
    deco(k, q.path([[0.50, 0.26], [0.50, 0.40]]), "torso", 1.3),
    // ribcage: curved ribs on both sides of the spine, and a pelvis bowl
    ...[0.27, 0.31, 0.35, 0.39].map((y, i) => deco(k, q.arc(0.5, y, 0.055 - i * 0.004, 0.022, 0.2, Math.PI - 0.2, 10), "torso", 0.8)),
    deco(k, q.arc(0.5, 0.545, 0.05, 0.03, 0.1, Math.PI - 0.1, 10), "torso", 0.9),
    deco(k, q.arc(0.465, 0.54, 0.018, 0.014, 0, Math.PI * 2, 8), "torso", 0.65),
    deco(k, q.arc(0.535, 0.54, 0.018, 0.014, 0, Math.PI * 2, 8), "torso", 0.65),
    // lumbar vertebrae
    deco(k, q.ellipse(0.50, 0.43, 0.014, 0.007), "torso", 0.75),
    deco(k, q.ellipse(0.50, 0.47, 0.015, 0.007), "torso", 0.75),
    deco(k, q.ellipse(0.50, 0.51, 0.016, 0.008), "torso", 0.75),
    // knobbly joints: little double bumps at elbows, knees, hands and feet
    ...([[0.41, 0.39], [0.6, 0.385], [0.455, 0.745], [0.555, 0.745]] as [number, number][]).map(([x, y]) => deco(k, q.ellipse(x, y, 0.011, 0.011), "auto", 0.7)),
    ...([[0.38, 0.48], [0.635, 0.47]] as [number, number][]).map(([x, y]) => deco(k, q.path([[x - 0.012, y + 0.008], [x, y + 0.02], [x + 0.012, y + 0.008]]), "auto", 0.6)),
    deco(k, q.path([[0.43, 0.93], [0.465, 0.93]]), "auto", 0.7),
    deco(k, q.path([[0.56, 0.93], [0.6, 0.93]]), "auto", 0.7),
    // forearm and shin double bones
    deco(k, q.path([[0.405, 0.41], [0.385, 0.47]]), "auto", 0.65),
    deco(k, q.path([[0.595, 0.41], [0.625, 0.46]]), "auto", 0.65),
    deco(k, q.path([[0.45, 0.76], [0.44, 0.91]]), "auto", 0.65),
    deco(k, q.path([[0.56, 0.76], [0.57, 0.91]]), "auto", 0.65),
    // clawing finger phalanges
    deco(k, q.path([[0.365, 0.49], [0.355, 0.51]]), "auto", 0.6),
    deco(k, q.path([[0.645, 0.48], [0.655, 0.50]]), "auto", 0.6),
  ];
  return [...read, ...D];
}

/**
 * Phantom Delux: a dashing gentleman thief inspired by Kaitou DX (Doraemon).
 * Top hat, cape, domino mask, white gloves, and a "DX" calling card.
 * Phantoms phase out of reality to become completely invisible and untouchable for a few seconds.
 */
function phantom(): InkStroke[] {
  const c = "#1a1520"; // near-black graphite (tuxedo)
  const v = "#5d3b82"; // rich violet (cape lining)
  const gold = "#c4962c"; // gold accents (hat band, mask trim, buttons)
  const w = "#f0f4f8"; // white (shirt, gloves, calling card)
  const skin = "#e8d5be"; // skin tone (chin visible below mask)
  const p = pencil(111);
  const q = pencil(112);

  // ── read strokes: unarmed gentleman-thief skeleton ──
  const read: InkStroke[] = [
    { color: c, points: p.ellipse(0.5, 0.15, 0.06, 0.068) },             // head
    { color: c, points: p.path([[0.5, 0.22], [0.5, 0.55]]) },             // torso
    { color: c, points: p.path([[0.5, 0.29], [0.4, 0.37], [0.35, 0.46]]) },   // back arm
    { color: c, points: p.path([[0.5, 0.29], [0.6, 0.36], [0.65, 0.44]]) },   // front arm (no weapon!)
    { color: c, points: p.path([[0.5, 0.55], [0.42, 0.73], [0.38, 0.93]]) },  // back leg
    { color: c, points: p.path([[0.5, 0.55], [0.6, 0.73], [0.63, 0.93]]) },   // front leg
  ];

  const D: InkStroke[] = [
    // ── TOP HAT ──
    // hat brim: wide flat ellipse sitting on top of the head
    deco(c, q.path([[0.42, 0.095], [0.58, 0.095]]), "head", 1.6),
    // hat crown: tall rectangle
    deco(c, q.path([[0.44, 0.095], [0.44, 0.03], [0.56, 0.03], [0.56, 0.095]]), "head", 1.3),
    // second pass on crown for pencil-dark emphasis
    deco(c, q.path([[0.445, 0.09], [0.445, 0.035], [0.555, 0.035], [0.555, 0.09]]), "head", 1.0),
    // hat band in gold
    deco(gold, q.path([[0.44, 0.08], [0.56, 0.08]]), "head", 1.4),

    // ── DOMINO MASK ──
    // mask: dark band across the eyes with pointed outer edges
    deco(c, q.path([[0.43, 0.145], [0.46, 0.138], [0.50, 0.135], [0.54, 0.138], [0.575, 0.145]]), "head", 1.5),
    deco(c, q.path([[0.43, 0.145], [0.46, 0.152], [0.50, 0.155], [0.54, 0.152], [0.575, 0.145]]), "head", 1.5),
    // mask filled in with scribble
    deco(c, q.path([[0.44, 0.14], [0.56, 0.14], [0.56, 0.155], [0.44, 0.155]]), "head", 1.2),
    // gold trim along mask top edge
    deco(gold, q.path([[0.435, 0.14], [0.50, 0.133], [0.57, 0.14]]), "head", 1.1),
    // white eye glints peering through the mask
    deco(w, q.ellipse(0.475, 0.146, 0.007, 0.005), "head", 1.4),
    deco(w, q.ellipse(0.525, 0.146, 0.007, 0.005), "head", 1.4),

    // ── FACE ──
    // slight smirk / chin visible below mask
    deco(skin, q.arc(0.50, 0.175, 0.025, 0.012, 0.2, 2.9, 8), "head", 0.9),
    // smirk line
    deco(c, q.path([[0.485, 0.18], [0.52, 0.175]]), "head", 0.7),

    // ── BOW TIE ──
    deco(v, q.path([[0.49, 0.235], [0.47, 0.225], [0.49, 0.215], [0.49, 0.235]]), "torso", 1.2),
    deco(v, q.path([[0.51, 0.235], [0.53, 0.225], [0.51, 0.215], [0.51, 0.235]]), "torso", 1.2),
    deco(gold, q.ellipse(0.50, 0.225, 0.004, 0.004), "torso", 1.3),

    // ── TUXEDO JACKET ──
    // left lapel
    deco(c, q.path([[0.47, 0.24], [0.44, 0.27], [0.43, 0.44], [0.45, 0.53]]), "torso", 1.2),
    // right lapel
    deco(c, q.path([[0.53, 0.24], [0.56, 0.27], [0.57, 0.44], [0.55, 0.53]]), "torso", 1.2),
    // lapel fold lines (V-shape)
    deco(c, q.path([[0.47, 0.24], [0.50, 0.30]]), "torso", 1.0),
    deco(c, q.path([[0.53, 0.24], [0.50, 0.30]]), "torso", 1.0),
    // white shirt front visible between lapels
    deco(w, q.path([[0.49, 0.26], [0.49, 0.52]]), "torso", 1.0),
    deco(w, q.path([[0.51, 0.26], [0.51, 0.52]]), "torso", 1.0),
    // gold buttons down the shirt
    ...[0.32, 0.38, 0.44, 0.49].map((y) => deco(gold, q.ellipse(0.50, y, 0.003, 0.003), "torso", 1.2)),

    // ── CAPE (draped from shoulders, flowing behind) ──
    // cape outer edge
    deco(c, q.path([[0.42, 0.28], [0.35, 0.36], [0.30, 0.50], [0.29, 0.66], [0.31, 0.75]]), "torso", 1.3),
    // cape inner lining in violet
    deco(v, q.path([[0.42, 0.29], [0.36, 0.37], [0.32, 0.50], [0.31, 0.65], [0.33, 0.73]]), "torso", 1.1),
    // cape bottom flourish / drape
    deco(v, q.path([[0.31, 0.75], [0.34, 0.70], [0.37, 0.74], [0.40, 0.69], [0.43, 0.72]]), "torso", 0.9),
    // inner cape fold
    deco(c, q.path([[0.35, 0.37], [0.33, 0.55]]), "torso", 0.7),

    // ── WAISTCOAT / BELT ──
    deco(c, q.path([[0.44, 0.52], [0.56, 0.52]]), "torso", 1.4),
    deco(gold, q.path([[0.44, 0.525], [0.56, 0.525]]), "torso", 1.0),

    // ── TUXEDO TAILS / JACKET HEM ──
    deco(c, q.path([[0.44, 0.53], [0.42, 0.63], [0.45, 0.61], [0.48, 0.64], [0.52, 0.61], [0.55, 0.63], [0.56, 0.53]]), "auto", 1.1),

    // ── SLEEVES ──
    deco(c, q.path([[0.38, 0.40], [0.33, 0.44]]), "auto", 1.1),
    deco(c, q.path([[0.62, 0.38], [0.66, 0.42]]), "auto", 1.1),

    // ── WHITE GLOVES ──
    // back hand glove
    deco(w, q.arc(0.35, 0.46, 0.016, 0.014, -1.0, 3.5, 8), "auto", 1.2),
    deco(w, q.path([[0.34, 0.455], [0.33, 0.47], [0.355, 0.47]]), "auto", 0.8),
    // front hand glove (holding calling card)
    deco(w, q.arc(0.65, 0.44, 0.016, 0.014, -1.5, 2.5, 8), "auto", 1.2),
    deco(w, q.path([[0.64, 0.435], [0.63, 0.45], [0.655, 0.45]]), "auto", 0.8),
    // glove cuff lines
    deco(w, q.path([[0.34, 0.44], [0.36, 0.44]]), "auto", 1.0),
    deco(w, q.path([[0.64, 0.42], [0.66, 0.42]]), "auto", 1.0),

    // ── "DX" CALLING CARD in front hand ──
    // small white card rectangle
    deco(w, q.path([[0.67, 0.40], [0.73, 0.38], [0.73, 0.44], [0.67, 0.46], [0.67, 0.40]]), "auto", 1.0),
    // "D" letter on card
    deco(gold, q.path([[0.685, 0.41], [0.685, 0.43], [0.695, 0.43], [0.695, 0.41], [0.685, 0.41]]), "auto", 0.7),
    deco(gold, q.arc(0.695, 0.42, 0.005, 0.01, -1.5, 1.5, 6), "auto", 0.7),
    // "X" letter on card
    deco(gold, q.path([[0.705, 0.41], [0.72, 0.43]]), "auto", 0.7),
    deco(gold, q.path([[0.72, 0.41], [0.705, 0.43]]), "auto", 0.7),

    // ── DRESS TROUSERS ──
    // trouser crease lines
    deco(c, q.path([[0.44, 0.60], [0.42, 0.73]]), "auto", 0.8),
    deco(c, q.path([[0.57, 0.60], [0.60, 0.73]]), "auto", 0.8),

    // ── DRESS SHOES ──
    // pointed dress shoes
    deco(c, q.path([[0.36, 0.92], [0.40, 0.93]]), "auto", 1.3),
    deco(c, q.path([[0.61, 0.92], [0.66, 0.93]]), "auto", 1.3),
    // shoe soles
    deco(c, q.path([[0.35, 0.93], [0.41, 0.93]]), "auto", 1.4),
    deco(c, q.path([[0.60, 0.93], [0.66, 0.93]]), "auto", 1.4),
    // shoe shine highlights
    deco(w, q.path([[0.37, 0.925], [0.39, 0.925]]), "auto", 0.6),
    deco(w, q.path([[0.62, 0.925], [0.64, 0.925]]), "auto", 0.6),
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
  { id: "phantom", name: "Phantom Delux", blurb: "gentleman thief, disappears in a flash", tier: 3, strokes: phantom(), signature: "phantom" },
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
