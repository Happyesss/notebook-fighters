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

export type RosterId = "bodybuilder" | "ninja" | "pehelwan" | "boxer" | "kid" | "karate" | "swordsman" | "dog" | "halloween" | "skeleton" | "phantom" | "spiderman";
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
  /** multipliers on top of the usual rival strength (hit points, walking speed) */
  hpMult?: number;
  speedMult?: number;
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
const deco = (color: string, points: Pt[], where: "head" | "torso" | "weapon" | "auto" = "auto", w = 1): InkStroke => ({ color, points, deco: where, w });
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

/**
 * The Hulk (formerly Bodybuilder): a hulking brute drawn in heavy comic green graphite.
 * Massive trapezius, furious jaw and brow, snarling mouth, sculpted slab pecs and 6-pack abs,
 * boulder deltoids, giant clenched fists, shredded purple torn shorts and heavy bare feet.
 * Stands in a natural, powerful fighting stance with arms at his sides.
 */
function bodybuilder(): InkStroke[] {
  const c = "#26541f";       // deep comic green
  const cDark = "#163312";   // dark ink shadow / contour
  const cLight = "#4ea03b";  // muscle highlight green
  const shorts = "#6c389e";  // classic purple torn shorts
  const shortsDark = "#431e68";
  const white = "#f0f6ec";
  const hair = "#122010";

  const p = pencil(21);
  const q = pencil(22);
  const q2 = pencil(23);

  // ── READ SKELETON: heavy biped with natural grounded ready arms (not lifted!) ──
  const read: InkStroke[] = [
    { color: c, points: p.ellipse(0.5, 0.145, 0.062, 0.068), w: 1.2 },
    ...thick(c, [[0.5, 0.215], [0.5, 0.56]], 2, 0.008, 210),
    ...thick(c, [[0.5, 0.29], [0.38, 0.38], [0.33, 0.47]], 2, 0.008, 220),
    ...thick(c, [[0.5, 0.29], [0.62, 0.38], [0.67, 0.46]], 2, 0.008, 230),
    ...thick(c, [[0.5, 0.56], [0.41, 0.74], [0.37, 0.93]], 2, 0.008, 240),
    ...thick(c, [[0.5, 0.56], [0.60, 0.74], [0.64, 0.93]], 2, 0.008, 250),
    // barrel chest bulk
    { color: c, points: p.arc(0.5, 0.31, 0.09, 0.065, 0.25, 2.9, 14) },
  ];

  const D: InkStroke[] = [
    // ── WILD MESSY HULK HAIR ──
    deco(hair, q.path([[0.43, 0.11], [0.44, 0.065], [0.465, 0.085], [0.495, 0.052], [0.525, 0.082], [0.555, 0.06], [0.57, 0.105], [0.555, 0.13]]), "head", 1.6),
    deco(hair, q2.path([[0.445, 0.075], [0.475, 0.055], [0.51, 0.072], [0.54, 0.052], [0.565, 0.08]]), "head", 1.3),
    deco(hair, q.path([[0.435, 0.115], [0.46, 0.10], [0.485, 0.115], [0.515, 0.10], [0.54, 0.115], [0.565, 0.11]]), "head", 1.2),

    // ── SQUARE JAW & CHIN ──
    deco(cDark, q.path([[0.438, 0.145], [0.442, 0.185], [0.465, 0.215], [0.50, 0.222], [0.535, 0.215], [0.558, 0.185], [0.562, 0.145]]), "head", 1.8),
    deco(cDark, q2.path([[0.44, 0.15], [0.445, 0.185], [0.47, 0.212], [0.50, 0.218], [0.53, 0.212], [0.555, 0.185], [0.56, 0.15]]), "head", 1.2),
    // chin cleft
    deco(cDark, q.path([[0.495, 0.214], [0.50, 0.222], [0.505, 0.214]]), "head", 1.2),

    // ── FIERCE ANGRY BROW & FOREHEAD FURROW ──
    deco(cDark, q.path([[0.442, 0.12], [0.47, 0.13], [0.498, 0.142]]), "head", 2.2),
    deco(cDark, q.path([[0.558, 0.12], [0.53, 0.13], [0.502, 0.142]]), "head", 2.2),
    deco(cDark, q.path([[0.488, 0.112], [0.496, 0.13]]), "head", 1.0),
    deco(cDark, q.path([[0.512, 0.112], [0.504, 0.13]]), "head", 1.0),

    // ── GLOWING WHITE EYES & PUPILS ──
    deco(white, q.path([[0.458, 0.138], [0.488, 0.144], [0.466, 0.152], [0.458, 0.138]]), "head", 1.6),
    deco(white, q.path([[0.542, 0.138], [0.512, 0.144], [0.534, 0.152], [0.542, 0.138]]), "head", 1.6),
    deco(cDark, q.ellipse(0.475, 0.145, 0.003, 0.004), "head", 1.3),
    deco(cDark, q.ellipse(0.525, 0.145, 0.003, 0.004), "head", 1.3),

    // ── SNARLING NOSE ──
    deco(cDark, q.path([[0.492, 0.152], [0.490, 0.165], [0.510, 0.165], [0.508, 0.152]]), "head", 1.0),

    // ── GRITTED TEETH & FURIOUS MOUTH ──
    deco(white, q.path([[0.462, 0.180], [0.538, 0.180], [0.534, 0.198], [0.466, 0.198], [0.462, 0.180]]), "head", 1.8),
    deco(cDark, q.path([[0.458, 0.178], [0.50, 0.174], [0.542, 0.178]]), "head", 1.5),
    deco(cDark, q.path([[0.462, 0.200], [0.50, 0.204], [0.538, 0.200]]), "head", 1.5),
    // tooth lines
    deco(cDark, q.path([[0.462, 0.189], [0.538, 0.189]]), "head", 0.9),
    ...[0.476, 0.492, 0.508, 0.524].map((x) => deco(cDark, q.path([[x, 0.180], [x, 0.198]]), "head", 0.8)),

    // ── MASSIVE SLOPING TRAPS & NECK ──
    deco(cDark, q.path([[0.44, 0.175], [0.39, 0.21], [0.34, 0.26], [0.33, 0.29]]), "auto", 1.8),
    deco(cDark, q.path([[0.56, 0.175], [0.61, 0.21], [0.66, 0.26], [0.67, 0.29]]), "auto", 1.8),
    deco(c, q2.path([[0.445, 0.18], [0.40, 0.215], [0.355, 0.26]]), "auto", 1.1),
    deco(c, q2.path([[0.555, 0.18], [0.60, 0.215], [0.645, 0.26]]), "auto", 1.1),
    deco(cDark, q.path([[0.465, 0.215], [0.48, 0.25]]), "torso", 1.0),
    deco(cDark, q.path([[0.535, 0.215], [0.52, 0.25]]), "torso", 1.0),

    // ── BROAD CHEST PECS & STERNUM ──
    deco(cDark, q.path([[0.50, 0.25], [0.43, 0.265], [0.40, 0.315], [0.44, 0.355], [0.50, 0.355]]), "torso", 1.8),
    deco(cDark, q.path([[0.50, 0.25], [0.57, 0.265], [0.60, 0.315], [0.56, 0.355], [0.50, 0.355]]), "torso", 1.8),
    deco(cDark, q.path([[0.50, 0.25], [0.50, 0.52]]), "torso", 1.2),
    deco(cLight, q.path([[0.445, 0.28], [0.425, 0.31], [0.46, 0.34]]), "torso", 1.0),
    deco(cLight, q.path([[0.555, 0.28], [0.575, 0.31], [0.54, 0.34]]), "torso", 1.0),

    // ── 6-PACK ABS & SERRATUS RIBS ──
    deco(cDark, q.path([[0.455, 0.395], [0.50, 0.402], [0.545, 0.395]]), "torso", 1.2),
    deco(cDark, q.path([[0.450, 0.440], [0.50, 0.446], [0.550, 0.440]]), "torso", 1.2),
    deco(cDark, q.path([[0.455, 0.485], [0.50, 0.490], [0.545, 0.485]]), "torso", 1.2),
    deco(cDark, q.path([[0.40, 0.32], [0.41, 0.41], [0.435, 0.52]]), "torso", 1.6),
    deco(cDark, q.path([[0.60, 0.32], [0.59, 0.41], [0.565, 0.52]]), "torso", 1.6),
    // serratus cuts
    deco(cDark, q.path([[0.415, 0.36], [0.435, 0.37]]), "torso", 0.9),
    deco(cDark, q.path([[0.42, 0.40], [0.44, 0.41]]), "torso", 0.9),
    deco(cDark, q.path([[0.585, 0.36], [0.565, 0.37]]), "torso", 0.9),
    deco(cDark, q.path([[0.58, 0.40], [0.56, 0.41]]), "torso", 0.9),

    // ── BOULDER DELTOIDS & BICEPS (ARMS) ──
    // back arm (left side)
    deco(cDark, q.arc(0.35, 0.29, 0.045, 0.035, 0.8, 3.4, 8), "auto", 1.8),
    deco(cDark, q.path([[0.33, 0.30], [0.30, 0.35], [0.34, 0.39]]), "auto", 1.7),
    deco(cDark, q.path([[0.39, 0.30], [0.42, 0.35], [0.38, 0.39]]), "auto", 1.6),
    deco(cLight, q.path([[0.33, 0.33], [0.32, 0.37]]), "auto", 0.9),
    // back forearm & fist
    deco(cDark, q.path([[0.34, 0.39], [0.30, 0.43], [0.31, 0.47]]), "auto", 1.6),
    deco(cDark, q.path([[0.38, 0.39], [0.36, 0.44], [0.35, 0.47]]), "auto", 1.6),
    // big back fist
    deco(cDark, q.ellipse(0.33, 0.49, 0.026, 0.028), "auto", 1.8),
    deco(cDark, q.path([[0.31, 0.49], [0.35, 0.49]]), "auto", 1.3),
    deco(cDark, q.path([[0.34, 0.47], [0.35, 0.50]]), "auto", 1.1),

    // front arm (right side)
    deco(cDark, q.arc(0.65, 0.29, 0.045, 0.035, -0.3, 2.3, 8), "auto", 1.8),
    deco(cDark, q.path([[0.67, 0.30], [0.70, 0.35], [0.66, 0.39]]), "auto", 1.7),
    deco(cDark, q.path([[0.61, 0.30], [0.58, 0.35], [0.62, 0.39]]), "auto", 1.6),
    deco(cLight, q.path([[0.67, 0.33], [0.68, 0.37]]), "auto", 0.9),
    // front forearm & fist
    deco(cDark, q.path([[0.66, 0.39], [0.69, 0.43], [0.68, 0.46]]), "auto", 1.6),
    deco(cDark, q.path([[0.62, 0.39], [0.64, 0.44], [0.65, 0.46]]), "auto", 1.6),
    // big front fist
    deco(cDark, q.ellipse(0.67, 0.48, 0.026, 0.028), "auto", 1.8),
    deco(cDark, q.path([[0.65, 0.48], [0.69, 0.48]]), "auto", 1.3),
    deco(cDark, q.path([[0.65, 0.46], [0.64, 0.49]]), "auto", 1.1),

    // ── TORN PURPLE SHORTS ──
    // waistband
    deco(shortsDark, q.path([[0.435, 0.52], [0.50, 0.535], [0.565, 0.52]]), "torso", 2.4),
    deco(shorts, q2.path([[0.438, 0.526], [0.50, 0.540], [0.562, 0.526]]), "torso", 1.4),
    deco(shortsDark, q.path([[0.50, 0.535], [0.50, 0.59]]), "auto", 1.4),
    // back leg shorts tube & ripped jagged hem
    deco(shortsDark, q.path([[0.435, 0.52], [0.39, 0.60], [0.38, 0.67]]), "auto", 1.8),
    deco(shortsDark, q.path([[0.49, 0.58], [0.47, 0.64], [0.46, 0.68]]), "auto", 1.6),
    deco(shortsDark, q.path([[0.38, 0.67], [0.40, 0.64], [0.42, 0.68], [0.44, 0.63], [0.46, 0.68]]), "auto", 1.8),
    deco(shorts, q.path([[0.39, 0.56], [0.42, 0.64]]), "auto", 0.9),
    // front leg shorts tube & ripped jagged hem
    deco(shortsDark, q.path([[0.565, 0.52], [0.61, 0.60], [0.62, 0.67]]), "auto", 1.8),
    deco(shortsDark, q.path([[0.51, 0.58], [0.53, 0.64], [0.54, 0.68]]), "auto", 1.6),
    deco(shortsDark, q.path([[0.54, 0.68], [0.56, 0.63], [0.58, 0.68], [0.60, 0.64], [0.62, 0.67]]), "auto", 1.8),
    deco(shorts, q.path([[0.61, 0.56], [0.58, 0.64]]), "auto", 0.9),

    // ── POWERFUL LEGS & BARE PLANTED FEET ──
    // back leg muscles
    deco(cDark, q.path([[0.39, 0.74], [0.35, 0.82], [0.36, 0.91]]), "auto", 1.8),
    deco(cDark, q.path([[0.44, 0.74], [0.43, 0.82], [0.40, 0.91]]), "auto", 1.6),
    deco(cLight, q.path([[0.37, 0.78], [0.37, 0.86]]), "auto", 0.9),
    // back bare foot
    deco(cDark, q.path([[0.32, 0.93], [0.41, 0.93]]), "auto", 1.8),
    deco(cDark, q.path([[0.35, 0.90], [0.32, 0.93]]), "auto", 1.4),
    deco(cDark, q.path([[0.39, 0.91], [0.41, 0.93]]), "auto", 1.4),
    deco(cDark, q.path([[0.37, 0.91], [0.37, 0.93]]), "auto", 0.8), // toe divider

    // front leg muscles
    deco(cDark, q.path([[0.61, 0.74], [0.65, 0.82], [0.64, 0.91]]), "auto", 1.8),
    deco(cDark, q.path([[0.57, 0.74], [0.58, 0.82], [0.60, 0.91]]), "auto", 1.6),
    deco(cLight, q.path([[0.63, 0.78], [0.63, 0.86]]), "auto", 0.9),
    // front bare foot
    deco(cDark, q.path([[0.59, 0.93], [0.68, 0.93]]), "auto", 1.8),
    deco(cDark, q.path([[0.61, 0.90], [0.59, 0.93]]), "auto", 1.4),
    deco(cDark, q.path([[0.66, 0.91], [0.68, 0.93]]), "auto", 1.4),
    deco(cDark, q.path([[0.64, 0.91], [0.64, 0.93]]), "auto", 0.8), // toe divider
  ];

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
    // broadsword: gleaming steel fill, crisp dark outline, fuller groove & golden guard/pommel
    deco("#d8e2ec", q.path([[0.66, 0.405], [0.855, 0.21], [0.85, 0.19], [0.655, 0.385]]), "weapon", 1.6),
    deco(s, q.path([[0.66, 0.41], [0.855, 0.215], [0.86, 0.2], [0.845, 0.185], [0.65, 0.385]]), "weapon", 1.2),
    deco(c, q.path([[0.67, 0.395], [0.83, 0.23]]), "weapon", 0.9),
    deco(s, q.path([[0.845, 0.185], [0.865, 0.195], [0.855, 0.215]]), "weapon", 1.2),
    deco(g, q.path([[0.635, 0.355], [0.705, 0.425]]), "weapon", 1.8),
    deco(g, q.ellipse(0.64, 0.36, 0.009, 0.009), "weapon", 1.3),
    deco(g, q.ellipse(0.70, 0.42, 0.009, 0.009), "weapon", 1.3),
    deco(s, q.path([[0.65, 0.39], [0.63, 0.43]]), "weapon", 1.4),
    deco(g, q.ellipse(0.63, 0.43, 0.011, 0.011), "weapon", 1.5),
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
  const w = "#f6f8f0";
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
    // simple head: a boxy snout, black nose, one eye, a floppy ear, a short mouth with two fangs
    deco(c, q.path([[0.785, 0.335], [0.855, 0.345], [0.862, 0.395], [0.775, 0.405]]), "head", 1.8),
    deco("#1a1512", q.ellipse(0.862, 0.352, 0.012, 0.01), "head", 2.2),
    deco("#1a1512", q.ellipse(0.757, 0.335, 0.007, 0.008), "head", 2.2),
    deco(d, q.path([[0.705, 0.305], [0.675, 0.395], [0.725, 0.365], [0.705, 0.305]]), "head", 1.8),
    deco(d, q.path([[0.785, 0.385], [0.855, 0.385]]), "head", 1.4),
    deco(w, q.path([[0.815, 0.385], [0.822, 0.415], [0.83, 0.385]]), "head", 1.6),
    deco(w, q.path([[0.84, 0.385], [0.846, 0.41], [0.853, 0.385]]), "head", 1.6),
    // a red collar
    deco(r, q.path([[0.69, 0.425], [0.725, 0.435]]), "head", 3),
    // back and belly lines, and a spot
    deco(c, q.path([[0.32, 0.47], [0.48, 0.46], [0.64, 0.46]]), "auto", 1.4),
    deco(c, q.path([[0.38, 0.54], [0.5, 0.535], [0.61, 0.525]]), "auto", 1.2),
    deco(d, q.ellipse(0.48, 0.5, 0.04, 0.026), "auto", 1.4),
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

/**
 * Spider-Man: peak-detail comic-book wall-crawler in his iconic red & blue suit.
 * Features:
 *  - Classic Romita/McFarlane large expressive eye lenses with thick black tapering rims and reflection sheen
 *  - Intricate spiderweb mask grid with center hub and 3 tiers of scalloped arcs
 *  - Athletic superhero anatomy: defined pecs, 6-pack abs, deltoids, and serratus cuts under the spandex
 *  - Bold black chest spider emblem with 8 angular articulated legs
 *  - Red & blue comic-book suit blocking with underarm pit-web wings and shadow hatching
 *  - Signature "THWIP" web-shooter hand gesture with wrist shooter device and shooting web strand
 *  - High red boots with pointed chevron tops and web lacing
 */
/**
 * Spider-Man: authentic comic-book wall-crawler in his iconic scarlet & cobalt suit.
 * Hand-drawn in notebook pencil style matching the quality of Phantom Delux and Swordsman:
 *  - Classic McFarlane / Romita large expressive white eye lenses with thick tapered black borders
 *  - Radiating spiderweb mask grid from central nose hub with concentric scalloped arcs
 *  - Athletic superhero anatomy with defined pecs, ab cuts, and blue flank panels
 *  - Bold black chest spider emblem with 8 articulated legs
 *  - Underarm spiderweb pit-wings, red pointed V-belt, and red webbed gloves
 *  - High red superhero boots with sharp pointed chevron tops and web lacing
 */
function spiderman(): InkStroke[] {
  const r = "#c72032";       // vibrant comic scarlet red
  const rDark = "#8e1522";   // deep red shadow / contour
  const b = "#1c3b7a";       // classic comic cobalt blue
  const bDark = "#102047";   // deep navy blue
  const k = "#18141c";       // dense black ink for spiderwebs, emblem & lens frames
  const w = "#f5f8fc";       // gleaming white eye lenses
  const gleam = "#a5c8ed";   // subtle lens gleam

  const p = pencil(130);
  const q = pencil(131);
  const q2 = pencil(132);

  // ── READ SKELETON: athletic agile biped superhero in suit colors ──
  const read: InkStroke[] = [
    { color: r, points: p.ellipse(0.5, 0.15, 0.058, 0.068) },
    { color: r, points: p.path([[0.5, 0.22], [0.5, 0.55]]) },
    { color: r, points: p.path([[0.5, 0.29], [0.39, 0.38], [0.34, 0.47]]) },
    { color: r, points: p.path([[0.5, 0.29], [0.61, 0.37], [0.66, 0.45]]) },
    { color: b, points: p.path([[0.5, 0.55], [0.42, 0.73], [0.38, 0.93]]) },
    { color: b, points: p.path([[0.5, 0.55], [0.60, 0.73], [0.63, 0.93]]) },
  ];

  const D: InkStroke[] = [
    // ══════════════════════════════════════════════════════════════
    // 1. HEAD & MASK: Aerodynamic skull, iconic eyes, radial web grid
    // ══════════════════════════════════════════════════════════════
    // Sleek comic mask contour
    deco(rDark, q.path([[0.5, 0.082], [0.452, 0.096], [0.442, 0.142], [0.455, 0.188], [0.482, 0.218], [0.5, 0.222], [0.518, 0.218], [0.545, 0.188], [0.558, 0.142], [0.548, 0.096], [0.5, 0.082]]), "head", 1.4),

    // ── LARGE EXPRESSIVE ROMITA/McFARLANE EYE LENSES ──
    // Left eye lens white interior fill
    deco(w, q.path([[0.440, 0.142], [0.462, 0.124], [0.490, 0.136], [0.488, 0.162], [0.460, 0.170], [0.440, 0.142]]), "head", 1.8),
    deco(w, q2.path([[0.444, 0.142], [0.464, 0.128], [0.486, 0.138], [0.484, 0.158], [0.462, 0.166], [0.444, 0.142]]), "head", 1.5),
    // Left eye lens thick black frame (McFarlane taper)
    deco(k, q.path([[0.436, 0.142], [0.462, 0.120], [0.494, 0.134], [0.492, 0.164], [0.458, 0.174], [0.436, 0.142]]), "head", 2.2),
    // Left eye diagonal sheen glint
    deco(gleam, q.path([[0.448, 0.138], [0.466, 0.156]]), "head", 0.9),

    // Right eye lens white interior fill
    deco(w, q.path([[0.560, 0.142], [0.538, 0.124], [0.510, 0.136], [0.512, 0.162], [0.540, 0.170], [0.560, 0.142]]), "head", 1.8),
    deco(w, q2.path([[0.556, 0.142], [0.536, 0.128], [0.514, 0.138], [0.516, 0.158], [0.538, 0.166], [0.556, 0.142]]), "head", 1.5),
    // Right eye lens thick black frame (McFarlane taper)
    deco(k, q.path([[0.564, 0.142], [0.538, 0.120], [0.506, 0.134], [0.508, 0.164], [0.542, 0.174], [0.564, 0.142]]), "head", 2.2),
    // Right eye diagonal sheen glint
    deco(gleam, q.path([[0.552, 0.138], [0.534, 0.156]]), "head", 0.9),

    // ── AUTHENTIC SPIDERWEB MASK GRID (Radiating from nose hub) ──
    // Center web hub
    deco(k, q.ellipse(0.50, 0.148, 0.003, 0.003), "head", 1.0),
    // Radial web lines
    deco(k, q.path([[0.50, 0.148], [0.50, 0.082]]), "head", 1.0),           // up to crown
    deco(k, q.path([[0.50, 0.148], [0.465, 0.092]]), "head", 0.9),          // up-left diagonal
    deco(k, q.path([[0.50, 0.148], [0.535, 0.092]]), "head", 0.9),          // up-right diagonal
    deco(k, q.path([[0.50, 0.148], [0.442, 0.120]]), "head", 0.8),          // left temple
    deco(k, q.path([[0.50, 0.148], [0.558, 0.120]]), "head", 0.8),          // right temple
    deco(k, q.path([[0.50, 0.148], [0.455, 0.192]]), "head", 0.8),          // left jaw
    deco(k, q.path([[0.50, 0.148], [0.545, 0.192]]), "head", 0.8),          // right jaw
    deco(k, q.path([[0.50, 0.148], [0.50, 0.222]]), "head", 1.0),           // down to chin
    // Scalloped concentric web arcs on forehead
    deco(k, q.path([[0.470, 0.108], [0.50, 0.116], [0.530, 0.108]]), "head", 0.8),
    deco(k, q.path([[0.458, 0.092], [0.50, 0.100], [0.542, 0.092]]), "head", 0.8),
    // Scalloped concentric web arcs below eyes and on chin
    deco(k, q.path([[0.468, 0.178], [0.50, 0.170], [0.532, 0.178]]), "head", 0.8),
    deco(k, q.path([[0.478, 0.198], [0.50, 0.192], [0.522, 0.198]]), "head", 0.8),

    // ══════════════════════════════════════════════════════════════
    // 2. TORSO: Red center vest, cobalt blue flanks, black spider
    // ══════════════════════════════════════════════════════════════
    // Blue flanks (latissimus / ribs)
    deco(b, q.path([[0.44, 0.27], [0.42, 0.36], [0.44, 0.52]]), "torso", 1.6),
    deco(bDark, q.path([[0.455, 0.26], [0.445, 0.35], [0.46, 0.44], [0.45, 0.52]]), "torso", 1.3),
    deco(b, q.path([[0.56, 0.27], [0.58, 0.36], [0.56, 0.52]]), "torso", 1.6),
    deco(bDark, q.path([[0.545, 0.26], [0.555, 0.35], [0.54, 0.44], [0.55, 0.52]]), "torso", 1.3),
    // Neck collar ring
    deco(rDark, q.arc(0.50, 0.222, 0.026, 0.012, 0.2, 2.9, 8), "torso", 1.2),
    // Chiseled superhero pecs in scarlet
    deco(rDark, q.path([[0.50, 0.25], [0.46, 0.26], [0.445, 0.30], [0.495, 0.33], [0.50, 0.33]]), "torso", 1.3),
    deco(rDark, q.path([[0.50, 0.25], [0.54, 0.26], [0.555, 0.30], [0.505, 0.33], [0.50, 0.33]]), "torso", 1.3),
    // Ab cuts
    deco(rDark, q.path([[0.47, 0.38], [0.50, 0.385], [0.53, 0.38]]), "torso", 0.9),
    deco(rDark, q.path([[0.465, 0.43], [0.50, 0.435], [0.535, 0.43]]), "torso", 0.9),
    deco(rDark, q.path([[0.47, 0.48], [0.50, 0.485], [0.53, 0.48]]), "torso", 0.9),

    // ── THE BOLD BLACK CHEST SPIDER EMBLEM ──
    // Spider thorax & abdomen body
    deco(k, q.ellipse(0.50, 0.315, 0.007, 0.010), "torso", 1.8),
    deco(k, q.ellipse(0.50, 0.335, 0.009, 0.014), "torso", 2.2),
    // Upper-left legs reaching upward
    deco(k, q.path([[0.495, 0.312], [0.47, 0.292], [0.46, 0.272]]), "torso", 1.3),
    deco(k, q.path([[0.505, 0.312], [0.53, 0.292], [0.54, 0.272]]), "torso", 1.3),
    // Mid-upper legs reaching outward
    deco(k, q.path([[0.493, 0.322], [0.465, 0.318], [0.45, 0.310]]), "torso", 1.3),
    deco(k, q.path([[0.507, 0.322], [0.535, 0.318], [0.55, 0.310]]), "torso", 1.3),
    // Mid-lower legs reaching downward-out
    deco(k, q.path([[0.493, 0.335], [0.465, 0.345], [0.455, 0.365]]), "torso", 1.3),
    deco(k, q.path([[0.507, 0.335], [0.535, 0.345], [0.545, 0.365]]), "torso", 1.3),
    // Lower legs pointing straight down toward abs
    deco(k, q.path([[0.496, 0.342], [0.48, 0.365], [0.475, 0.392]]), "torso", 1.3),
    deco(k, q.path([[0.504, 0.342], [0.52, 0.365], [0.525, 0.392]]), "torso", 1.3),

    // Webbing across red chest
    deco(k, q.path([[0.46, 0.26], [0.50, 0.275], [0.54, 0.26]]), "torso", 0.8),
    deco(k, q.path([[0.45, 0.35], [0.50, 0.365], [0.55, 0.35]]), "torso", 0.8),
    deco(k, q.path([[0.455, 0.45], [0.50, 0.465], [0.545, 0.45]]), "torso", 0.8),

    // ── RED POINTED V-BELT ──
    deco(rDark, q.path([[0.44, 0.52], [0.50, 0.545], [0.56, 0.52]]), "torso", 2.2),
    deco(rDark, q.path([[0.445, 0.538], [0.50, 0.562], [0.555, 0.538]]), "torso", 2.0),
    deco(k, q.path([[0.442, 0.529], [0.50, 0.554], [0.558, 0.529]]), "torso", 0.9),
    ...[0.46, 0.48, 0.52, 0.54].map((x) => deco(k, q.path([[x, 0.53], [x, 0.545]]), "torso", 0.7)),

    // ══════════════════════════════════════════════════════════════
    // 3. ARMS: Red sleeves, underarm pit-webs, red webbed gloves
    // ══════════════════════════════════════════════════════════════
    // Classic underarm pit-web wings!
    deco(k, q.path([[0.44, 0.29], [0.40, 0.34], [0.42, 0.38]]), "auto", 0.8),
    deco(k, q.path([[0.41, 0.31], [0.42, 0.36]]), "auto", 0.7),
    deco(k, q.path([[0.56, 0.29], [0.60, 0.34], [0.58, 0.38]]), "auto", 0.8),
    deco(k, q.path([[0.59, 0.31], [0.58, 0.36]]), "auto", 0.7),

    // Back arm (left): red shoulder cap, red glove with chevron cuff
    deco(rDark, q.path([[0.36, 0.29], [0.33, 0.34], [0.37, 0.38]]), "auto", 1.4),
    deco(rDark, q.path([[0.42, 0.29], [0.41, 0.34], [0.39, 0.38]]), "auto", 1.2),
    // Chevron glove cuff
    deco(rDark, q.path([[0.35, 0.39], [0.375, 0.41], [0.40, 0.39]]), "auto", 1.6),
    // Red forearm / glove
    deco(rDark, q.path([[0.35, 0.41], [0.32, 0.44], [0.33, 0.47]]), "auto", 1.6),
    deco(rDark, q.path([[0.39, 0.40], [0.36, 0.44], [0.35, 0.47]]), "auto", 1.4),
    // Back glove web pattern
    deco(k, q.path([[0.34, 0.43], [0.38, 0.42]]), "auto", 0.8),
    deco(k, q.path([[0.33, 0.45], [0.36, 0.45]]), "auto", 0.8),
    // Back clenched glove / fist
    deco(rDark, q.ellipse(0.33, 0.475, 0.016, 0.018), "auto", 1.8),
    deco(k, q.path([[0.32, 0.475], [0.345, 0.475]]), "auto", 1.0),

    // Front arm (right): red shoulder cap, red glove with chevron cuff
    deco(rDark, q.path([[0.64, 0.29], [0.67, 0.34], [0.63, 0.38]]), "auto", 1.4),
    deco(rDark, q.path([[0.58, 0.29], [0.59, 0.34], [0.61, 0.38]]), "auto", 1.2),
    // Chevron glove cuff
    deco(rDark, q.path([[0.60, 0.38], [0.625, 0.40], [0.65, 0.38]]), "auto", 1.6),
    // Red forearm / glove
    deco(rDark, q.path([[0.64, 0.39], [0.68, 0.43], [0.67, 0.46]]), "auto", 1.6),
    deco(rDark, q.path([[0.60, 0.40], [0.63, 0.43], [0.65, 0.45]]), "auto", 1.4),
    // Front glove web pattern
    deco(k, q.path([[0.62, 0.42], [0.66, 0.41]]), "auto", 0.8),
    deco(k, q.path([[0.63, 0.44], [0.66, 0.44]]), "auto", 0.8),
    // Wrist web-shooter trigger
    deco(k, q.ellipse(0.65, 0.445, 0.004, 0.004), "auto", 1.2),
    // Front hand in iconic web-shooter gesture / fist
    deco(rDark, q.ellipse(0.665, 0.46, 0.016, 0.018), "auto", 1.8),
    deco(rDark, q.path([[0.66, 0.47], [0.68, 0.49]]), "auto", 1.1),
    deco(rDark, q.path([[0.67, 0.47], [0.69, 0.48]]), "auto", 1.1),

    // ══════════════════════════════════════════════════════════════
    // 4. LEGS: Cobalt blue tights, high red boots with chevron tops
    // ══════════════════════════════════════════════════════════════
    // Cobalt blue thigh contours
    deco(b, q.path([[0.44, 0.56], [0.40, 0.64], [0.41, 0.73]]), "auto", 1.4),
    deco(bDark, q.path([[0.48, 0.58], [0.46, 0.65], [0.44, 0.73]]), "auto", 1.2),
    deco(b, q.path([[0.56, 0.56], [0.60, 0.64], [0.59, 0.73]]), "auto", 1.4),
    deco(bDark, q.path([[0.52, 0.58], [0.54, 0.65], [0.56, 0.73]]), "auto", 1.2),

    // Back leg: high red boot with sharp pointed V-top rim
    deco(rDark, q.path([[0.39, 0.75], [0.415, 0.73], [0.44, 0.75]]), "auto", 1.6),
    deco(rDark, q.path([[0.40, 0.75], [0.37, 0.83], [0.37, 0.91]]), "auto", 1.7),
    deco(rDark, q.path([[0.43, 0.75], [0.41, 0.83], [0.39, 0.91]]), "auto", 1.5),
    // Back boot web lines
    deco(k, q.path([[0.38, 0.78], [0.42, 0.79]]), "auto", 0.8),
    deco(k, q.path([[0.37, 0.83], [0.41, 0.84]]), "auto", 0.8),
    deco(k, q.path([[0.37, 0.88], [0.40, 0.88]]), "auto", 0.8),
    // Back boot foot & sole
    deco(rDark, q.path([[0.34, 0.93], [0.41, 0.93]]), "auto", 1.8),
    deco(rDark, q.path([[0.36, 0.90], [0.34, 0.93]]), "auto", 1.4),
    deco(rDark, q.path([[0.39, 0.91], [0.41, 0.93]]), "auto", 1.4),

    // Front leg: high red boot with sharp pointed V-top rim
    deco(rDark, q.path([[0.58, 0.75], [0.605, 0.73], [0.63, 0.75]]), "auto", 1.6),
    deco(rDark, q.path([[0.62, 0.75], [0.64, 0.83], [0.63, 0.91]]), "auto", 1.7),
    deco(rDark, q.path([[0.58, 0.75], [0.59, 0.83], [0.61, 0.91]]), "auto", 1.5),
    // Front boot web lines
    deco(k, q.path([[0.59, 0.78], [0.63, 0.79]]), "auto", 0.8),
    deco(k, q.path([[0.59, 0.83], [0.63, 0.84]]), "auto", 0.8),
    deco(k, q.path([[0.60, 0.88], [0.63, 0.88]]), "auto", 0.8),
    // Front boot foot & sole
    deco(rDark, q.path([[0.59, 0.93], [0.66, 0.93]]), "auto", 1.8),
    deco(rDark, q.path([[0.61, 0.90], [0.59, 0.93]]), "auto", 1.4),
    deco(rDark, q.path([[0.64, 0.91], [0.66, 0.93]]), "auto", 1.4),
  ];

  return [...read, ...D];
}

const SWORDSMAN_STANCE: Partial<Pose> = { armF: -0.22, elbowF: -1.45, lean: 0.04 };

export const ROSTER: RosterEntry[] = [
  { id: "kid", name: "Skinny kid", blurb: "quick on his feet, light hits", tier: 1, strokes: weigh(0.8, kid()) },
  { id: "dog", name: "Dog", blurb: "trots fast, savage Dog bite", tier: 1, strokes: dog(), signature: "bite" },
  { id: "boxer", name: "Boxer", blurb: "fast fists, a haymaker that hits huge", tier: 2, strokes: boxer(), signature: "haymaker" },
  { id: "karate", name: "Karate guy", blurb: "strong punch and kick, a flying kick", tier: 2, strokes: karate(), signature: "flykick" },
  { id: "ninja", name: "Ninja", blurb: "extra fast, springs back throwing blades", tier: 2, strokes: ninja(), signature: "blades", speedMult: 1.3 },
  { id: "swordsman", name: "Swordsman", blurb: "long reach, slices with the sword", tier: 2, strokes: swordsman(), stance: SWORDSMAN_STANCE, signature: "slash" },
  { id: "pehelwan", name: "Pehelwan", blurb: "sumo-wrestler bulk, a stomp that shakes the ground", tier: 3, strokes: pehelwan(), signature: "quake", hpMult: 1.45 },
  { id: "halloween", name: "Halloween", blurb: "pumpkin head, throws pumpkins", tier: 3, strokes: halloween(), signature: "pumpkin" },
  { id: "skeleton", name: "Skeleton", blurb: "falls to bits, snaps back next to you", tier: 3, strokes: skeleton(), signature: "bones" },
  { id: "bodybuilder", name: "Hulk", blurb: "hulking, huge arms, a leap that smashes for 50+", tier: 3, strokes: bodybuilder(), size: 1.38, signature: "leap", hpMult: 1.8 },
  { id: "phantom", name: "Phantom Delux", blurb: "gentleman thief, disappears in a flash", tier: 3, strokes: phantom(), signature: "phantom" },
  { id: "spiderman", name: "Spider-Man", blurb: "wall-crawler, webs you up for 3 seconds", tier: 3, strokes: spiderman(), signature: "web" },
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
