// A varied set of drawings (notebook coords 0..1, y down) used by headless + browser tests.
import type { InkStroke } from "@nf/shared";
type P = [number, number];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const S = (color: string, pts: P[], jitter = 0): InkStroke => ({ color, points: pts.map(([x, y]) => ({ x: x + rnd() * jitter, y: y + rnd() * jitter })) });
const circle = (cx: number, cy: number, rx: number, ry = rx * 1.05, n = 28, start = 0, turns = 1.04): P[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(start + (i / n) * 6.283 * turns) * rx, cy + Math.sin(start + (i / n) * 6.283 * turns) * ry]);
const spiral = (cx: number, cy: number, r: number, turns = 2, n = 50): P[] =>
  Array.from({ length: n + 1 }, (_, i) => { const t = i / n; const a = t * turns * 6.283; const rr = r * (0.35 + 0.65 * t); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; });
const line = (...p: P[]): P[] => {
  const out: P[] = [];
  for (let i = 0; i < p.length - 1; i++) for (let k = 0; k < 6; k++) out.push([p[i][0] + ((p[i + 1][0] - p[i][0]) * k) / 6, p[i][1] + ((p[i + 1][1] - p[i][1]) * k) / 6]);
  out.push(p[p.length - 1]);
  return out;
};
const INK = "#2a241c";

export type Drawing = { name: string; strokes: InkStroke[]; expect: Record<number, string>; plan: string };

