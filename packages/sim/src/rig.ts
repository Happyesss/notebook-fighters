/**
 * Rig: turns ANY drawing into an animatable fighter.
 *
 * Reader (inferRig):
 *  1. measure every stroke (loop? round? size, arc length) and the connection graph between strokes
 *  2. head  = roundest closed loop (a hat / triangle loses on roundness), unless that loop is really a
 *             blob body with limbs hanging off it
 *  3. body  = the best-connected long stroke (or the blob loop); its chest end faces the head
 *             – a body line that runs on into a leg is split at the hip
 *             – a horizontal body ⇒ quadruped plan (front legs trot with the diagonal hind legs)
 *  4. limbs = strokes attached to the body: near the chest ⇒ arms, near the hips & pointing down ⇒ legs.
 *             One primary per side; every extra limb becomes a follower chain that copies its source
 *             limb's motion (4 arms all swing, a centipede's legs all step).
 *  5. head add-ons (hair, ears, faces, hats) ride the head; tails/capes ride the body; props
 *     (swords, shields) ride the bone they touch.
 *  Missing parts get invisible bones so the fighter still moves sensibly.
 *
 * Skinning: every resampled stroke point is stored in 1–2 bone frames (blended at elbows/knees,
 * plan §7.2) and re-placed from the animated joints each frame: the drawn lines are what moves.
 *
 * Figure space: x forward (fighter faces +x), y up, feet ≈ 0, height ≈ 1.
 */
import type { InkStroke, Pt } from "@nf/shared";
import { hueOf, shapeOf, type PowerKind, type ShapeInfo } from "./powers";

export const JOINTS = ["pelvis", "chest", "crown", "elbowB", "handB", "elbowF", "handF", "kneeB", "footB", "kneeF", "footF", "shB", "shF", "hipB", "hipF"] as const;
export type JointName = (typeof JOINTS)[number];
export const J: Record<JointName, number> = Object.fromEntries(JOINTS.map((n, i) => [n, i])) as Record<JointName, number>;
export type Joints = Pt[];

/** bone = [from joint, to joint] */
export const BONES: readonly [number, number][] = [
  [J.pelvis, J.chest], // 0 torso
  [J.chest, J.crown], // 1 head (neck → crown)
  [J.shB, J.elbowB], // 2 upper arm back
  [J.elbowB, J.handB], // 3 forearm back
  [J.shF, J.elbowF], // 4 upper arm front
  [J.elbowF, J.handF], // 5 forearm front
  [J.hipB, J.kneeB], // 6 thigh back
  [J.kneeB, J.footB], // 7 shin back
  [J.hipF, J.kneeF], // 8 thigh front
  [J.kneeF, J.footF], // 9 shin front
];
export const BONE_NAMES = ["torso", "head", "upperArmB", "foreArmB", "upperArmF", "foreArmF", "thighB", "shinB", "thighF", "shinF"];
const CHILD_OF: Record<number, number> = { 3: 2, 5: 4, 7: 6, 9: 8 };

export type Limb = "armF" | "armB" | "legF" | "legB";
export type Part = "head" | "torso" | Limb | "aux" | "extra";
export type Plan = "biped" | "quadruped" | "blob" | "serpent" | "vehicle";
/** how the drawing gets around */
export type Gait = "walk" | "trot" | "hop" | "bounce" | "slither" | "roll";

export type SkinPoint = { b0: number; t0: number; o0: number; b1: number; t1: number; o1: number; w: number };
export type SkinStroke = { color: string; part: Part; width: number; points: SkinPoint[]; label: string; dangle?: { anchor: number; length: number }; /** wheels spin about this bound centre */ spin?: SkinPoint };

/** per-frame shape changes on top of the skeleton: tail sway, wheel spin, body wave, squash & stretch */
export type Deform = { sway?: number; spin?: number; wavePhase?: number; waveAmp?: number; sx?: number; sy?: number };

/** an extra limb: its own drawn chain that copies the motion of a source limb */
export type AuxChain = { src: Limb; root: { t: number; o: number }; bind: [Pt, Pt, Pt]; label: string };

export type RigShape = {
  torso: number;
  head: number;
  headRadius: number;
  upperArmF: number;
  foreArmF: number;
  upperArmB: number;
  foreArmB: number;
  thighF: number;
  shinF: number;
  thighB: number;
  shinB: number;
  /** where each limb meets the body, in the torso frame (t along pelvis→chest, o perpendicular) */
  roots: Record<Limb, { t: number; o: number }>;
  /** drawn body angle kept by the animation (quadrupeds keep a horizontal body) */
  leanOffset: number;
  /** how much of a move's body lean is applied (quadrupeds pitch less) */
  leanScale: number;
  headOffset: number;
};

export type Rig = {
  shape: RigShape;
  bind: Joints;
  plan: Plan;
  mirrored: boolean;
  headCenter: { t: number; o: number };
  strokes: SkinStroke[];
  aux: AuxChain[];
  found: Record<"head" | "torso" | Limb, boolean>;
  extras: number;
  /** joints used as the striking point for punch / kick (headbutt when there are no arms) */
  strike: { punch: number; kick: number };
  /** human-readable list of what the reader decided, for the UI and tests */
  parts: string[];
  /** how far the drawn body (head/torso ink) reaches in front of / behind the hips */
  extent: { front: number; back: number };
  gait: Gait;
  /** a drawn weapon held in a hand: the arm that swings it and the stroke indices */
  weapon: { limb: "armF" | "armB"; strokes: number[]; length: number } | null;
  /** stroke indices of tails (they whip) */
  tail: number[];
  wheelR: number;
  /** what the reader thinks it is, in words */
  kind: string;
  /** body centre along the facing axis (turns and squashes pivot here) */
  pivotX: number;
  /** per stroke: the index of the stroke it goes over again (scribbled darker), or -1 for an original line */
  over: number[];
  /** how well the head's outline closes (1 = a neat closed circle, 0 = no head / wide open) */
  headClosure: number;
  /** powers read from add-on doodles: the kind, its strokes, and the bone it rides on */
  powers: { kind: PowerKind; strokes: number[]; bone: number }[];
  /** costume strokes (indices) that are solid body: a hulk's chest gets hit, not just its stick spine */
  solid?: number[];
};

