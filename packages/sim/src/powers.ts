/**
 * Powers from add-on doodles (plan §8): little drawings next to the fighter are read by their shape
 * (and the pencil colour, the way a kid colours fire red and water blue) — all deterministic, offline.
 *   zigzag / flame tongues → fire (red/orange) · lightning (gold) · ice (blue) · spikes (along the body)
 *   bolt (a Z with 2–3 sharp turns) → lightning · wavy line or droplets → water · asterisk/snowflake → ice
 *   a loop held at a hand → shield · loops or big curves on the upper back → wings
 */
import type { Pt } from "@nf/shared";

export type Element = "fire" | "water" | "lightning" | "ice";
/** the big rivals' own specials: nobody draws these, the fighter comes with one */
export type Signature = "pumpkin" | "bones" | "quake" | "leap";
export type PowerKind = Element | "wings" | "shield" | "spikes" | Signature;
export const ELEMENTS: Element[] = ["fire", "water", "lightning", "ice"];
/** the powers a drawing can have (the signatures are not drawn) */
export const POWER_KINDS: PowerKind[] = ["fire", "water", "lightning", "ice", "wings", "shield", "spikes"];
export const SIGNATURES: Signature[] = ["pumpkin", "bones", "quake", "leap"];
export const isSignature = (k: PowerKind | null | undefined): k is Signature => !!k && (SIGNATURES as string[]).includes(k);

export type Shape = "bolt" | "zigzag" | "wave" | "drop" | "loop" | "line" | "curve";
export type ShapeInfo = { shape: Shape; corners: number; alternating: number; inflections: number; size: number; straight: number; turning: number };

/** the pencil's colour family */
export function hueOf(color: string): "warm" | "gold" | "cool" | "neutral" {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  if (!m) return "neutral";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 40) return "neutral"; // graphite
  if (b > r + 70 && b > g + 30) return "cool"; // blue (purple is neutral)
  if (r > b + 60 && g > b + 50 && g > r * 0.6) return "gold"; // gold / yellow
  if (r > g + 40 && r > b + 40 && !(b > g + 20)) return "warm"; // red, orange (pink has b > g: neutral)
  return "neutral"; // green, purple, pink
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** shape features of one resampled stroke (figure units, ~0.012 spacing) */
export function shapeOf(raw: Pt[], loop: boolean): ShapeInfo {
  // smooth the hand wobble first (a shaky line must not read as a zigzag or a wave)
  let pts = raw;
  for (let pass = 0; pass < 2; pass++) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { x: (pts[i - 1].x + p.x * 2 + pts[i + 1].x) / 4, y: (pts[i - 1].y + p.y * 2 + pts[i + 1].y) / 4 }));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  let arc = 0;
  for (let i = 1; i < pts.length; i++) arc += dist(pts[i - 1], pts[i]);
  const straight = pts.length > 1 ? dist(pts[0], pts[pts.length - 1]) / Math.max(arc, 1e-6) : 1;
  // turning per point over a short window; sharp corners are local peaks above ~75°
  const k = 2;
  const turn: number[] = pts.map(() => 0);
  for (let i = k; i < pts.length - k; i++) {
    const a = Math.atan2(pts[i].y - pts[i - k].y, pts[i].x - pts[i - k].x);
    const b = Math.atan2(pts[i + k].y - pts[i].y, pts[i + k].x - pts[i].x);
    turn[i] = wrap(b - a);
  }
  const corners: { i: number; sign: number }[] = [];
  for (let i = k; i < pts.length - k; i++) {
    if (Math.abs(turn[i]) < 1.1) continue;
    const last = corners[corners.length - 1];
    if (last && i - last.i <= 2 * k && last.sign === Math.sign(turn[i])) {
      if (Math.abs(turn[i]) > Math.abs(turn[last.i])) corners[corners.length - 1] = { i, sign: Math.sign(turn[i]) };
    } else corners.push({ i, sign: Math.sign(turn[i]) });
  }
  let alternating = 0;
  for (let c = 1; c < corners.length; c++) if (corners[c].sign !== corners[c - 1].sign) alternating++;
  // gentle bends that change direction: a wave. Each lobe must turn a real amount (> ~35°) to count.
  let inflections = 0;
  let turning = 0;
  let lobe = 0;
  let lobes = 0;
  let lastSign = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const t = wrap(Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x) - Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x));
    turning += t;
    if (Math.sign(t) === Math.sign(lobe) || lobe === 0) lobe += t;
    else {
      if (Math.abs(lobe) > 0.6) {
        if (lastSign && Math.sign(lobe) !== lastSign) inflections++;
        lastSign = Math.sign(lobe);
        lobes++;
      }
      lobe = t;
    }
  }
  if (Math.abs(lobe) > 0.6 && lastSign && Math.sign(lobe) !== lastSign) inflections++;
  turning = Math.abs(turning);
  const n = corners.length;
  let shape: Shape = "curve";
  // a bolt: 2–3 sharp alternating turns, long straight-ish legs, and it gets somewhere (not a tight scribble)
  const legsOk = (() => {
    if (n < 2) return false;
    const idx = [0, ...corners.map((c) => c.i), pts.length - 1];
    let shortest = Infinity;
    for (let j = 1; j < idx.length; j++) shortest = Math.min(shortest, dist(pts[idx[j - 1]], pts[idx[j]]));
    return shortest > arc * 0.12;
  })();
  if (loop) shape = n >= 4 && alternating >= 3 ? "zigzag" : size < 0.1 ? "drop" : "loop";
  else if (n >= 4 && alternating >= 3) shape = "zigzag";
  else if (n >= 2 && n <= 3 && alternating >= n - 1 && legsOk && straight > 0.3 && size > 0.08) shape = "bolt";
  else if (n <= 1 && inflections >= 2 && straight > 0.45 && size > 0.07) shape = "wave";
  else if (straight > 0.9) shape = "line";
  return { shape, corners: n, alternating, inflections, size, straight, turning };
}