export const DRAWINGS: Drawing[] = [
  {
    name: "clean",
    plan: "biped",
    strokes: [
      S(INK, circle(0.5, 0.2, 0.08)),
      S(INK, line([0.5, 0.29], [0.5, 0.6])),
      S(INK, line([0.5, 0.36], [0.62, 0.45], [0.7, 0.55])),
      S(INK, line([0.5, 0.36], [0.38, 0.45], [0.3, 0.55])),
      S(INK, line([0.5, 0.6], [0.43, 0.75], [0.4, 0.9])),
      S(INK, line([0.5, 0.6], [0.58, 0.75], [0.62, 0.9])),
    ],
    expect: { 0: "head", 1: "torso", 2: "armF", 3: "armB", 4: "legB", 5: "legF" },
  },
  {
    name: "sloppy",
    plan: "biped",
    strokes: [
      S("#2f7d4a", circle(0.46, 0.22, 0.1, 0.11, 30, 0.4, 1.15), 0.01), // head that overshoots its own start
      S("#2f7d4a", spiral(0.46, 0.22, 0.05), 0.004), // scribbled face
      S("#2f7d4a", line([0.47, 0.345], [0.48, 0.48], [0.46, 0.6], [0.38, 0.74], [0.33, 0.92]), 0.012), // body + leg in one go, gap under the head
      S("#2f7d4a", line([0.47, 0.62], [0.55, 0.76], [0.62, 0.92]), 0.012), // other leg, not quite touching
      S("#2f7d4a", line([0.2, 0.5], [0.33, 0.41], [0.46, 0.39], [0.6, 0.41], [0.74, 0.52]), 0.012), // both arms in one stroke
      S("#6d4ca8", line([0.38, 0.14], [0.4, 0.06], [0.44, 0.12], [0.47, 0.03], [0.5, 0.12], [0.54, 0.05], [0.56, 0.15]), 0.004), // hair
      S("#c23b32", line([0.45, 0.38], [0.36, 0.46], [0.3, 0.58], [0.27, 0.7]), 0.008), // cape
    ],
    expect: { 0: "head", 1: "head", 2: "torso", 3: "legF", 4: "armF", 5: "head", 6: "extra" },
  },
  {
    name: "fourArms",
    plan: "biped",
    strokes: [
      S(INK, circle(0.5, 0.17, 0.075)),
      S(INK, line([0.5, 0.25], [0.5, 0.6])),
      S(INK, line([0.5, 0.33], [0.63, 0.38], [0.74, 0.3])),
      S(INK, line([0.5, 0.33], [0.37, 0.38], [0.26, 0.3])),
      S(INK, line([0.5, 0.43], [0.63, 0.5], [0.72, 0.58])),
      S(INK, line([0.5, 0.43], [0.37, 0.5], [0.28, 0.58])),
      S(INK, line([0.5, 0.6], [0.43, 0.76], [0.4, 0.92])),
      S(INK, line([0.5, 0.6], [0.58, 0.76], [0.62, 0.92])),
    ],
    expect: { 0: "head", 1: "torso", 6: "legB", 7: "legF" },
  },
  {
    name: "quadruped",
    plan: "quadruped",
    strokes: [
      S("#8a5a32", circle(0.76, 0.36, 0.08)), // head on the right
      S("#8a5a32", line([0.69, 0.43], [0.5, 0.46], [0.27, 0.45])), // horizontal body (neck end first)
      S("#8a5a32", line([0.66, 0.44], [0.67, 0.58], [0.66, 0.72])), // front leg near
      S("#8a5a32", line([0.6, 0.45], [0.6, 0.59], [0.62, 0.72])), // front leg far
      S("#8a5a32", line([0.33, 0.45], [0.34, 0.59], [0.32, 0.72])), // hind leg near
      S("#8a5a32", line([0.28, 0.45], [0.27, 0.59], [0.26, 0.72])), // hind leg far
      S("#8a5a32", line([0.27, 0.45], [0.2, 0.38], [0.16, 0.28])), // tail up
      S("#8a5a32", line([0.72, 0.29], [0.7, 0.2], [0.76, 0.28])), // ear
    ],
    expect: { 0: "head", 1: "torso", 6: "extra", 7: "head" },
  },
  {
    name: "blob",
    plan: "blob",
    strokes: [
      S("#6d4ca8", circle(0.5, 0.45, 0.2, 0.22, 36), 0.01), // potato body
      S("#6d4ca8", circle(0.44, 0.38, 0.025, 0.025, 10)), // eye
      S("#6d4ca8", circle(0.56, 0.38, 0.025, 0.025, 10)), // eye
      S("#6d4ca8", line([0.7, 0.45], [0.8, 0.4], [0.88, 0.33])), // arm
      S("#6d4ca8", line([0.3, 0.45], [0.2, 0.42], [0.12, 0.35])), // arm
      S("#6d4ca8", line([0.43, 0.665], [0.42, 0.75], [0.4, 0.84])), // leg
      S("#6d4ca8", line([0.57, 0.665], [0.58, 0.75], [0.6, 0.84])), // leg
    ],
    expect: { 0: "torso" },
  },
  {
    name: "swordsman",
    plan: "biped",
    strokes: [
      S(INK, circle(0.45, 0.2, 0.075)),
      S(INK, line([0.45, 0.28], [0.45, 0.58])),
      S(INK, line([0.45, 0.35], [0.56, 0.43], [0.64, 0.38])), // sword arm
      S(INK, line([0.45, 0.35], [0.35, 0.43], [0.3, 0.5])),
      S(INK, line([0.45, 0.58], [0.39, 0.74], [0.36, 0.9])),
      S(INK, line([0.45, 0.58], [0.52, 0.74], [0.56, 0.9])),
      S("#1d4f89", line([0.64, 0.38], [0.74, 0.12])), // blade
      S("#c4962c", line([0.6, 0.35], [0.68, 0.41])), // cross-guard
      S("#c23b32", circle(0.27, 0.5, 0.06, 0.07, 20)), // round shield on the back hand
    ],
    expect: { 0: "head", 1: "torso", 2: "armF", 3: "armB", 6: "extra", 7: "extra", 8: "extra" },
  },
  {
    name: "plusSign",
    plan: "biped",
    strokes: [S(INK, line([0.5, 0.15], [0.5, 0.85])), S(INK, line([0.28, 0.4], [0.72, 0.4]))],
    expect: { 0: "torso", 1: "armF" },
  },
  {
    name: "loneCircle",
    plan: "blob",
    strokes: [S("#c23b32", circle(0.5, 0.5, 0.2, 0.2, 36), 0.006)],
    expect: { 0: "torso" },
  },
  {
    name: "tree",
    plan: "biped",
    strokes: [
      S("#2f7d4a", Array.from({ length: 49 }, (_, i) => { const a = (i / 48) * 6.283 * 1.03; const r = 0.19 + 0.025 * Math.sin(a * 7); return [0.5 + Math.cos(a) * r, 0.27 + Math.sin(a) * r * 0.85] as P; })), // bumpy canopy
      S("#7a4f2a", line([0.5, 0.43], [0.49, 0.62], [0.5, 0.86])), // trunk
      S("#7a4f2a", line([0.5, 0.62], [0.62, 0.55], [0.72, 0.5])), // branch
      S("#7a4f2a", line([0.5, 0.66], [0.39, 0.6], [0.3, 0.56])), // branch
      S("#7a4f2a", line([0.5, 0.86], [0.43, 0.92])), // root
      S("#7a4f2a", line([0.5, 0.86], [0.58, 0.92])), // root
    ],
    expect: { 0: "head", 1: "torso" },
  },
  {
    name: "car",
    plan: "vehicle",
    strokes: [
      S("#c23b32", line([0.18, 0.62], [0.82, 0.62], [0.83, 0.5], [0.66, 0.48], [0.58, 0.37], [0.38, 0.37], [0.31, 0.48], [0.18, 0.5], [0.18, 0.62])), // body
      S(INK, circle(0.32, 0.64, 0.065, 0.065, 24)), // rear wheel
      S(INK, circle(0.68, 0.64, 0.065, 0.065, 24)), // front wheel
      S("#1d4f89", line([0.4, 0.47], [0.42, 0.4], [0.55, 0.4], [0.6, 0.47], [0.4, 0.47])), // window
    ],
    expect: { 0: "torso", 1: "torso", 2: "torso" },
  },
  {
    name: "snake",
    plan: "serpent",
    strokes: [
      S("#2f7d4a", Array.from({ length: 61 }, (_, i) => { const t = i / 60; return [0.1 + t * 0.72, 0.6 - Math.sin(t * 6.283 * 2) * 0.05 * (0.4 + t * 0.6)] as P; }), 0.003), // long squiggle body
      S("#2f7d4a", circle(0.86, 0.6, 0.045, 0.04, 20)), // head at the right end
      S("#c23b32", line([0.9, 0.61], [0.95, 0.62], [0.97, 0.6])), // tongue
    ],
    expect: { 0: "torso", 1: "head" },
  },
  {
    name: "bigHead",
    plan: "biped",
    strokes: [
      S(INK, circle(0.5, 0.31, 0.22, 0.21, 40), 0.004), // huge head
      S(INK, spiral(0.5, 0.31, 0.04, 1.5, 24)), // nose
      S(INK, line([0.5, 0.52], [0.5, 0.68])), // tiny body
      S(INK, line([0.5, 0.56], [0.58, 0.6], [0.63, 0.57])),
      S(INK, line([0.5, 0.56], [0.42, 0.6], [0.37, 0.57])),
      S(INK, line([0.5, 0.68], [0.47, 0.74], [0.46, 0.79])), // tiny legs
      S(INK, line([0.5, 0.68], [0.53, 0.74], [0.55, 0.79])),
    ],
    expect: { 0: "head", 2: "torso" },
  },
];