// ---------------------------------------------------------------- geometry
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function project(p: Pt, a: Pt, b: Pt) {
  const v = sub(b, a);
  const L = len(v) || 1e-6;
  const d = { x: v.x / L, y: v.y / L };
  const w = sub(p, a);
  return { t: (w.x * d.x + w.y * d.y) / L, o: -d.y * w.x + d.x * w.y, L };
}
function segDist(p: Pt, a: Pt, b: Pt) {
  const { t, o } = project(p, a, b);
  if (t < 0) return dist(p, a);
  if (t > 1) return dist(p, b);
  return Math.abs(o);
}
function polyNearest(p: Pt, pts: Pt[]) {
  let d = Infinity;
  let i = 0;
  for (let k = 0; k < pts.length; k++) {
    const e = dist(p, pts[k]);
    if (e < d) {
      d = e;
      i = k;
    }
  }
  return { d, i };
}
function arc(pts: Pt[]) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Resample a polyline to roughly uniform spacing so straight strokes can bend at joints. */
export function resample(points: Pt[], step: number): Pt[] {
  if (points.length < 2) return points.slice();
  const out: Pt[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = dist(a, b);
    if (seg < 1e-9) continue;
    let d = step - carry;
    while (d <= seg) {
      out.push({ x: a.x + ((b.x - a.x) * d) / seg, y: a.y + ((b.y - a.y) * d) / seg });
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = points[points.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.25) out.push(last);
  return out;
}

function boundsOf(pts: Pt[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function turning(points: Pt[]) {
  let total = 0;
  for (let i = 2; i < points.length; i++) {
    const a = Math.atan2(points[i - 1].y - points[i - 2].y, points[i - 1].x - points[i - 2].x);
    const b = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    total += d;
  }
  return Math.abs(total);
}

// ---------------------------------------------------------------- reading the drawing
type Work = {
  w?: number;
  idx: number;
  color: string;
  pts: Pt[];
  part: Part;
  loop: boolean;
  cv: number; // radius variation (0 = perfect circle)
  size: number;
  arc: number;
  center: Pt;
  split?: boolean;
  aux?: number;
  bone?: number; // rigid bone for extras
  label: string;
};

const ATTACH = 0.06;
/** how close (figure heights) a second pass must stay to count as going over the same line */
const OVERDRAW = 0.035;

/** Read a drawing (notebook coords 0..1, y down) and fit a skeleton to it. null when there is no ink. */
export function inferRig(strokes: InkStroke[], mirror = false): Rig | null {
  const ink = strokes.filter((s) => s.points.length > 1 && !s.deco);
  if (ink.length === 0) return null;
  const decos = strokes.filter((s) => s.points.length > 1 && s.deco);
  const all = ink.flatMap((s) => s.points);
  const box = boundsOf(all);
  const H = Math.max(box.h, box.w * 0.55, 0.04);
  const toFig = (p: Pt): Pt => ({ x: ((mirror ? box.maxX - p.x : p.x - box.minX) / H), y: (box.maxY - p.y) / H });
  const allWork: Work[] = ink.map((s, idx) => {
    const pts = resample(s.points.map(toFig), 0.012);
    const b = boundsOf(pts);
    const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const ends = dist(pts[0], pts[pts.length - 1]);
    const diag = Math.hypot(b.w, b.h) || 1e-6;
    const loop = pts.length >= 6 && (ends < diag * 0.45 || turning(pts) > 4.2) && Math.min(b.w, b.h) > 0.03;
    const radii = pts.map((p) => dist(p, center));
    const mean = radii.reduce((a, r) => a + r, 0) / radii.length;
    const cv = Math.sqrt(radii.reduce((a, r) => a + (r - mean) ** 2, 0) / radii.length) / Math.max(mean, 1e-6);
    return { idx, color: s.color, w: s.w, pts, part: "extra" as Part, loop, cv, size: Math.max(b.w, b.h), arc: arc(pts), center, label: "" };
  });

  // --- overdraw: going back over a part (scribbling it darker) reinforces that part; it is not a new limb.
  // A stroke whose ink lies (almost) entirely along an earlier, longer stroke is folded into it.
  const over = new Map<Work, Work>();
  {
    const kept: Work[] = [];
    for (const s of [...allWork].sort((a, b) => b.arc - a.arc || a.idx - b.idx)) {
      const base = kept.find((b) => b.arc > s.arc * 0.45 && s.pts.filter((p) => polyNearest(p, b.pts).d < OVERDRAW).length >= s.pts.length * 0.8);
      if (base) over.set(s, base);
      else kept.push(s);
    }
  }
  let work = allWork.filter((s) => !over.has(s));

  // --- add-on doodles: the shape of every stroke (zigzag, bolt, wave, droplet …) for the power reader
  const shapes = new Map<Work, ShapeInfo>();
  for (const s of allWork) {
    const ends = dist(s.pts[0], s.pts[s.pts.length - 1]);
    const closedish = s.pts.length >= 6 && ends < Math.max(s.size * 0.35, 0.02);
    shapes.set(s, shapeOf(s.pts, s.loop || closedish));
  }
  const doodle = (s: Work) => {
    const sh = shapes.get(s)!.shape;
    return sh === "zigzag" || sh === "bolt" || sh === "wave";
  };

  // --- connection graph: an endpoint of one stroke touching another stroke (or two strokes crossing)
  const touch = (a: Work, b: Work) => {
    let best = Infinity;
    for (const e of [a.pts[0], a.pts[a.pts.length - 1]]) best = Math.min(best, polyNearest(e, b.pts).d);
    return best;
  };
  const crosses = (a: Work, b: Work) => a.pts.some((p) => polyNearest(p, b.pts).d < 0.022);
  const connected = (a: Work, b: Work) => touch(a, b) < ATTACH || touch(b, a) < ATTACH || crosses(a, b);
  const degree = (s: Work, pool: Work[]) => pool.filter((o) => o !== s && connected(s, o)).length;

  // loops drawn inside a bigger loop are features (eyes, buttons, a face on a blob)
  const container = (s: Work) =>
    work.find((o) => o !== s && o.loop && o.size > s.size * 1.8 && s.pts.every((p) => {
      const b = boundsOf(o.pts);
      return p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY;
    })) ?? null;
  const inner = new Set(work.filter((s) => container(s)));

  // a line hanging from the bottom of a loop that carries limbs of its own = a body under a (big) head
  const hangsBelow = (h: Work) =>
    work.some((o) => {
      if (o === h || o.loop || inner.has(o)) return false;
      const top = o.pts[0].y > o.pts[o.pts.length - 1].y ? o.pts[0] : o.pts[o.pts.length - 1];
      const bottom = top === o.pts[0] ? o.pts[o.pts.length - 1] : o.pts[0];
      const hb = boundsOf(h.pts);
      return polyNearest(top, h.pts).d < ATTACH && top.y < h.center.y && bottom.y < hb.minY - 0.04 && Math.abs(bottom.x - h.center.x) < h.size * 0.5 && degree(o, work) >= 3;
    });

  // --- wheels: two round loops side by side at the very bottom, under a wide body ⇒ a vehicle
  let wheels: Work[] = [];
  let chassis: Work | null = null;
  {
    const rounds = work.filter((s) => s.loop && s.cv < 0.16 && s.center.y - s.size / 2 < 0.1 && !inner.has(s));
    for (let a = 0; a < rounds.length && !chassis; a++)
      for (let b = a + 1; b < rounds.length && !chassis; b++) {
        const A = rounds[a];
        const B = rounds[b];
        const ratio = Math.max(A.size, B.size) / Math.min(A.size, B.size);
        if (ratio > 1.6 || Math.abs(A.center.y - B.center.y) > 0.08 || Math.abs(A.center.x - B.center.x) < Math.max(A.size, B.size) * 1.3) continue;
        const lo = Math.min(A.center.x, B.center.x);
        const hi = Math.max(A.center.x, B.center.x);
        const c = work
          .filter((o) => o !== A && o !== B && !inner.has(o))
          .map((o) => ({ o, b: boundsOf(o.pts) }))
          .filter(({ o, b }) => b.w > b.h * 1.25 && b.minX < lo + 0.02 && b.maxX > hi - 0.02 && o.center.y > A.center.y && (connected(o, A) || connected(o, B) || b.minY < Math.max(A.center.y, B.center.y) + A.size))
          .sort((x, y) => y.o.arc - x.o.arc)[0];
        if (c) {
          chassis = c.o;
          wheels = [A, B].sort((x, y) => x.center.x - y.center.x);
        }
      }
  }

  // a car faces away from its cabin: the bonnet is the longer low end. The cabin (the upper part of
  // the outline, and any windows) sits right of centre ⇒ it was drawn facing left: mirror it to face +x
  if (chassis && !mirror) {
    const cb = boundsOf(chassis.pts);
    const mid = cb.minX + cb.w / 2;
    const upper = boundsOf(chassis.pts.filter((p) => p.y > cb.minY + cb.h * 0.6));
    const wins = work.filter((o) => inner.has(o) && o.center.x > cb.minX && o.center.x < cb.maxX).map((o) => boundsOf(o.pts));
    const cabs = [upper, ...wins].filter((b) => Number.isFinite(b.minX)).map((b) => b.minX + b.w / 2);
    const cab = cabs.length ? cabs.reduce((t, v) => t + v, 0) / cabs.length : mid;
    if (cab - mid > cb.w * 0.015) return inferRig(strokes, true);
  }

  // --- head: roundest reasonably-sized closed loop
  let head: Work | null = null;
  let headScore = -Infinity;
  for (const s of work) {
    if (!s.loop || s.size > 0.9 || s.size < 0.05 || inner.has(s) || wheels.includes(s) || shapes.get(s)!.shape === "zigzag") continue;
    const below = work.some((o) => o !== s && o.pts.some((p) => Math.abs(p.x - s.center.x) < s.size && p.y < s.center.y - s.size * 0.45 && p.y > s.center.y - s.size * 0.5 - 0.15));
    if (s.size > 0.62 && !hangsBelow(s)) continue;
    const score = s.size * (1 - 2.8 * s.cv) + (below ? 0.2 : 0) + s.center.y * 0.1;
    if (score > headScore) {
      headScore = score;
      head = s;
    }
  }

  // --- body: the best connected long stroke (excluding the head)
  const vertical = (s: Work) => {
    const v = sub(s.pts[s.pts.length - 1], s.pts[0]);
    return s.loop ? 0 : Math.abs(v.y) / (len(v) || 1);
  };
  const bodyScore = (s: Work) => degree(s, work) * 0.6 + Math.min(s.arc, 1.2) + (s.loop && s.size > 0.25 ? 0.4 : 0) + vertical(s) * 0.15;
  let body: Work | null = chassis;
  if (chassis) head = null;
  if (!chassis) for (const s of work) {
    if (s === head || inner.has(s) || (doodle(s) && work.length > 3)) continue;
    // strokes fully inside the head are faces, never bodies
    if (head && s.pts.every((p) => dist(p, head!.center) < head!.size * 0.6)) continue;
    if (!body || bodyScore(s) > bodyScore(body)) body = s;
  }
  // a big "head" with many limbs and a weak body candidate is really a blob body
  if (head && (!body || (degree(head, work) >= 3 && head.size > 0.3 && !hangsBelow(head) && (!body || degree(body, work) <= 1 || body.arc < head.size * 0.8)))) {
    body = head;
    head = null;
  }
  if (!body) {
    body = head!;
    head = null;
  }
  // a cross (+): stand it on its upright line, the crossbar is the arms
  if (!head && !body.loop && !chassis) {
    const b0 = body;
    const upright = work.find((c) => c !== b0 && !c.loop && crosses(b0, c) && vertical(c) > vertical(b0) + 0.4 && c.arc > b0.arc * 0.5);
    if (upright) body = upright;
  }
  body.part = "torso";
  if (head) head.part = "head";

  // head add-ons: faces inside the head, hair/ears/antennae/hats touching it from above or the side
  let headC: Pt;
  let headR: number;
  let headGap = 9;
  if (head) {
    const b = boundsOf(head.pts);
    headC = head.center;
    headR = Math.max(0.035, (b.w + b.h) / 4);
    headGap = dist(head.pts[0], head.pts[head.pts.length - 1]) / Math.max(0.02, (b.w + b.h) / 2);
  } else headR = 0;

  // --- body axis: chest end / pelvis end
  let chest: Pt;
  let pelvis: Pt;
  let torsoLeg: Pt[] = [];
  if (!body.loop) {
    const e0 = body.pts[0];
    const e1 = body.pts[body.pts.length - 1];
    let chestFirst: boolean;
    if (head) chestFirst = dist(e0, headC!) <= dist(e1, headC!);
    else chestFirst = e0.y > e1.y + 0.05 || (Math.abs(e0.y - e1.y) <= 0.05 && e0.x >= e1.x);
    const pts = chestFirst ? body.pts : [...body.pts].reverse();
    body.pts = pts;
    chest = pts[0];
    pelvis = pts[pts.length - 1];
    // where do other strokes attach along the body?
    const total = body.arc || 1e-6;
    const sAt: number[] = [0];
    for (let i = 1; i < pts.length; i++) sAt.push(sAt[i - 1] + dist(pts[i - 1], pts[i]));
    const attach: { i: number; s: number }[] = [];
    for (const o of work) {
      if (o === body || o === head) continue;
      for (const e of [o.pts[0], o.pts[o.pts.length - 1]]) {
        const n = polyNearest(e, pts);
        if (n.d < ATTACH) attach.push({ i: n.i, s: sAt[n.i] / total });
      }
    }
    // body line runs on into a leg: split at the lowest attachment (legs start there) or at the sharpest corner
    const lower = attach.filter((a) => a.s > 0.35 && a.s < 0.88);
    let hipI = -1;
    const remainderDown = (i: number) => {
      const rest = pts.slice(i);
      return arc(rest) > 0.14 && pts[pts.length - 1].y < pts[i].y - 0.1 && pts[pts.length - 1].y < 0.12;
    };
    // things growing out of the bottom end (roots, feet) mean the body line ends at the hips
    const endAttached = attach.some((a) => a.s > 0.9);
    if (endAttached) {
      /* no split */
    } else if (lower.length) {
      const cand = lower.reduce((a, b) => (b.s > a.s ? b : a));
      if (remainderDown(cand.i)) hipI = cand.i;
    }
    if (hipI < 0 && !endAttached) {
      let sharp = 0.55;
      for (let i = 3; i < pts.length - 3; i++) {
        const s = sAt[i] / total;
        if (s < 0.35 || s > 0.85) continue;
        const a = sub(pts[i], pts[i - 3]);
        const b = sub(pts[i + 3], pts[i]);
        let turn = Math.abs(Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x));
        if (turn > Math.PI) turn = Math.PI * 2 - turn;
        if (turn > sharp && remainderDown(i)) {
          sharp = turn;
          hipI = i;
        }
      }
    }
    if (hipI > 0) {
      pelvis = pts[hipI];
      torsoLeg = pts.slice(hipI + 1);
    }
  } else {
    // blob / oval body: principal axis
    const pts = body.pts;
    const m = body.center;
    let sxx = 0,
      syy = 0,
      sxy = 0;
    for (const p of pts) {
      sxx += (p.x - m.x) ** 2;
      syy += (p.y - m.y) ** 2;
      sxy += (p.x - m.x) * (p.y - m.y);
    }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let u = { x: Math.cos(ang), y: Math.sin(ang) };
    const l1 = (sxx + syy) / 2 + Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
    const l2 = (sxx + syy) / 2 - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
    if (l2 / Math.max(l1, 1e-9) > 0.55) u = { x: 0, y: 1 }; // roundish blob: stand it up
    const along = (p: Pt) => (p.x - m.x) * u.x + (p.y - m.y) * u.y;
    let hi = pts[0];
    let lo = pts[0];
    for (const p of pts) {
      if (along(p) > along(hi)) hi = p;
      if (along(p) < along(lo)) lo = p;
    }
    let chestIsHi: boolean;
    if (head) chestIsHi = dist(hi, headC!) < dist(lo, headC!);
    else chestIsHi = Math.abs(u.y) >= Math.abs(u.x) ? hi.y >= lo.y : hi.x >= lo.x;
    // pull the ends slightly inside the outline so the body bone sits in the middle of the blob
    chest = chestIsHi ? hi : lo;
    pelvis = chestIsHi ? lo : hi;
    chest = add(chest, mul(sub(m, chest), 0.15));
    pelvis = add(pelvis, mul(sub(m, pelvis), 0.15));
  }
  if (!head) {
    // invisible head on the chest end
    headR = 0.06;
    const up = sub(chest, pelvis);
    const L = len(up) || 1;
    headC = add(chest, mul(up, (headR * 1.2) / L));
  }

  // --- plan
  const axis = sub(chest, pelvis);
  const axisAngle = Math.atan2(axis.x, axis.y); // from vertical, + = toward +x
  let plan: Plan = body.loop && !head ? "blob" : "biped";
  if (Math.abs(axisAngle) > 0.95 && Math.abs(axisAngle) < Math.PI - 0.6) plan = "quadruped";
  if (chassis) {
    // the axle line is the body bone: rear wheel → front wheel
    plan = "vehicle";
    pelvis = wheels[0].center;
    chest = wheels[1].center;
    headR = 0.04;
    headC = add(chest, { x: 0.08, y: 0.04 });
  }
  // quadrupeds face where their head (chest end) is: mirror so it faces +x
  if (plan === "quadruped" && axis.x < 0 && !mirror) return inferRig(strokes, true);

  // --- classify every remaining stroke
  const torsoT = (p: Pt) => Math.max(-0.2, Math.min(1.2, project(p, pelvis, chest).t)); // 0 hips … 1 chest
  type Cand = { s: Work; kind: "arm" | "leg"; side: "F" | "B"; reach: number; attach: Pt; split: boolean; steep?: boolean };
  const cands: Cand[] = [];
  // powers: little doodles around the fighter (see powers.ts). A snowflake is three short lines crossing.
  const asterisk = new Set<Work>();
  {
    const free = (a: Work) => a !== body && a !== head && a.part === "extra" && touch(a, body) >= ATTACH && touch(body, a) >= ATTACH && !crosses(a, body);
    const lines = work.filter((a) => free(a) && shapes.get(a)!.shape === "line" && a.size < 0.2);
    for (const a of lines) {
      const xs = lines.filter((b) => b !== a && crosses(a, b));
      if (xs.length >= 2) [a, ...xs].forEach((x) => asterisk.add(x));
    }
  }
  const powerOf = (s: Work): PowerKind | null => {
    if (s === body || s === head || wheels.includes(s) || s === chassis) return null;
    if (asterisk.has(s)) return "ice";
    const sh = shapes.get(s)!;
    const hue = hueOf(s.color);
    const inHead = !!head && s.pts.filter((p) => dist(p, headC!) < headR * 1.15).length > s.pts.length * 0.6;
    const onHead = !!head && !inHead && Math.min(touch(s, head), polyNearest(s.center, head.pts).d) < ATTACH * 1.2;
    if (inner.has(s) || inHead) return null; // eyes, mouths, buttons
    switch (sh.shape) {
      case "bolt":
        return sh.size > 0.08 ? "lightning" : null;
      case "zigzag": {
        if (sh.size < 0.05) return null;
        if (hue === "warm") return "fire";
        if (hue === "gold") return "lightning";
        if (hue === "cool") return "ice";
        if (onHead) return null; // spiky hair
        const hugs = s.pts.filter((p) => polyNearest(p, body.pts).d < 0.08).length > s.pts.length * 0.6;
        return hugs ? "spikes" : "fire";
      }
      case "wave":
        if (hue === "cool") return "water";
        if (onHead) return null; // wavy hair
        return hue === "warm" ? "fire" : "water";
      case "drop": {
        if (hue === "warm") return "fire";
        if (hue === "gold") return "lightning";
        if (onHead) return null;
        // a lone graphite dot could be anything; two or more droplets (or a blue one) are water
        const friends = work.filter((o) => o !== s && o.part === "extra" && shapes.get(o)!.shape === "drop" && dist(o.center, s.center) < 0.2).length;
        return hue === "cool" || friends >= 1 ? "water" : null;
      }
    }
    // wings: a loop (or a big sweeping curve) growing from the upper back
    if ((plan === "biped" || plan === "quadruped") && (sh.shape === "loop" || (sh.turning > 2.4 && s.size >= 0.15))) {
      const e = [s.pts[0], s.pts[s.pts.length - 1]].reduce((a, p) => (polyNearest(p, body.pts).d < polyNearest(a, body.pts).d ? p : a));
      const attached = polyNearest(e, body.pts).d < ATTACH || crosses(s, body);
      const t = torsoT(e);
      if (attached && s.size >= 0.1 && t >= 0.45 && s.center.y >= e.y - 0.06) return "wings";
    }
    return null;
  }
  for (const s of work) {
    if (s.part !== "extra") continue;
    const pw = powerOf(s);
    if (pw) {
      s.label = `power:${pw}`;
      continue;
    }
    if (plan === "vehicle") {
      s.part = "torso";
      s.label = wheels.includes(s) ? "wheel" : inner.has(s) ? "window" : "body add-on";
      continue;
    }
    if (inner.has(s) && container(s) === body) {
      s.label = "face / body detail";
      s.bone = plan === "blob" ? 0 : 0;
      continue;
    }
    // inside / on the head: faces, eyes, hair, ears, antennae, hats
    if (head) {
      const inside = s.pts.filter((p) => dist(p, headC!) < headR * 1.15).length / s.pts.length;
      const nearHead = Math.min(touch(s, head), polyNearest(s.center, head.pts).d);
      const nearBody = touch(s, body);
      if (inside > 0.6 || (nearHead < ATTACH && nearHead < nearBody && s.center.y > headC!.y - headR * 0.6) || (s.center.y > headC!.y && dist(s.center, headC!) < headR * 2.6 && nearBody > ATTACH)) {
        s.part = "head";
        s.label = inside > 0.6 ? "face" : "head add-on";
        continue;
      }
    }
    // attachment to the body (endpoint touching, or crossing it)
    const e0 = s.pts[0];
    const e1 = s.pts[s.pts.length - 1];
    const n0 = polyNearest(e0, body.pts);
    const n1 = polyNearest(e1, body.pts);
    const crossing = crosses(s, body);
    if (Math.min(n0.d, n1.d) >= ATTACH && !crossing) continue; // free-floating or held prop → extra
    const attachEnd = n0.d <= n1.d ? e0 : e1;
    const far = s.pts.reduce((a, p) => (dist(p, attachEnd) > dist(a, attachEnd) ? p : a), s.pts[0]);
    const v = sub(far, attachEnd);
    const down = v.y < -0.45 * len(v);
    const t = torsoT(attachEnd);
    const sideOf = (p: Pt, anchor: Pt): "F" | "B" => (p.x >= anchor.x ? "F" : "B");
    // a stroke crossing the upper body with ink on both sides = both arms in one line
    if (crossing && Math.min(n0.d, n1.d) >= ATTACH) {
      const cross = s.pts.reduce((a, p) => (polyNearest(p, body.pts).d < polyNearest(a, body.pts).d ? p : a), s.pts[0]);
      const ct = torsoT(cross);
      const f = s.pts.filter((p) => p.x >= cross.x).length;
      const bal = Math.min(f, s.pts.length - f) / s.pts.length;
      if (bal > 0.2) {
        const reach = Math.max(...s.pts.map((p) => dist(p, cross)));
        cands.push({ s, kind: ct > 0.45 || plan === "quadruped" ? "arm" : "leg", side: "F", reach, attach: cross, split: true });
        continue;
      }
    }
    if (plan === "quadruped") {
      // legs hang down; front legs attach toward the chest end
      if (down) cands.push({ s, kind: t < 0.5 ? "leg" : "arm", side: "F", reach: len(v), attach: attachEnd, split: false });
      else {
        s.label = t < 0.4 ? "tail" : "body add-on";
        s.bone = 0;
      }
      continue;
    }
    const steep = v.y < -0.8 * len(v);
    if (t < 0.12 && !down) {
      s.label = "tail";
      s.bone = 0;
    } else if (t >= 0.35 || !down) cands.push({ s, kind: "arm", side: sideOf(far, attachEnd), reach: Math.abs(v.x) + Math.max(0, v.y) * 0.5 + len(v) * 0.5, attach: attachEnd, split: false, steep });
    else cands.push({ s, kind: "leg", side: sideOf(far, pelvis), reach: -v.y, attach: attachEnd, split: false });
  }

  // a horizontal body with nothing to stand on is a serpent: it slithers on its belly
  if (plan === "quadruped" && !cands.some((c) => c.kind === "leg" || c.kind === "arm")) {
    plan = "serpent";
    for (const s of work) if (s.label === "tail") s.label = "body add-on";
  }

  // --- resolve: one primary limb per side, the rest are follower chains
  const prim: Partial<Record<Limb, { pts: Pt[]; attach: Pt }>> = {};
  const auxCands: { s: Work; src: Limb; attach: Pt }[] = [];
  if (torsoLeg.length > 3) {
    const side: "F" | "B" = torsoLeg[torsoLeg.length - 1].x >= pelvis.x ? "F" : "B";
    prim[`leg${side}`] = { pts: torsoLeg, attach: pelvis };
  }
  if (plan === "vehicle") {
    // invisible legs: axle → wheel bottom, so the wheels sit on the ground
    for (const [w, slot] of [[wheels[0], "legB"], [wheels[1], "legF"]] as const) {
      const r = w.size / 2;
      prim[slot] = { pts: [w.center, add(w.center, { x: 0, y: -r * 0.5 }), add(w.center, { x: 0, y: -r })], attach: w.center };
    }
  } else if (plan === "quadruped") {
    // hind legs: front-most = legF; front legs: followers of the diagonal hind leg (a trot)
    const hind = cands.filter((c) => c.kind === "leg").sort((a, b) => b.attach.x - a.attach.x || b.reach - a.reach);
    const fore = cands.filter((c) => c.kind === "arm").sort((a, b) => b.attach.x - a.attach.x);
    for (const c of hind) {
      const slot: Limb | null = !prim.legF ? "legF" : !prim.legB ? "legB" : null;
      if (slot) {
        prim[slot] = { pts: c.s.pts, attach: c.attach };
        c.s.part = slot;
        c.s.label = slot === "legF" ? "hind leg" : "hind leg (far)";
      } else auxCands.push({ s: c.s, src: auxCands.length % 2 ? "legF" : "legB", attach: c.attach });
    }
    fore.forEach((c, i) => auxCands.push({ s: c.s, src: i % 2 === 0 ? "legB" : "legF", attach: c.attach }));
  } else {
    for (const c of [...cands].sort((a, b) => Number(b.split && b.reach > 0.15) - Number(a.split && a.reach > 0.15) || b.reach - a.reach)) {
      const anchorSide = c.kind;
      if (c.split) {
        const F = `${anchorSide}F` as Limb;
        const B = `${anchorSide}B` as Limb;
        if (!prim[F] && !prim[B]) {
          prim[F] = { pts: c.s.pts.filter((p) => p.x >= c.attach.x), attach: c.attach };
          prim[B] = { pts: c.s.pts.filter((p) => p.x < c.attach.x), attach: c.attach };
          c.s.part = F;
          c.s.split = true;
          c.s.label = `both ${anchorSide}s (one stroke)`;
          continue;
        }
        // a short line across the body once the limbs exist: belt, shoulder pads, sash
        c.s.label = "body add-on";
        c.s.bone = 0;
        continue;
      }
      const slot = `${c.kind}${c.side}` as Limb;
      const other = `${c.kind}${c.side === "F" ? "B" : "F"}` as Limb;
      if (!prim[slot]) {
        prim[slot] = { pts: c.s.pts, attach: c.attach };
        c.s.part = slot;
      } else if (!prim[other] && c.kind === "leg") {
        // two legs drawn on the same side: the second one becomes the other leg
        prim[other] = { pts: c.s.pts, attach: c.attach };
        c.s.part = other;
      } else if (c.kind === "arm" && c.steep) {
        // an extra "arm" hanging straight down from the shoulders is a cape / scarf / backpack strap
        c.s.label = "cape";
        c.s.bone = 0;
      } else auxCands.push({ s: c.s, src: slot, attach: c.attach });
    }
  }

  // shoulder line for bipeds sits a little under the neck
  const shoulderDefault = plan === "biped" ? add(chest, mul(sub(pelvis, chest), 0.12)) : chest;
  const limbJoints = (pts: Pt[] | undefined, anchor: Pt, fallbackEnd: Pt) => {
    if (!pts || pts.length < 2) return { root: anchor, mid: add(anchor, mul(sub(fallbackEnd, anchor), 0.5)), end: fallbackEnd, found: false };
    let end = pts[0];
    for (const p of pts) if (dist(p, anchor) > dist(end, anchor)) end = p;
    const reach = dist(end, anchor);
    let mid: Pt | null = null;
    let bend = -1;
    for (const p of pts) {
      const d = dist(p, anchor);
      if (d < reach * 0.35 || d > reach * 0.65) continue;
      const off = Math.abs(project(p, anchor, end).o);
      if (off > bend) {
        bend = off;
        mid = p;
      }
    }
    if (!mid || bend < reach * 0.06) mid = add(anchor, mul(sub(end, anchor), 0.5));
    return { root: anchor, mid, end, found: true };
  };
  const torsoLen = Math.max(0.12, dist(chest, pelvis));
  const anchorFor = (limb: Limb) => {
    const p = prim[limb];
    if (!p) return limb.startsWith("arm") ? shoulderDefault : pelvis;
    // the attachment point, but never further from the body line than the stroke itself
    const near = p.pts.reduce((a, q) => (dist(q, p.attach) < dist(a, p.attach) ? q : a), p.pts[0]);
    return limb.startsWith("arm") && plan === "biped" && dist(near, shoulderDefault) < 0.09 ? shoulderDefault : near;
  };
  const legFallback = (s: number): Pt => ({ x: pelvis.x + s * 0.06, y: 0 }); // invisible legs reach the bottom of the drawing
  const armFallback = (s: number): Pt => ({ x: shoulderDefault.x + s * 0.1, y: shoulderDefault.y - torsoLen * 0.7 });
  let aF = limbJoints(prim.armF?.pts, anchorFor("armF"), armFallback(1));
  let aB = limbJoints(prim.armB?.pts, anchorFor("armB"), armFallback(-1));
  const lF: ReturnType<typeof limbJoints> = limbJoints(prim.legF?.pts, anchorFor("legF"), legFallback(1));
  const lB: ReturnType<typeof limbJoints> = limbJoints(prim.legB?.pts, anchorFor("legB"), legFallback(-1));
  // a shield: a closed loop held at a hand (round, a crest, a rounded square)
  for (const s of work) {
    if (s.part !== "extra" || s.label || plan === "vehicle") continue;
    const sh = shapes.get(s)!;
    if ((sh.shape !== "loop" && sh.shape !== "drop") || s.size < 0.06 || s.size > 0.5) continue;
    const hands = [aF.found ? aF.end : null, aB.found ? aB.end : null].filter((h): h is Pt => !!h);
    const held = hands.filter((h) => polyNearest(h, s.pts).d < 0.07 || dist(h, s.center) < s.size * 0.6 + 0.04);
    // a small loop at a hand that also holds a long straight stroke is the sword's guard / hilt, not a shield
    const guard = s.size < 0.16 && held.some((h) => work.some((w) => w !== s && w.part === "extra" && shapes.get(w)!.shape === "line" && w.size > 0.15 && polyNearest(h, w.pts).d < 0.09));
    if (held.length && !guard) s.label = "power:shield";
  }
  const crown = add(chest, mul(sub(headC!, chest), (dist(headC!, chest) + headR) / Math.max(1e-6, dist(headC!, chest))));

  const ox = pelvis.x;
  if (plan === "vehicle") {
    // bones from the axle line, not the shoulder heuristics
    lF.found = false;
    lB.found = false;
  }
  const raw: Pt[] = [];
  raw[J.pelvis] = pelvis;
  raw[J.chest] = plan === "biped" ? shoulderDefault : chest;
  raw[J.crown] = crown;
  raw[J.shB] = aB.root;
  raw[J.elbowB] = aB.mid;
  raw[J.handB] = aB.end;
  raw[J.shF] = aF.root;
  raw[J.elbowF] = aF.mid;
  raw[J.handF] = aF.end;
  raw[J.hipB] = lB.root;
  raw[J.kneeB] = lB.mid;
  raw[J.footB] = lB.end;
  raw[J.hipF] = lF.root;
  raw[J.kneeF] = lF.mid;
  raw[J.footF] = lF.end;
  const shift = (p: Pt) => ({ x: p.x - ox, y: p.y });
  const bind = raw.map(shift);
  for (const s of allWork) s.pts = s.pts.map(shift);
  const headCenterFig = shift(headC!);

  const torsoFrame = (p: Pt) => {
    const pr = project(p, bind[J.pelvis], bind[J.chest]);
    return { t: pr.t, o: pr.o };
  };
  const L = (a: number, b: number, min: number) => Math.max(min, dist(bind[a], bind[b]));
  const horizontal = plan === "quadruped" || plan === "serpent" || plan === "vehicle";
  const minLeg = plan === "blob" ? 0.015 : 0.05;
  const torsoAngle = Math.atan2(bind[J.chest].x - bind[J.pelvis].x, bind[J.chest].y - bind[J.pelvis].y);
  const headAngle = Math.atan2(bind[J.crown].x - bind[J.chest].x, bind[J.crown].y - bind[J.chest].y);
  const shape: RigShape = {
    torso: L(J.pelvis, J.chest, 0.08),
    head: L(J.chest, J.crown, 0.06),
    headRadius: headR,
    upperArmF: L(J.shF, J.elbowF, 0.04),
    foreArmF: L(J.elbowF, J.handF, 0.04),
    upperArmB: L(J.shB, J.elbowB, 0.04),
    foreArmB: L(J.elbowB, J.handB, 0.04),
    thighF: L(J.hipF, J.kneeF, minLeg),
    shinF: L(J.kneeF, J.footF, minLeg),
    thighB: L(J.hipB, J.kneeB, minLeg),
    shinB: L(J.kneeB, J.footB, minLeg),
    roots: { armF: torsoFrame(bind[J.shF]), armB: torsoFrame(bind[J.shB]), legF: torsoFrame(bind[J.hipF]), legB: torsoFrame(bind[J.hipB]) },
    leanOffset: horizontal ? torsoAngle : 0,
    leanScale: plan === "vehicle" ? 0.25 : horizontal ? 0.35 : 1,
    headOffset: horizontal ? headAngle - torsoAngle : 0,
  };

  // follower chains for extra limbs
  const aux: AuxChain[] = auxCands.map((c, k) => {
    const attach = shift(c.attach);
    const pts = c.s.pts;
    const root = pts.reduce((a, q) => (dist(q, attach) < dist(a, attach) ? q : a), pts[0]);
    const j = limbJoints(pts, root, root);
    c.s.part = "aux";
    c.s.aux = k;
    c.s.label = `extra ${c.src.startsWith("arm") ? "arm" : "leg"} (moves with ${c.src})`;
    return { src: c.src, root: torsoFrame(j.root), bind: [j.root, j.mid, j.end] as [Pt, Pt, Pt], label: c.s.label };
  });

  const rig: Rig = {
    shape,
    bind,
    plan,
    mirrored: mirror,
    headCenter: (() => {
      const hc = project(headCenterFig, bind[J.chest], bind[J.crown]);
      return { t: hc.t, o: hc.o };
    })(),
    strokes: [],
    aux,
    found: { head: !!head, torso: true, armF: aF.found, armB: aB.found, legF: lF.found, legB: lB.found },
    extras: 0,
    strike: {
      punch: aF.found ? J.handF : aB.found ? J.handB : J.crown,
      kick: plan === "quadruped" ? J.crown : lF.found ? J.footF : lB.found ? J.footB : aF.found ? J.handF : J.crown,
    },
    parts: [],
    extent: { front: 0.1, back: 0.1 },
    gait: "walk",
    weapon: null,
    tail: [],
    wheelR: wheels.length ? (wheels[0].size + wheels[1].size) / 4 : 0,
    kind: "",
    pivotX: 0,
    over: [],
    headClosure: Math.max(0, Math.min(1, 1 - (headGap - 0.12) * 1.6)),
    powers: [],
  };
  {
    const bodyInk = work.filter((s) => s.part === "torso" || s.part === "head").flatMap((s) => s.pts);
    if (bodyInk.length) {
      rig.extent = { front: Math.max(0.05, ...bodyInk.map((p) => p.x)), back: Math.max(0.05, ...bodyInk.map((p) => -p.x)) };
    }
  }
  // reinforcing strokes take the part of the stroke they go over, and are skinned like it
  for (const [s, base] of over) {
    s.part = base.part;
    s.label = base.label;
    s.bone = base.bone;
    s.aux = base.aux;
    s.split = base.split;
  }
  rig.over = allWork.map((s) => (over.has(s) ? allWork.indexOf(over.get(s)!) : -1));
  work = allWork;
  const ext = extendedJoints(rig, bind);
  rig.strokes = work.map((s) => bindStroke(s, rig, ext, headCenterFig, headR));
  rig.extras = work.filter((s) => s.part === "extra").length;
  for (const s of work) {
    if (!s.label) s.label = s.part === "extra" ? "prop" : s.part === "torso" ? (plan === "vehicle" ? "chassis" : plan === "serpent" ? "serpent body" : body.loop ? "blob body" : torsoLeg.length ? "body + leg" : "body") : s.part === "head" ? "head" : s.part;
  }
  rig.parts = work.map((s) => s.label);
  // wheels spin about their own centre (bound to the chassis)
  work.forEach((s, i) => {
    if (s.label === "wheel") rig.strokes[i].spin = bindPoint(shift(s.center), ext, [0], true);
  });
  rig.tail = work.flatMap((s, i) => (s.label === "tail" ? [i] : []));
  // a weapon: the longest prop riding an arm (sword, bat, staff); the other hand's prop is a shield
  {
    const onArm = (i: number): "armF" | "armB" | null => {
      const b = rig.strokes[i].points[0].b0;
      return b === 4 || b === 5 ? "armF" : b === 2 || b === 3 ? "armB" : null;
    };
    const props = work.flatMap((s, i) => (s.part === "extra" && !s.label.startsWith("power") && onArm(i) ? [{ i, limb: onArm(i)!, len: Math.max(s.size, s.arc * 0.6) }] : []));
    const best = props.filter((p) => p.len > 0.12).sort((a, b) => b.len - a.len)[0];
    if (best) {
      rig.weapon = { limb: best.limb, strokes: props.filter((p) => p.limb === best.limb).map((p) => p.i), length: best.len };
      for (const i of rig.weapon.strokes) work[i].label = i === best.i ? "weapon" : "weapon part";
      for (const p of props) if (p.limb !== best.limb) work[p.i].label = "shield / held thing";
      rig.parts = work.map((s) => s.label);
    }
  }
  // powers: one entry per kind (at most two), with every stroke of it (re-drawn passes included)
  rig.powers = [];
  work.forEach((s, i) => {
    if (!s.label.startsWith("power:") || rig.over[i] >= 0) return;
    const kind = s.label.slice(6) as PowerKind;
    let p = rig.powers.find((q) => q.kind === kind);
    if (!p) {
      if (rig.powers.length >= 2) {
        s.label = "prop";
        return;
      }
      p = { kind, strokes: [], bone: rig.strokes[i].points[0]?.b0 ?? 0 };
      rig.powers.push(p);
    }
    p.strokes.push(i);
  });
  work.forEach((s, i) => {
    if (rig.over[i] < 0) return;
    const base = work[rig.over[i]];
    const p = rig.powers.find((q) => `power:${q.kind}` === base.label);
    if (p) p.strokes.push(i);
    else if (base.label === "prop") s.label = "prop";
  });
  rig.parts = work.map((s) => s.label);
  const legLen = Math.max(lF.found ? shape.thighF + shape.shinF : 0, lB.found ? shape.thighB + shape.shinB : 0);
  rig.gait =
    plan === "vehicle" ? "roll" : plan === "serpent" ? "slither" : plan === "quadruped" ? "trot" : plan === "blob" ? "bounce" : !lF.found && !lB.found ? "hop" : "walk";
  rig.pivotX = horizontal ? (bind[J.chest].x - bind[J.pelvis].x) / 2 : 0;
  const bigHead = !!head && headR > shape.torso * 0.75;
  const auxArms = rig.aux.filter((a) => a.src.startsWith("arm")).length;
  const bumpy = !!head && head.cv > 0.06 && headR > 0.12;
  rig.kind =
    plan === "vehicle" ? "vehicle on wheels"
    : plan === "serpent" ? "serpent"
    : plan === "quadruped" ? `four-legged beast${rig.tail.length ? " with a tail" : ""}`
    : plan === "blob" ? (aF.found || lF.found || lB.found ? "blob with limbs" : "blob")
    : bumpy && legLen < shape.torso * 0.6 ? "walking tree"
    : rig.weapon ? "armed fighter"
    : auxArms ? `${2 + auxArms}-armed fighter`
    : bigHead ? "big-headed fighter"
    : !lF.found && !lB.found ? (aF.found ? "legless fighter (hops)" : "living stick (hops)")
    : !aF.found && !aB.found ? "armless fighter (headbutts)"
    : "fighter";
  rig.strokes.forEach((s, i) => {
    s.label = work[i].label;
    if (s.label === "tail" || s.label === "cape" || s.label === "body add-on") {
      const pts = work[i].pts;
      const anchorAt = (p: Pt) => Math.min(segDist(p, bind[J.pelvis], bind[J.chest]), dist(p, bind[J.pelvis]));
      const anchor = anchorAt(pts[0]) <= anchorAt(pts[pts.length - 1]) ? 0 : pts.length - 1;
      s.dangle = { anchor, length: Math.max(0.05, arc(pts)) };
    }
  });
  // costume lines go last (indices of the read strokes stay put); they are skinned, never read
  for (const d of decos) {
    const pts = resample(d.points.map(toFig), 0.012).map(shift);
    const all = Array.from({ length: BONES.length }, (_, k) => k).filter((k) => k !== 1);
    const head = d.deco === "head";
    const candidates = d.deco === "torso" ? [0] : all;
    rig.strokes.push(
      head
        ? bindStroke({ idx: -1, color: d.color, w: d.w, pts, part: "head", loop: false, cv: 0, size: 0, arc: 0, center: pts[0], label: "costume" }, rig, ext, headCenterFig, headR)
        : { color: d.color, part: "torso", width: d.w ?? 1, label: "costume", points: pts.map((p) => bindPoint(p, ext, candidates, false)) },
    );
  }
  return rig;
}

// ---------------------------------------------------------------- binding
const LIMB_BONES: Record<Limb, number[]> = { armF: [4, 5], armB: [2, 3], legF: [8, 9], legB: [6, 7] };

/** joints + follower-chain joints (3 per aux chain) */
export function extendedJoints(rig: Rig, j: Joints): Pt[] {
  // already extended (a Rapier ragdoll simulates the follower chains itself)
  if (rig.aux.length === 0 || j.length >= JOINTS.length + rig.aux.length * 3) return j;
  const out = j.slice();
  const b = rig.bind;
  const pelvis = j[J.pelvis];
  const chest = j[J.chest];
  const ax = sub(chest, pelvis);
  const L = len(ax) || 1e-6;
  const d = { x: ax.x / L, y: ax.y / L };
  const n = { x: -d.y, y: d.x };
  const rot = (v: Pt, a: number): Pt => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const ang = (v: Pt) => Math.atan2(v.y, v.x);
  for (const c of rig.aux) {
    const [r0, r1, r2] = srcJoints(c.src);
    const root = add(pelvis, add(mul(d, c.root.t * L), mul(n, c.root.o)));
    const dUp = ang(sub(j[r1], j[r0])) - ang(sub(b[r1], b[r0]));
    const dLo = ang(sub(j[r2], j[r1])) - ang(sub(b[r2], b[r1]));
    const mid = add(root, rot(sub(c.bind[1], c.bind[0]), dUp));
    const end = add(mid, rot(sub(c.bind[2], c.bind[1]), dLo));
    out.push(root, mid, end);
  }
  return out;
}
function srcJoints(l: Limb): [number, number, number] {
  return l === "armF" ? [J.shF, J.elbowF, J.handF] : l === "armB" ? [J.shB, J.elbowB, J.handB] : l === "legF" ? [J.hipF, J.kneeF, J.footF] : [J.hipB, J.kneeB, J.footB];
}

function boneEnds(b: number): [number, number] {
  if (b < BONES.length) return BONES[b] as [number, number];
  const k = Math.floor((b - BONES.length) / 2);
  const lower = (b - BONES.length) % 2 === 1;
  const base = JOINTS.length + k * 3;
  return lower ? [base + 1, base + 2] : [base, base + 1];
}
function auxBone(k: number, lower: boolean) {
  return BONES.length + k * 2 + (lower ? 1 : 0);
}

function bindStroke(s: Work, rig: Rig, ext: Pt[], headC: Pt, headR: number): SkinStroke {
  const rigid = (bone: number): SkinStroke => {
    const [i, k] = boneEnds(bone);
    return {
      color: s.color,
      part: s.part,
      width: s.w ?? 1,
      label: s.label,
      points: s.pts.map((p) => {
        const pr = project(p, ext[i], ext[k]);
        return { b0: bone, t0: pr.t, o0: pr.o, b1: -1, t1: 0, o1: 0, w: 0 };
      }),
    };
  };
  if (s.part === "head") return rigid(1);
  if (s.part === "extra") {
    if (s.bone !== undefined) return rigid(s.bone);
    // props ride the bone their anchor end touches; near the shoulder/hips the body wins (capes, belts)
    const boneDist = (p: Pt, k: number) => {
      if (k === 1) return Math.max(0, dist(p, headC) - headR);
      const [i, e] = boneEnds(k);
      return segDist(p, ext[i], ext[e]);
    };
    const count = BONES.length + rig.aux.length * 2;
    const nearest = (p: Pt) => {
      let best = Infinity;
      let at = 0;
      for (let k = 0; k < count; k++) {
        const d = boneDist(p, k);
        if (d < best - 1e-9) {
          best = d;
          at = k;
        }
      }
      return { bone: at, d: best };
    };
    const a = nearest(s.pts[0]);
    const z = nearest(s.pts[s.pts.length - 1]);
    const anchor = a.d <= z.d ? s.pts[0] : s.pts[s.pts.length - 1];
    let bone = (a.d <= z.d ? a : z).bone;
    if (dist(anchor, ext[J.chest]) < 0.07 && boneDist(anchor, 0) < 0.05) bone = 0;
    if (dist(anchor, ext[J.pelvis]) < 0.05) bone = 0;
    if (dist(s.center, headC) < headR * 2.6 && s.center.y > headC.y - headR * 0.6) bone = 1;
    return rigid(bone);
  }
  let candidates: number[];
  if (s.part === "aux") candidates = [auxBone(s.aux!, false), auxBone(s.aux!, true)];
  else if (s.part === "torso") candidates = [0, 1, ...LIMB_BONES.legF, ...LIMB_BONES.legB];
  else if (s.split) candidates = s.part.startsWith("arm") ? [...LIMB_BONES.armF, ...LIMB_BONES.armB] : [...LIMB_BONES.legF, ...LIMB_BONES.legB];
  else candidates = [...LIMB_BONES[s.part as Limb], 0];
  return { color: s.color, part: s.part, width: s.w ?? 1, label: s.label, points: s.pts.map((p) => bindPoint(p, ext, candidates, s.part === "torso" && rig.plan !== "biped")) };
}

function bindPoint(p: Pt, ext: Pt[], candidates: number[], torsoOnly: boolean): SkinPoint {
  let best = candidates[0];
  let bestD = Infinity;
  for (const b of candidates) {
    if (torsoOnly && b !== 0) continue;
    const [i, k] = boneEnds(b);
    const bias = candidates.indexOf(b) < 2 ? 1 : 1.35;
    const d = segDist(p, ext[i], ext[k]) * bias;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  const [i, k] = boneEnds(best);
  const pr = project(p, ext[i], ext[k]);
  const out: SkinPoint = { b0: best, t0: pr.t, o0: pr.o, b1: -1, t1: 0, o1: 0, w: 0 };
  // two-bone blend near elbows / knees so bends are smooth, not torn (plan §7.2)
  const BLEND = 0.22;
  let parent: number | undefined = CHILD_OF[best];
  let child = Number(Object.keys(CHILD_OF).find((c) => CHILD_OF[Number(c)] === best) ?? -1);
  if (best >= BONES.length) {
    const lower = (best - BONES.length) % 2 === 1;
    parent = lower ? best - 1 : undefined;
    child = lower ? -1 : best + 1;
  }
  if (parent !== undefined && pr.t < BLEND) {
    const [a, b] = boneEnds(parent);
    const q = project(p, ext[a], ext[b]);
    Object.assign(out, { b1: parent, t1: q.t, o1: q.o, w: 0.5 * (1 - smooth(Math.max(0, pr.t) / BLEND)) });
  } else if (child >= 0 && pr.t > 1 - BLEND) {
    const [a, b] = boneEnds(child);
    const q = project(p, ext[a], ext[b]);
    Object.assign(out, { b1: child, t1: q.t, o1: q.o, w: 0.5 * smooth(Math.min(1, (pr.t - (1 - BLEND)) / BLEND)) });
  }
  return out;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- skinning
function placeOnBone(j: Pt[], bone: number, t: number, o: number): Pt {
  const [ia, ib] = boneEnds(bone);
  const a = j[ia];
  const b = j[ib];
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const L = Math.hypot(vx, vy) || 1e-6;
  return { x: a.x + vx * t + (-vy / L) * o, y: a.y + vy * t + (vx / L) * o };
}

/**
 * How a bone-normal offset scales under squash & stretch (sx, sy about the feet). The joints are
 * already scaled; this keeps the drawn width of a blob / body in step, and mirrors it on a flip.
 */
function offsetScale(j: Pt[], bone: number, sx: number, sy: number) {
  if (sx === 1 && sy === 1) return 1;
  const [ia, ib] = boneEnds(bone);
  const d = sub(j[ib], j[ia]);
  const L = len(d) || 1e-6;
  const n1 = { x: -d.y / L, y: d.x / L };
  const ssx = Math.abs(sx) < 0.08 ? Math.sign(sx || 1) * 0.08 : sx;
  const ssy = Math.abs(sy) < 0.08 ? 0.08 : sy;
  const r = { x: d.x / ssx, y: d.y / ssy };
  const rL = len(r) || 1e-6;
  const n0 = { x: -r.y / rL, y: r.x / rL };
  return n0.x * ssx * n1.x + n0.y * ssy * n1.y;
}

export function skinPoint(j: Pt[], sp: SkinPoint, sx = 1, sy = 1): Pt {
  const p0 = placeOnBone(j, sp.b0, sp.t0, sp.o0 * offsetScale(j, sp.b0, sx, sy));
  if (sp.b1 < 0 || sp.w <= 0) return p0;
  const p1 = placeOnBone(j, sp.b1, sp.t1, sp.o1 * offsetScale(j, sp.b1, sx, sy));
  return { x: p0.x + (p1.x - p0.x) * sp.w, y: p0.y + (p1.y - p0.y) * sp.w };
}

/** Re-place every drawn stroke from the animated joints (figure space). */
/** the drawing's own lines in pose, without costume lines: what hits, gets hit and touches the ground */
export function fightStrokes(rig: Rig, j: Joints, deform: number | Deform = 0) {
  const solid = new Set(rig.solid ?? []);
  return skinStrokes(rig, j, deform).filter((s, i) => s.label !== "costume" || solid.has(i));
}

export function skinStrokes(rig: Rig, j: Joints, deform: number | Deform = 0): { color: string; part: Part; points: Pt[]; label: string; width: number }[] {
  const ext = extendedJoints(rig, j);
  const D: Deform = typeof deform === "number" ? { sway: deform } : deform;
  const sway = D.sway ?? 0;
  const sx = D.sx ?? 1;
  const sy = D.sy ?? 1;
  // serpents: a travelling wave along the body (head end steadier than the tail)
  const waveAmp = rig.plan === "serpent" ? D.waveAmp ?? 0 : 0;
  const ax = sub(j[J.chest], j[J.pelvis]);
  const axL = len(ax) || 1e-6;
  const nrm = { x: -ax.y / axL, y: ax.x / axL };
  const wave = (t: number) => waveAmp * Math.sin(t * Math.PI * 2 * 1.5 - (D.wavePhase ?? 0)) * (1 - 0.65 * Math.max(0, Math.min(1, t)));
  return rig.strokes.map((s) => {
    let pts = s.points.map((sp) => {
      const p = skinPoint(ext, sp, sx, sy);
      if (!waveAmp) return p;
      const w = sp.b0 === 0 ? wave(sp.t0) : wave(1);
      return { x: p.x + nrm.x * w, y: p.y + nrm.y * w };
    });
    if (s.spin && D.spin) {
      // rolling forward turns the wheel clockwise (facing +x, y up)
      const c = skinPoint(ext, s.spin, sx, sy);
      const cs = Math.cos(-D.spin);
      const sn = Math.sin(-D.spin);
      pts = pts.map((p) => ({ x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs }));
    }
    if (s.dangle && Math.abs(sway) > 1e-4) {
      // secondary motion: tails / capes trail behind, bending more toward the tip
      const a = pts[s.dangle.anchor];
      let run = 0;
      const order = s.dangle.anchor === 0 ? pts.map((_, i) => i) : pts.map((_, i) => pts.length - 1 - i);
      const out = pts.slice();
      let prev = a;
      let prevOut = a;
      for (const i of order) {
        run += dist(pts[i], prev);
        const k = Math.min(1, run / s.dangle.length);
        const ang = sway * k;
        const v = sub(pts[i], prev);
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        prev = pts[i];
        prevOut = add(prevOut, { x: v.x * c - v.y * sn, y: v.x * sn + v.y * c });
        out[i] = prevOut;
      }
      pts = out;
    }
    return { color: s.color, part: s.part, points: pts, label: s.label, width: s.width ?? 1 };
  });
}

export function headCenterOf(rig: Rig, j: Joints): Pt {
  return placeOnBone(j, 1, rig.headCenter.t, rig.headCenter.o);
}

/** lowest point of all follower-chain feet/hands (for grounding many-legged fighters) */
export function auxLowest(rig: Rig, j: Joints): number {
  if (!rig.aux.length) return Infinity;
  const ext = extendedJoints(rig, j);
  let low = Infinity;
  rig.aux.forEach((c, k) => {
    if (c.src.startsWith("leg")) low = Math.min(low, ext[JOINTS.length + k * 3 + 2].y);
  });
  return low;
}

// ---------------------------------------------------------------- default sketch
/** A hand-drawn-looking stick fighter (notebook coords) for rivals / empty slots. */
export function sketchFighter(seed: number, color: string, style: "guard" | "brute" = "guard"): InkStroke[] {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280 - 0.5;
  };
  const wob = (p: Pt, k = 0.004): Pt => ({ x: p.x + rnd() * k, y: p.y + rnd() * k });
  const line = (a: Pt, b: Pt, n = 8) => Array.from({ length: n + 1 }, (_, i) => wob({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
  const big = style === "brute" ? 1.15 : 1;
  const cx = 0.5;
  const head: Pt[] = Array.from({ length: 22 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
    return wob({ x: cx + Math.cos(a) * 0.075 * big, y: 0.17 + Math.sin(a) * 0.08 * big }, 0.006);
  });
  const neck = { x: cx, y: 0.255 };
  const hip = { x: cx + 0.005, y: 0.56 };
  return [
    { color, points: head },
    { color, points: line(neck, hip, 10) },
    { color, points: [...line({ x: cx - 0.2, y: 0.42 }, { x: cx - 0.1, y: 0.33 }, 5), ...line({ x: cx - 0.1, y: 0.33 }, { x: cx, y: 0.29 }, 4)] },
    { color, points: [...line({ x: cx, y: 0.29 }, { x: cx + 0.11, y: 0.36 }, 4), ...line({ x: cx + 0.11, y: 0.36 }, { x: cx + 0.21, y: 0.43 }, 5)] },
    { color, points: [...line(hip, { x: cx - 0.09, y: 0.74 }, 6), ...line({ x: cx - 0.09, y: 0.74 }, { x: cx - 0.13, y: 0.93 }, 6)] },
    { color, points: [...line(hip, { x: cx + 0.1, y: 0.74 }, 6), ...line({ x: cx + 0.1, y: 0.74 }, { x: cx + 0.14, y: 0.93 }, 6)] },
    ...(style === "brute"
      ? [{ color, points: line({ x: cx - 0.06, y: 0.33 }, { x: cx + 0.06, y: 0.33 }, 6) }]
      : [{ color, points: line({ x: cx - 0.05, y: 0.095 }, { x: cx + 0.06, y: 0.09 }, 6) }]),
  ];
}

/**
 * The same rig drawn k times bigger (a hulking opponent): every length and offset in figure units
 * scales, the along-bone fractions and angles don't. Reach, collisions and hit tests all read the
 * scaled rig, so they stay true to what is drawn on screen.
 */
export function scaleRig(rig: Rig, k: number): Rig {
  if (Math.abs(k - 1) < 1e-9) return rig;
  const sp = (p: SkinPoint): SkinPoint => ({ ...p, o0: p.o0 * k, o1: p.o1 * k });
  const S = rig.shape;
  const roots = Object.fromEntries(Object.entries(S.roots).map(([l, r]) => [l, { t: r.t, o: r.o * k }])) as RigShape["roots"];
  return {
    ...rig,
    shape: {
      ...S,
      torso: S.torso * k,
      head: S.head * k,
      headRadius: S.headRadius * k,
      upperArmF: S.upperArmF * k,
      foreArmF: S.foreArmF * k,
      upperArmB: S.upperArmB * k,
      foreArmB: S.foreArmB * k,
      thighF: S.thighF * k,
      shinF: S.shinF * k,
      thighB: S.thighB * k,
      shinB: S.shinB * k,
      roots,
    },
    bind: rig.bind.map((p) => mul(p, k)),
    headCenter: { t: rig.headCenter.t, o: rig.headCenter.o * k },
    strokes: rig.strokes.map((s) => ({ ...s, points: s.points.map(sp), spin: s.spin ? sp(s.spin) : undefined, dangle: s.dangle ? { ...s.dangle, length: s.dangle.length * k } : undefined })),
    aux: rig.aux.map((a) => ({ ...a, root: { t: a.root.t, o: a.root.o * k }, bind: a.bind.map((p) => mul(p, k)) as [Pt, Pt, Pt] })),
    extent: { front: rig.extent.front * k, back: rig.extent.back * k },
    weapon: rig.weapon ? { ...rig.weapon, length: rig.weapon.length * k } : null,
    wheelR: rig.wheelR * k,
    pivotX: rig.pivotX * k,
  };
}