/** what each power does in the duel (and the card's words) */
export const POWER_INFO: Record<PowerKind, { name: string; special: string; passive: string; cooldown: number; word: string }> = {
  fire: { name: "Fire", special: "Fireball", passive: "burns on hit", cooldown: 3.2, word: "FWOOSH!" },
  water: { name: "Water", special: "Water wave", passive: "puts out fire, leaves a slippery puddle", cooldown: 3.6, word: "SPLASH!" },
  lightning: { name: "Lightning", special: "Lightning dash", passive: "stuns", cooldown: 5, word: "ZAP!" },
  ice: { name: "Ice", special: "Ice shard", passive: "freezes (slows)", cooldown: 3.6, word: "FREEZE!" },
  wings: { name: "Wings", special: "Dive", passive: "double jump, glide", cooldown: 3.2, word: "SWOOP!" },
  shield: { name: "Shield", special: "Shield bash", passive: "blocks take almost nothing, stops shots", cooldown: 3.6, word: "BASH!" },
  spikes: { name: "Spikes", special: "Spike burst", passive: "thorns: hitting it hurts", cooldown: 5, word: "SPIKES!" },
  pumpkin: { name: "Pumpkin", special: "Throw pumpkin", passive: "lobs a pumpkin over in an arc: it splats for damage and a short stagger", cooldown: 4.2, word: "SPLAT!" },
  bones: { name: "Bones", special: "Bone scatter", passive: "falls apart into a pile of bones (the next hit passes through), then snaps back together a step forward with a bony strike", cooldown: 5, word: "CLACK!" },
  quake: { name: "Ground shake", special: "Ground shake", passive: "a stomp sends a shockwave along the ground that staggers anyone standing on it: jump over it", cooldown: 5.2, word: "STOMP!" },
  leap: { name: "Mega leap", special: "Mega leap", passive: "a huge jump across the arena that lands in a smash: it hits anyone near the landing", cooldown: 6, word: "SMASH!" },
};

/** element counters: water douses fire, fire melts ice, ice freezes water, lightning shocks water */
const BEATS: Partial<Record<Element, Element[]>> = { water: ["fire"], fire: ["ice"], ice: ["water"], lightning: ["water"] };
export function elementMult(att: Element | null, def: Element | null): number {
  if (!att || !def) return 1;
  if (BEATS[att]?.includes(def)) return 1.5;
  if (BEATS[def]?.includes(att)) return 0.67;
  return 1;
}
/** the element that beats this one (the Hard CPU draws it) */
export function counterOf(e: Element): Element {
  return e === "fire" ? "water" : e === "ice" ? "fire" : "lightning";
}

