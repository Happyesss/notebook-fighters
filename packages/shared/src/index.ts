/** Shared types + tuning for Notebook Fighters. */

export type Pt = { x: number; y: number };
/** A pencil stroke as captured in the notebook (points normalised 0..1, y down). */
/** w: optional line weight (1 = pencil; the computer's pre-drawn heavyweights go over with a thicker lead) */
/**
 * deco: a costume line (outline, mask, belt). It is drawn and moves with the fighter but the reader
 * ignores it, so it changes neither the reading nor the stats. "head" rides the head, "torso" the body,
 * "auto" follows whichever bone each point is nearest (limb outlines).
 */
export type InkStroke = { color: string; points: Pt[]; w?: number; deco?: "head" | "torso" | "weapon" | "auto"; tag?: FighterTag };

/**
 * A card clipped to a drawing: a special move picked from the list (instead of one read from a power
 * doodle), or a ready-made fighter from the computer's roster (`preset`, whose drawing can't be edited).
 * It travels as an ink-less first stroke, so every path that carries a drawing (local storage, online
 * rooms, play nearby) carries the card too, and old clients just see a stroke with no points.
 */
export type FighterTag = { special?: string; preset?: string };

/** split a drawing into its ink and its tag (the sim validates the tag's values itself) */
export function readTag(strokes: InkStroke[] | null | undefined): { ink: InkStroke[]; tag: FighterTag | null } {
  if (!strokes) return { ink: [], tag: null };
  let tag: FighterTag | null = null;
  const ink: InkStroke[] = [];
  for (const s of strokes) {
    if (s && s.tag && typeof s.tag === "object" && (!s.points || s.points.length === 0)) {
      const t: FighterTag = {};
      if (typeof s.tag.special === "string") t.special = s.tag.special.slice(0, 24);
      if (typeof s.tag.preset === "string") t.preset = s.tag.preset.slice(0, 24);
      if (t.special || t.preset) tag = t;
    } else ink.push(s);
  }
  return { ink, tag };
}

/** the drawing with its tag in front (none when the tag is empty) */
export function withTag(ink: InkStroke[], tag: FighterTag | null | undefined): InkStroke[] {
  const clean = ink.filter((s) => !(s.tag && s.points.length === 0));
  if (!tag || (!tag.special && !tag.preset)) return clean;
  return [{ color: "transparent", points: [], tag: { ...(tag.special ? { special: tag.special } : {}), ...(tag.preset ? { preset: tag.preset } : {}) } }, ...clean];
}

export type PlayerInput = {
  /** -1 left, 0 none, 1 right */
  x: number;
  punch: boolean;
  kick: boolean;
  jump: boolean;
  /** held */
  block?: boolean;
  /** held */
  crouch?: boolean;
  /** the drawn power's special move (pressed) */
  special?: boolean;
};

export const NO_INPUT: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };

export type Tuning = {
  gravity: number;
  balanceWn: number;
  balanceZeta: number;
  kLean: number;
  muscleScale: number;
  dampingScale: number;
  walkForce: number;
  walkSpeed: number;
  jabImpulse: number;
  kickImpulse: number;
  hitStopScale: number;
  uprightAssist: number;
};

export const DEFAULT_TUNING: Tuning = {
  gravity: 14,
  balanceWn: 18,
  balanceZeta: 0.72,
  kLean: 1,
  muscleScale: 1,
  dampingScale: 1,
  walkForce: 60,
  walkSpeed: 1.6,
  jabImpulse: 1,
  kickImpulse: 1.6,
  hitStopScale: 1,
  uprightAssist: 200,
};

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const STORAGE_KEY = "nf:fighter";
/** player 2's drawing for a local 2P duel */
export const STORAGE_KEY_P2 = "nf:fighter2";

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
export * from "./net";