// the same car drawn facing left (bonnet on the left): it must turn round to face its foe
DRAWINGS.push({ ...DRAWINGS.find((d) => d.name === "car")!, name: "carLeft", strokes: DRAWINGS.find((d) => d.name === "car")!.strokes.map((st) => ({ ...st, points: st.points.map((q) => ({ x: 1 - q.x, y: q.y })) })) });

// the clean stick man drawn over again in places (darker parts are stronger)
const clean: InkStroke[] = DRAWINGS[0].strokes; // head, body, armF, armB, legB, legF
let s3 = 3;
const r = () => ((s3 = (s3 * 16807) % 2147483647) / 2147483647 - 0.5) * 0.012;
const again = (k: number, n: number): InkStroke[] => Array.from({ length: n }, () => ({ color: clean[k].color, points: clean[k].points.map((p) => ({ x: p.x + r(), y: p.y + r() })) }));
/** one stroke scribbling back and forth along part k */
const scrub = (k: number, reps: number): InkStroke => {
  const P = clean[k].points;
  const pts = [];
  for (let i = 0; i < reps; i++) for (const p of i % 2 ? [...P].reverse() : P) pts.push({ x: p.x + r(), y: p.y + r() });
  return { color: clean[k].color, points: pts };
};
export const SCRIBBLED: Record<string, InkStroke[]> = {
  darkRightArm: [...clean, ...again(2, 3)],
  scrubbedArm: [...clean, scrub(2, 4)],
  darkHead: [...clean, ...again(0, 3)],
  darkLegs: [...clean, ...again(4, 2), ...again(5, 2)],
  darkEverything: [...clean, ...[0, 1, 2, 3, 4, 5].flatMap((k) => again(k, 6))],
};

// the clean stick man with one add-on doodle each (powers); graphite variants are read by shape alone
import { powerDoodle, type PowerKind } from "../src/powers";
const handF = { x: 0.7, y: 0.55 };
const handB = { x: 0.3, y: 0.55 };
const recolor = (st: InkStroke[], color: string) => st.map((x) => ({ ...x, color }));
export const POWERED: Record<string, { strokes: InkStroke[]; expect: PowerKind }> = {
  fire: { strokes: [...clean, ...powerDoodle("fire", handF, handF)], expect: "fire" },
  water: { strokes: [...clean, ...powerDoodle("water", handF, handF)], expect: "water" },
  lightning: { strokes: [...clean, ...powerDoodle("lightning", handF, handF)], expect: "lightning" },
  ice: { strokes: [...clean, ...powerDoodle("ice", handF, handF)], expect: "ice" },
  wings: { strokes: [...clean, ...powerDoodle("wings", handF, { x: 0.49, y: 0.33 })], expect: "wings" },
  shield: { strokes: [...clean, ...powerDoodle("shield", handB, handB)], expect: "shield" },
  spikes: { strokes: [...clean, ...powerDoodle("spikes", handF, { x: 0.49, y: 0.4 })], expect: "spikes" },
  boltGraphite: { strokes: [...clean, ...recolor(powerDoodle("lightning", handF, handF), INK)], expect: "lightning" },
  flameGraphite: { strokes: [...clean, ...recolor(powerDoodle("fire", handF, handF), INK)], expect: "fire" },
  dropsGraphite: { strokes: [...clean, ...recolor(powerDoodle("water", handF, handF), INK)], expect: "water" },
  waveBlue: { strokes: [...clean, S("#1d4f89", Array.from({ length: 25 }, (_, i) => [0.72 + i * 0.008, 0.46 + Math.sin(i / 2) * 0.025] as P))], expect: "water" },
};