/**
 * Notebook-coord doodles for each power, placed around a figure whose hand is at `hand`, back at `back`
 * (used by the CPU rival's sketch and by the tests: the reader must recognise its own doodles).
 */
export function powerDoodle(kind: PowerKind, hand: Pt, back: Pt, s = 1, seed = 1): { color: string; points: Pt[] }[] {
  let r = seed * 7919 + 13;
  const wob = () => ((r = (r * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
  const P = (x: number, y: number): Pt => ({ x: x + wob(), y: y + wob() });
  const seg = (pts: [number, number][], n = 5) => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < n; k++) out.push(P(pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / n, pts[i][1] + ((pts[i + 1][1] - pts[i][1]) * k) / n));
    out.push(P(...pts[pts.length - 1]));
    return out;
  };
  const hx = hand.x, hy = hand.y;
  switch (kind) {
    case "fire": // flame tongues just past the fist
      return [{ color: "#e07a2f", points: seg([[hx + 0.02, hy + 0.03], [hx + 0.04, hy - 0.05 * s], [hx + 0.06, hy + 0.01], [hx + 0.08, hy - 0.08 * s], [hx + 0.1, hy + 0.01], [hx + 0.12, hy - 0.06 * s], [hx + 0.14, hy + 0.03]], 4) }];
    case "lightning": // a bolt above the hand
      return [{ color: "#c4962c", points: seg([[hx + 0.08, hy - 0.16 * s], [hx + 0.03, hy - 0.07 * s], [hx + 0.09, hy - 0.06 * s], [hx + 0.03, hy + 0.04 * s]], 6) }];
    case "water": { // three droplets
      const drop = (cx: number, cy: number, rr: number) => {
        const pts: Pt[] = [];
        for (let i = 0; i <= 18; i++) {
          const a = (i / 18) * Math.PI * 2 - Math.PI / 2;
          const pinch = Math.sin(a) < -0.6 ? 0.35 : 1; // pointed top
          pts.push(P(cx + Math.cos(a) * rr * pinch, cy + Math.sin(a) * rr * 1.3));
        }
        return { color: "#1d4f89", points: pts };
      };
      return [drop(hx + 0.05, hy - 0.05, 0.024 * s), drop(hx + 0.12, hy, 0.022 * s), drop(hx + 0.06, hy + 0.06, 0.023 * s)];
    }
    case "ice": { // a snowflake: three crossing lines
      const cx = hx + 0.08, cy = hy - 0.04, R = 0.045 * s;
      return [0, 1, 2].map((k) => {
        const a = (k * Math.PI) / 3 + 0.2;
        return { color: "#1d4f89", points: seg([[cx - Math.cos(a) * R, cy - Math.sin(a) * R], [cx + Math.cos(a) * R, cy + Math.sin(a) * R]], 6) };
      });
    }
    case "shield": { // a round shield at the (back) hand
      const pts: Pt[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2.05;
        pts.push(P(hx + Math.cos(a) * 0.055 * s, hy + Math.sin(a) * 0.07 * s));
      }
      return [{ color: "#2a241c", points: pts }];
    }
    case "wings": { // a feathered wing from the upper back: a loop with scallops
      const bx = back.x, by = back.y;
      const pts: [number, number][] = [[bx, by], [bx - 0.08, by - 0.1], [bx - 0.17, by - 0.12], [bx - 0.15, by - 0.06], [bx - 0.18, by - 0.03], [bx - 0.14, by], [bx - 0.16, by + 0.03], [bx - 0.08, by + 0.02], [bx, by + 0.01]];
      return [{ color: "#2a241c", points: seg(pts, 4) }];
    }
    case "spikes": { // a row of spikes along the back
      const bx = back.x, by = back.y;
      const pts: [number, number][] = [];
      for (let i = 0; i <= 8; i++) pts.push([bx - (i % 2 ? 0.055 : 0.012), by + i * 0.03]);
      return [{ color: "#2a241c", points: seg(pts, 3) }];
    }
    default: // the signatures are not drawn
      return [];
  }
}
