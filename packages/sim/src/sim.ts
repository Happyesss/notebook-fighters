/**
 * Duel simulation: the player's drawn fighter vs a rival on one notebook page.
 * Fixed 60 Hz step; gameplay drives Animator moves; Animator drives the drawn ink.
 */
import { DEFAULT_TUNING, SIM_DT, type InkStroke, type PlayerInput, type Pt, type Tuning } from "@nf/shared";
import { Animator, isAttack, type MoveName, type Pose } from "./anim";
import { J, inferRig, fightStrokes, skinStrokes, sketchFighter, scaleRig, type Deform, type Joints, type Rig } from "./rig";
import { pickRival, rosterById, type RosterEntry, type RosterId } from "./roster";
import { computeStats, type FighterStats, type PartKey } from "./stats";
import { RapierRagdoll, loadPhysics, physicsReady } from "./physics";
import { POWER_INFO, counterOf, elementMult, isSignature, powerDoodle, type Element, type PowerKind } from "./powers";

export type FxEvent =
  /** `move`: the strike that landed (punch, kick, swing…); `heavy`: the striker is a sized-up hulk (deeper sound) */
  | { kind: "hit"; x: number; y: number; power: number; low: boolean; word?: string; color?: string; who?: number; move?: string; heavy?: boolean }
  | { kind: "special"; x: number; y: number; power: PowerKind; dir: number }
  | { kind: "clash"; x: number; y: number; word: string; color: string }
  | { kind: "block"; x: number; y: number; power: number }
  | { kind: "whoosh"; x: number; y: number; dir: number; move: string; heavy?: boolean }
  | { kind: "jump" | "land"; x: number; y: number }
  | { kind: "ko"; x: number; y: number; who: number };

export type FighterSnap = {
  x: number;
  y: number;
  facing: number;
  joints: Joints;
  move: MoveName;
  hp: number;
  maxHp: number;
  color: string;
  rig: Rig;
  shiver: number;
  sway: number;
  deform: Deform;
  /** world position of the striking edge during an attack (smear trails follow it) */
  tip: Pt | null;
  active: boolean;
  ko: boolean;
  /** the drawn power: its special, seconds until it is ready again (and the full cooldown), statuses */
  special: PowerKind | null;
  element: Element | null;
  passives: PowerKind[];
  cool: number;
  coolMax: number;
  burning: boolean;
  frozen: boolean;
  dashing: boolean;
  /** Bone scatter: 0..1 while the skeleton lies in a pile of bones (0 = standing) */
  scatter: number;
};

/** a thrown power: fireball, water wave, ice shard */
export type Projectile = { kind: Element | "pumpkin" | "quake"; owner: number; x: number; y: number; vx: number; vy: number; r: number; life: number; dmg: number; g?: number };
/** a slippery puddle left by a water wave: the other side walks slowly through it */
export type Puddle = { x: number; w: number; t: number; owner: number };

/** what hits: a limb chain, or the drawn ink of a part (head, tail, weapon, the whole body) */
export type Striker = "punch" | "kick" | "head" | "tail" | "weapon" | "body" | "front";
/** the bodies keep this much paper between them while a punch or kick lands */
const BODY_STOP = 0.02;
/** ...and once there, the outlines may touch (a stroke's width) but the chest never sinks into the foe */
const BODY_TOUCH = -0.03;
/** a sized roster fighter (the hulk): its drawn bulk is solid, so strikes against / from it keep the bodies apart */
const big = (f: { rig: Rig; anim: Animator }) => (f.rig.solid?.length ?? 0) > 0 || f.anim.attackLean < 1;
type MoveSpec = { striker: Striker; dmg: number; kb: number; word?: string; lunge: (f: Fighter) => { v: number; t: number }; leap?: { at: number; vy: number; vx: number } };
const armLen = (f: Fighter) => f.rig.shape.upperArmF + f.rig.shape.foreArmF;
const legLen = (f: Fighter) => Math.max(f.rig.shape.thighF + f.rig.shape.shinF, f.rig.shape.thighB + f.rig.shape.shinB);
const SPECS: Partial<Record<MoveName, MoveSpec>> = {
  punch: { striker: "punch", dmg: 8, kb: 1, lunge: (f) => ({ v: f.rig.strike.punch === J.crown ? 1.6 : 0.7 + Math.max(0, 0.42 - armLen(f)) * 3, t: 0.17 }) },
  kick: { striker: "kick", dmg: 13, kb: 1.6, lunge: (f) => ({ v: f.rig.strike.kick === J.crown ? 2.3 : 0.5 + Math.max(0, 0.5 - legLen(f)) * 3.5, t: 0.28 }) },
  swing: { striker: "weapon", dmg: 14, kb: 1.5, word: "SHING!", lunge: () => ({ v: 0.6, t: 0.22 }) },
  headbutt: { striker: "head", dmg: 10, kb: 1.2, word: "BONK!", lunge: () => ({ v: 1.7, t: 0.2 }) },
  flop: { striker: "body", dmg: 14, kb: 1.5, word: "TIMBER!", lunge: () => ({ v: 0.7, t: 0.3 }) },
  bite: { striker: "head", dmg: 10, kb: 1, word: "CHOMP!", lunge: () => ({ v: 1.5, t: 0.2 }) },
  charge: { striker: "front", dmg: 16, kb: 2, word: "WHAM!", lunge: () => ({ v: 2.6, t: 0.42 }) },
  pounce: { striker: "front", dmg: 15, kb: 1.8, word: "POUNCE!", lunge: () => ({ v: 0, t: 0 }), leap: { at: 0.15, vy: 1.35, vx: 2.1 } },
  tailWhip: { striker: "tail", dmg: 13, kb: 1.7, word: "WHIP!", lunge: (f) => ({ v: f.rig.plan === "serpent" ? 1.8 : 0.5, t: 0.25 }) },
  slam: { striker: "body", dmg: 15, kb: 1.6, word: "SPLAT!", lunge: () => ({ v: 0.9, t: 0.4 }) },
  squish: { striker: "body", dmg: 11, kb: 1.4, word: "SQUISH!", lunge: () => ({ v: 1.7, t: 0.28 }) },
  coilStrike: { striker: "front", dmg: 12, kb: 1.2, word: "HISS!", lunge: () => ({ v: 1.8, t: 0.26 }) },
  ram: { striker: "front", dmg: 15, kb: 2, word: "CRASH!", lunge: () => ({ v: 2.2, t: 0.36 }) },
  wheelie: { striker: "front", dmg: 13, kb: 1.6, word: "VROOM!", lunge: () => ({ v: 0.9, t: 0.36 }) },
};

export type SimState = {
  frame: number;
  playerHp: number;
  bagHp: number;
  /** max HP of each side (from each drawing's own stats) */
  playerMax: number;
  bagMax: number;
  fighters: FighterSnap[];
  over: boolean;
  winner: number | null;
  /** seconds of "3-2-1" left before anyone may act (0 once the fight is on) */
  countdown: number;
  /** seconds since the countdown hit zero (the "FIGHT!" stamp shows briefly) */
  sinceStart: number;
  /** best-of-3: round number (1-based), rounds won [player, rival], and the match winner once someone has 2 */
  round: number;
  wins: [number, number];
  matchWinner: number | null;
  projectiles: Projectile[];
  puddles: Puddle[];
};

export type Difficulty = "easy" | "normal" | "hard";
/**
 * How the CPU rival plays. A human needs a little time to react; so does the rival here:
 * it decides on a timer, notices the player's attack only after `reaction` seconds, sometimes
 * blocks it, and steps back after landing a combo instead of pinning the player.
 */
type AiProfile = {
  /** seconds between decisions (base + random spread) */
  think: [number, number];
  /** chance to attack when in range at a decision */
  attack: number;
  /** chance to block a player attack it has noticed, and how long it takes to notice */
  block: number;
  reaction: number;
  /** chance to use its drawn special when it is ready and the range suits it */
  special: number;
  /** how hard the rival's specials hit (its powers are a gift from the game, not drawn by you) */
  rivalSpecial: number;
  /** damage multipliers: what the rival deals, what the player deals */
  rivalDmg: number;
  playerDmg: number;
  /** hits in a row before it backs off, and for how long */
  combo: number;
  backOff: number;
};
export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  easy: { think: [0.65, 0.58], attack: 0.72, block: 0.25, reaction: 0.3, special: 0.2, rivalSpecial: 0.6, rivalDmg: 0.94, playerDmg: 0.75, combo: 2, backOff: 0.9 },
  normal: { think: [0.55, 0.5], attack: 0.76, block: 0.35, reaction: 0.22, special: 0.3, rivalSpecial: 0.7, rivalDmg: 0.86, playerDmg: 0.7, combo: 2, backOff: 0.7 },
  hard: { think: [0.5, 0.45], attack: 0.8, block: 0.22, reaction: 0.2, special: 0.45, rivalSpecial: 0.8, rivalDmg: 0.84, playerDmg: 0.75, combo: 2, backOff: 0.6 },
};

const STAGE = 2.7;
/**
 * The stage walls, in figure units from the middle: the renderer draws the notebook's red margin line at
 * -WALL_X and its mirror at +WALL_X. A fighter's drawn body (torso + head) stops at them, and the
 * knocked-out ragdoll's walls are here too. Fixed size, so online and nearby clients agree on any screen.
 */
export const WALL_X = STAGE + 0.3;
/** Bone scatter: how long the skeleton lies in a pile, and how far it reappears forward */
export const SCATTER_T = 0.55;
const SCATTER_STEP = 0.6;
/** a signature special's cooldown by level (Easy waits longer) */
export const SIGNATURE_COOL: Record<Difficulty, number> = { easy: 1.5, normal: 1.2, hard: 1 };
/** the most of a fighter's body counted against a wall (a long dog's snout may poke past) */
const WALL_BODY = 0.5;
const G_SCALE = 0.35; // tuning gravity (m/s²-ish) → figure heights / s²


/** gravity on a lobbed pumpkin (figure heights / s²) */
const PUMPKIN_G = 3.4;
const isElement = (k: string): k is Element => k === "fire" || k === "water" || k === "lightning" || k === "ice";

/** where f.x may go: its drawn body (torso + head, as drawn) stays between the walls */
function wallBounds(f: { facing: number; rig: Rig }): [number, number] {
  const back = Math.min(WALL_BODY, f.rig.extent.back);
  const front = Math.min(WALL_BODY, f.rig.extent.front);
  return f.facing > 0 ? [-WALL_X + back, WALL_X - front] : [-WALL_X + front, WALL_X - back];
}

class Fighter {
  anim: Animator;
  x: number;
  y = 0;
  vx = 0;
  vy = 0;
  facing: number;
  /** drawn k times bigger (the hulk): 1 for everyone else */
  size = 1;
  hp: number;
  stats: FighterStats;
  stun = 0;
  /** step-in: hold this forward speed until the strike window (so short limbs still connect) */
  lunge = { v: 0, t: 0 };
  pendingJump = -1;
  blocking = false;
  crouching = false;
  landed = true;
  struck = false;
  ko = false;
  won = false;
  leapt = false;
  /** last striking-edge position (world), for the smear trail */
  tip: Pt | null = null;
  // --- the drawn power
  special: PowerKind | null = null;
  element: Element | null = null;
  passives = new Set<PowerKind>();
  /** effect multiplier from how often the doodle was drawn over (0.85 … 1.15) */
  powerMult = 1;
  cool = 0;
  burn = { t: 0, dps: 0, by: 0 };
  frozen = 0;
  /** lightning dash / shield bash: a short burst forward that hits once */
  dash = { t: 0, v: 0, kind: null as PowerKind | null, hit: false };
  /** wings: 1 = climbing for a dive, 2 = diving */
  dive = 0;
  diveHit = false;
  airJumps = 0;
  pendingShot = { t: -1, kind: null as Element | "pumpkin" | "quake" | null };
  /** the special's full cooldown (a signature special is slower on the easier levels) */
  coolMax = 0;
  /** Bone scatter: seconds left lying in a pile of bones (nothing hits it) */
  scatter = 0;
  /** Mega leap: in the air, smashing down on landing */
  slam = false;
  constructor(
    public rig: Rig,
    public color: string,
    public startX: number,
  ) {
    this.anim = new Animator(rig);
    this.stats = computeStats(rig);
    this.hp = this.stats.hp;
    // the special comes from an element first (fire, water, lightning, ice), then wings, shield, spikes
    const kinds = rig.powers.map((p) => p.kind);
    this.element = (kinds.find((k) => k === "fire" || k === "water" || k === "lightning" || k === "ice") as Element | undefined) ?? null;
    this.special = this.element ?? (["wings", "shield", "spikes"] as PowerKind[]).find((k) => kinds.includes(k)) ?? null;
    this.passives = new Set(kinds);
    const ps = this.stats.powers.find((p) => p.kind === this.special);
    this.powerMult = ps?.strength ?? 1;
    this.coolMax = this.special ? POWER_INFO[this.special].cooldown : 0;
    this.x = startX;
    this.facing = startX < 0 ? 1 : -1;
  }
  /** draw this fighter k times bigger and give it its own stance; its stats stay those read from the drawing */
  grow(k: number, stance: Partial<Pose> | null) {
    this.size = k;
    const physics = this.anim.physics;
    this.rig = scaleRig(this.rig, k);
    // the drawn bulk is the body: it keeps its distance and it can be hit
    // (costume strokes skinned only to the torso / head bones: chest, lats, abs, face)
    const solid = this.rig.strokes.flatMap((st, i) => (st.label === "costume" && st.points.every((q) => q.b0 <= 1 && (q.b1 < 0 || q.b1 <= 1 || q.w === 0)) ? [i] : []));
    const body = skinStrokes(this.rig, this.rig.bind).filter((_, i) => solid.includes(i)).flatMap((st) => st.points);
    if (body.length) this.rig = { ...this.rig, solid, extent: { front: Math.max(this.rig.extent.front, ...body.map((p) => p.x)), back: Math.max(this.rig.extent.back, ...body.map((p) => -p.x)) } };
    this.anim = new Animator(this.rig);
    this.anim.physics = physics;
    this.anim.stance = stance;
    // a big body leans and steps into its strikes less (its long arms reach anyway)
    if (k > 1) this.anim.attackLean = Math.max(0.2, 1 - (k - 1) * 4);
  }
  get airborne() {
    return this.y > 0.0001 || this.vy > 0;
  }
  reset() {
    this.anim.revive();
    this.x = this.startX;
    this.y = this.vx = this.vy = 0;
    this.facing = this.startX < 0 ? 1 : -1;
    this.hp = this.stats.hp;
    this.stun = 0;
    this.cool = this.special ? 1.5 : 0;
    this.burn = { t: 0, dps: 0, by: 0 };
    this.frozen = 0;
    this.dash = { t: 0, v: 0, kind: null, hit: false };
    this.dive = 0;
    this.airJumps = 0;
    this.pendingShot = { t: -1, kind: null };
    this.scatter = 0;
    this.slam = false;
    this.lunge = { v: 0, t: 0 };
    this.pendingJump = -1;
    this.blocking = this.crouching = this.struck = this.ko = this.won = false;
  }
  world(p: Pt): Pt {
    return { x: this.x + this.facing * p.x, y: this.y + p.y };
  }
  snap(): FighterSnap {
    return {
      x: this.x,
      y: this.y,
      facing: this.facing,
      joints: this.anim.joints.map((p) => ({ x: p.x, y: p.y })),
      move: this.anim.move,
      hp: this.hp,
      maxHp: this.stats.hp,
      color: this.color,
      rig: this.rig,
      shiver: this.anim.shiver,
      sway: this.anim.sway,
      deform: { ...this.anim.deform },
      tip: this.tip ? { ...this.tip } : null,
      active: this.anim.active,
      ko: this.ko,
      special: this.special,
      element: this.element,
      passives: [...this.passives],
      cool: this.cool,
      coolMax: this.coolMax,
      burning: this.burn.t > 0,
      frozen: this.frozen > 0,
      dashing: this.dash.t > 0 || this.dive === 2,
      scatter: this.scatter > 0 ? Math.min(1, this.scatter / SCATTER_T) : 0,
    };
  }
}

export type SimOptions = {
  player?: InkStroke[] | null;
  rival?: InkStroke[] | null;
  /** "on": the CPU fights you · "off": the rival stands still (tests) · "versus": two humans (step's second input) */
  ai?: "on" | "off" | "versus";
  difficulty?: Difficulty;
  /** seconds of "3-2-1 FIGHT!" before each round (0 = start at once, as the tests do) */
  countdown?: number;
  /**
   * the CPU rival's drawn power when it uses the default sketch: a kind, none, or "auto"
   * (Easy: none · Normal: one that doesn't counter yours, only if you drew a power · Hard: the counter to yours)
   */
  rivalPower?: PowerKind | null | "auto";
  /** KO ragdoll: "classic" verlet (default) or "rapier" (Rapier2D deterministic build, loaded by createSim) */
  physics?: "classic" | "rapier";
  /**
   * game speed: how much fight time passes per 60 Hz frame (1 = the old, fast pace). Walking, attacks,
   * knockback, the CPU's thinking and the K.O. fall all run at this pace; the 3-2-1 countdown and the
   * pause between rounds stay in real time. Default GAME_PACE.
   */
  pace?: number;
  /**
   * which pre-drawn computer fighter (roster.ts) to face when no rival drawing is given: an id, or
   * "auto" (the computer picks one for the level). Omitted: the old plain sketch rival.
   */
  rivalId?: RosterId | "auto" | null;
};

/** default game speed (phase 6: the fight was too fast to read; 0.72× the old pace) */
export const GAME_PACE = 0.72;
/** pre-drawn rivals: overall strength by tier (1 kid/dog, 2 boxer/karate/ninja/swordsman, 3 pehelwan/bodybuilder) */
/** a pre-drawn rival with a power: its overall strength by power (tuned with test/bot.ts) */
export const RIVAL_POWER_STEP: Partial<Record<PowerKind, number>> = { fire: 1.04, water: 1, lightning: 0.99, ice: 0.9, wings: 1, shield: 0.9, spikes: 1, pumpkin: 1.12, bones: 0.97, quake: 1, leap: 0.95 };
/** the CPU blocks a beast's attacks less often (tuned with the bot: a four-legged drawing was blocked into 0% wins on Hard) */
const HARD_TO_READ = new Set<string>(["bite", "tailWhip", "charge", "pounce"]);
export const HARD_TO_READ_BLOCK = 0.5;
export const ROSTER_TIER_STEP: Record<1 | 2 | 3, number> = { 1: 0.94, 2: 1, 3: 1.06 };
/** how far the CPU's thinking clock stays toward real time at a slower game pace (0 = paced like the fight, 1 = real time) */
export const AI_PACE = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NF_AI_PACE ?? 1);

/** which power the CPU rival draws for itself (deterministic: depends only on your drawing and the level) */
export function rivalPowerFor(player: Rig, difficulty: Difficulty): PowerKind | null {
  const mine = player.powers.map((p) => p.kind);
  const el = mine.find((k) => k === "fire" || k === "water" || k === "lightning" || k === "ice") as Element | undefined;
  if (difficulty === "easy") return null;
  if (difficulty === "hard") return el ? counterOf(el) : mine.length ? "lightning" : "fire";
  if (!mine.length) return null;
  // Normal picks from the powers that are fair in the CPU's hands (spikes and lightning are kept for Hard)
  const pool: PowerKind[] = ["wings", "shield", "fire", "ice", "water"].filter((k) => !mine.includes(k as PowerKind) && (!el || k !== counterOf(el))) as PowerKind[];
  return pool[(player.strokes.length * 7 + player.bind.length) % pool.length];
}

/** the CPU rival's sketch, with its power doodle drawn on */
export function rivalStrokes(power: PowerKind | null, drawn?: InkStroke[] | null): InkStroke[] {
  const base = drawn ?? sketchFighter(11, "#1d4f89", "brute");
  if (!power || isSignature(power)) return base;
  return [...base, ...powerDoodle(power, power === "shield" ? { x: 0.3, y: 0.43 } : { x: 0.71, y: 0.43 }, power === "spikes" ? { x: 0.49, y: 0.4 } : { x: 0.49, y: 0.34 }, 1, 5)];
}

/** damage of a move (for the clan battle, which has its own simpler combat) */
export function moveDamage(move: MoveName) {
  return SPECS[move]?.dmg ?? 8;
}
/** what a move hits with (its damage multiplier in FighterStats.dmg is keyed by this) */
export function moveStriker(move: MoveName): Striker {
  return SPECS[move]?.striker ?? "punch";
}

export class NotebookSim {
  /** the CPU's dice: seeded per fight, so the same inputs replay the same fight (tests, online) */
  private seed = 1;
  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  fighters: Fighter[];
  /** gravity as of the last step (figure heights / s²): the Mega leap aims with it */
  private gNow = 9.8 * G_SCALE;
  curr: SimState;
  prev: SimState;
  frame = 0;
  hitstop = 0;
  ai: "on" | "off" | "versus";
  /** the pre-drawn computer fighter in use (null: a drawn rival or the plain sketch) */
  rivalEntry: RosterEntry | null = null;
  private rivalId: RosterId | "auto" | null = null;
  private playerInk: InkStroke[] | null = null;
  /** fight time per frame relative to the old pace (SimOptions.pace) */
  pace = GAME_PACE;
  /** which KO ragdoll runs (SimOptions.physics, falls back to classic if Rapier failed to load) */
  koPhysics: "classic" | "rapier" = "classic";
  private fx: FxEvent[] = [];
  private impact = 0;
  private aiTimer = 0.6;
  private aiHold: { block: number; x: number } = { block: 0, x: 0 };
  private overTimer = 0;
  difficulty: Difficulty;
  countdownLength: number;
  countdown: number;
  sinceStart = 0;
  round = 1;
  wins: [number, number] = [0, 0];
  private scored = false;
  /** the rival's memory: when it noticed the player's current attack, and its recent hits */
  private aiSeen = -1;
  private aiDecided = false;
  private aiCombo = { n: 0, t: 0 };
  private aiBackOff = 0;
  /** test/debug hook: moves queued for the rival */
  forced: { who: number; move: string }[] = [];
  projectiles: Projectile[] = [];
  puddles: Puddle[] = [];
  /** the rival's power is picked from the player's drawing and the level ("auto"), so a new level redraws it */
  private rivalAuto: boolean;

  constructor(opts: SimOptions = {}) {
    const playerRig = (opts.player && inferRig(opts.player)) || inferRig(sketchFighter(3, "#2a241c"))!;
    this.ai = opts.ai ?? "on";
    this.difficulty = opts.difficulty ?? "normal";
    this.playerInk = opts.player ?? null;
    this.rivalAuto = !opts.rival && opts.rivalPower === "auto";
    const rivalPower = opts.rivalPower === "auto" ? rivalPowerFor(playerRig, this.difficulty) : opts.rivalPower ?? null;
    this.rivalId = opts.rival ? null : opts.rivalId ?? null;
    this.rivalEntry = this.rivalId ? (this.rivalId === "auto" ? pickRival(opts.player ?? null, this.difficulty) : rosterById(this.rivalId)) : null;
    const rivalRig = (opts.rival && inferRig(opts.rival)) || inferRig(rivalStrokes(this.rivalEntry?.signature ? null : rivalPower, this.rivalEntry?.strokes))!;
    this.fighters = [new Fighter(playerRig, "#2a241c", -1.1), new Fighter(rivalRig, "#1d4f89", 1.1)];
    this.koPhysics = opts.physics === "rapier" && physicsReady() ? "rapier" : "classic";
    for (const f of this.fighters) f.anim.physics = this.koPhysics;
    this.applySignature();
    this.fairRival();
    this.countdownLength = opts.countdown ?? 0;
    this.countdown = this.countdownLength;
    this.pace = Math.max(0.2, Math.min(2, opts.pace ?? GAME_PACE));
    this.curr = this.snapshot();
    this.prev = this.curr;
  }

  /** restart the round in progress (or the whole match with `match`), with a fresh countdown */
  reset(match = false) {
    for (const f of this.fighters) f.reset();
    this.hitstop = 0;
    this.overTimer = 0;
    this.scored = false;
    this.countdown = this.countdownLength;
    this.sinceStart = 0;
    this.aiTimer = 0.6;
    this.aiHold = { block: 0, x: 0 };
    this.aiSeen = -1;
    this.aiDecided = false;
    this.aiCombo = { n: 0, t: 0 };
    this.aiBackOff = 0;
    this.projectiles = [];
    this.puddles = [];
    if (match) {
      this.round = 1;
      this.wins = [0, 0];
    }
    this.prev = this.curr = this.snapshot();
  }

  /**
   * FNV-1a over the exact bits of the state that matters (positions, velocities, hp, cooldowns, the
   * round, every joint, projectiles). Lockstep clients compare it to catch a desync.
   */
  checksum(): number {
    const nums: number[] = [this.frame, this.round, this.wins[0], this.wins[1], this.hitstop, this.countdown];
    for (const f of this.fighters) {
      nums.push(f.x, f.y, f.vx, f.vy, f.hp, f.facing, f.cool, f.stun, f.ko ? 1 : 0, f.anim.time, f.scatter, f.slam ? 1 : 0);
      for (const j of f.anim.joints) nums.push(j.x, j.y);
    }
    for (const p of this.projectiles) nums.push(p.x, p.y, p.vx, p.life);
    for (const q of this.puddles) nums.push(q.x, q.t);
    const buf = new Float64Array(nums);
    const u8 = new Uint8Array(buf.buffer);
    let h = 0x811c9dc5;
    for (let i = 0; i < u8.length; i++) {
      h ^= u8[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /** free the Rapier worlds of any live ragdolls */
  dispose() {
    for (const f of this.fighters) f.anim.revive();
  }

  get matchWinner(): number | null {
    return this.wins[0] >= 2 ? 0 : this.wins[1] >= 2 ? 1 : null;
  }

  /** after a KO: the next round of the best-of-3, or a fresh match once someone has won two */
  rematch() {
    if (this.matchWinner !== null) this.reset(true);
    else {
      if (this.scored) this.round++;
      this.reset();
    }
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    if (this.rivalAuto || this.rivalId === "auto") {
      // the rival redraws its power for the new level (and an auto-picked opponent is re-picked)
      const power = this.rivalAuto ? rivalPowerFor(this.fighters[0].rig, d) : this.fighters[1].special;
      if (this.rivalId === "auto") this.rivalEntry = pickRival(this.playerInk, d);
      this.fighters[1] = new Fighter(inferRig(rivalStrokes(this.rivalEntry?.signature ? null : power ?? null, this.rivalEntry?.strokes))!, "#1d4f89", 1.1);
      this.fighters[1].anim.physics = this.koPhysics;
      this.applySignature();
      this.fairRival();
    } else this.applySignature();
  }

  /**
   * The big rivals come with their own special (Pumpkin, Bone scatter, Ground shake, Mega leap) instead of
   * drawing themselves a power to match yours. Easier levels wait longer between them; the damage is
   * scaled by the level like any rival special.
   */
  private applySignature() {
    const sig = this.rivalEntry?.signature;
    const f = this.fighters[1];
    if (!sig || !f) return;
    if (f.special !== sig) f.cool = Math.max(f.cool, 1.5);
    f.special = sig;
    f.element = null;
    f.powerMult = 1;
    f.coolMax = Math.round(POWER_INFO[sig].cooldown * SIGNATURE_COOL[this.difficulty] * 100) / 100;
  }

  /**
   * A pre-drawn opponent is as strong overall as the plain sketch rival with the same power (which the
   * difficulty levels are tuned against), times a small tier step (kid/dog a bit softer, the big guys a
   * bit tougher). Its own shape stays: which strike hits harder, its speed, reach and armour.
   */
  private fairRival() {
    const e = this.rivalEntry;
    const f = this.fighters[1];
    if (!e || !f) return;
    // the reference is the plain sketch rival without a power, so the players' power budget (POWER_EDGE)
    // and how strong each power is in the CPU's hands (RIVAL_POWER_STEP) are tuned separately
    const ref = computeStats(inferRig(rivalStrokes(null))!);
    const tier = ROSTER_TIER_STEP[e.tier] * (f.special ? RIVAL_POWER_STEP[f.special] ?? 1 : 1);
    const avg = (st: typeof ref) => (Object.values(st.dmg) as number[]).reduce((a, b) => a + b, 0) / Object.keys(st.dmg).length;
    const k = (avg(ref) / Math.max(0.2, avg(f.stats))) * tier;
    for (const key of Object.keys(f.stats.dmg) as (keyof typeof f.stats.dmg)[]) f.stats.dmg[key] = Math.round(f.stats.dmg[key] * k * 100) / 100;
    f.stats.hp = Math.round(ref.hp * tier);
    f.hp = f.stats.hp;
    if (e.size || e.stance) f.grow(e.size ?? 1, e.stance ?? null);
  }

  destroy() {
    this.fx = [];
    this.dispose();
  }

  drainFx(): { events: FxEvent[]; impact: number } {
    const out = { events: this.fx, impact: this.impact };
    this.fx = [];
    this.impact = 0;
    return out;
  }

  /** debug/test: make fighter `who` perform a move right now */
  force(who: number, move: string) {
    const f = this.fighters[who];
    if (move === "ko") {
      f.hp = 0;
      this.knockOut(f, this.fighters[1 - who], 1);
    } else if (move === "victory") {
      f.won = true;
      f.anim.play("victory");
    } else if (move === "jump") this.startJump(f);
    else if (move === "block") {
      f.blocking = true;
      f.anim.play("block");
    } else if (move === "crouch") {
      f.crouching = true;
      f.anim.play("crouch");
    } else if (move === "idle") {
      f.blocking = f.crouching = false;
      f.anim.play("idle");
    } else if (move === "punch" || move === "kick") {
      this.startAttack(f, f.anim.attack(move));
    } else if (isAttack(move as MoveName)) {
      f.anim.play(move as MoveName);
      this.startAttack(f, move as MoveName);
    } else {
      f.struck = false;
      f.anim.play(move as MoveName);
    }
  }

  /** wind-up bookkeeping shared by buttons, the CPU and tests */
  private startAttack(f: Fighter, move: MoveName) {
    f.struck = false;
    f.leapt = false;
    f.blocking = f.crouching = false;
    const spec = SPECS[move];
    if (spec) f.lunge = { ...spec.lunge(f), v: spec.lunge(f).v * f.facing };
    // a big body's long limbs reach: it doesn't hurl its bulk forward as far
    if (spec && f.anim.attackLean < 1 && (spec.striker === "punch" || spec.striker === "kick")) {
      f.lunge = { ...f.lunge, v: f.lunge.v * f.anim.attackLean };
    }
    // the player gets a forgiving step-in: a strike thrown from just out of reach closes the gap
    // (the CPU doesn't need the help). Only on the ground, and only toward a foe that's in front.
    const foeF = this.fighters[f === this.fighters[0] ? 1 : 0];
    if ((f === this.fighters[0] || this.ai === "versus") && spec && !f.airborne && !spec.leap) {
      const gap = (foeF.x - f.x) * f.facing - f.rig.extent.front - foeF.rig.extent.front;
      const reach = spec.striker === "kick" ? 0.32 : spec.striker === "punch" ? 0.22 : 0.12;
      const short = gap - reach;
      if (short > 0 && short < 0.6) {
        const t = Math.max(f.lunge.t, 0.18);
        const v = Math.max(Math.abs(f.lunge.v), Math.min(2.6, short / t + 0.3));
        f.lunge = { v: v * f.facing, t };
      }
    }
    // aim straight strikes at the middle of the foe's drawn body (a low car, a snake on the ground)
    f.anim.aim = 0;
    f.anim.aimAt = null;
    if (move === "punch" || move === "kick") {
      const foe = this.fighters[f === this.fighters[0] ? 1 : 0];
      // aim at the foe's leading edge: the band of its ink nearest to us
      const ink = fightStrokes(foe.rig, foe.anim.joints, foe.anim.deform).flatMap((s) => s.points.map((p) => foe.world(p)));
      const near = Math.min(...ink.map((p) => Math.abs(p.x - f.x)));
      const band = ink.filter((p) => Math.abs(p.x - f.x) < near + 0.3);
      const ys = band.map((p) => p.y);
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
      const top = Math.max(...ys);
      const aimY = Math.min(top - 0.04, Math.max(mid, top - 0.35));
      const from = f.world(f.anim.joints[move === "punch" ? J.shF : J.hipF]);
      const dx = Math.max(0.15, near - f.rig.extent.front * 0.3);
      const natural = move === "punch" ? from.y - 0.02 : from.y + 0.05;
      const want = Math.atan2(aimY - from.y, dx) - Math.atan2(natural - from.y, dx);
      f.anim.aim = Math.max(-1.3, Math.min(0.3, want));
    }
    this.fx.push({ kind: "whoosh", ...f.world(f.anim.joints[move === "kick" ? J.pelvis : J.chest]), dir: f.facing, move, heavy: f.size > 1.1 });
  }

  /** one fixed frame; in "versus" mode `input2` drives the second fighter (player 2) */
  step(input: PlayerInput, tuning: Tuning = DEFAULT_TUNING, input2?: PlayerInput) {
    // fight time runs at the game pace; the countdown and the between-rounds pause in real time
    const dt = SIM_DT * this.pace;
    this.prev = this.curr;
    this.frame++;
    if (this.hitstop > 0) {
      // freeze the sim (hit-stop) but keep the snapshot fresh
      this.hitstop--;
      this.curr = this.snapshot();
      return;
    }
    this.gNow = tuning.gravity * G_SCALE; // the mega leap aims with this frame's gravity
    const [me, foe] = this.fighters;
    const over = me.ko || foe.ko;
    // "3-2-1 FIGHT!": nobody acts (and the rival does not think) until the countdown is over
    const waiting = this.countdown > 0;
    if (waiting) this.countdown = Math.max(0, this.countdown - SIM_DT);
    else this.sinceStart += dt;
    this.control(me, over || waiting ? NO_INPUT : input, tuning);
    this.control(foe, over || waiting ? NO_INPUT : this.ai === "versus" ? input2 ?? NO_INPUT : this.think(foe, me), tuning);
    for (const f of this.fighters) this.physics(f, tuning, dt);
    this.separate();
    const pre = this.fighters.map((f) => ({ move: f.anim.move as string, active: f.anim.active }));
    for (const [i, f] of this.fighters.entries()) this.strike(f, f === me ? foe : me, tuning, pre[i]);
    this.powers(dt, over || waiting);
    if ((me.ko || foe.ko) && !this.scored) {
      this.scored = true;
      if (me.ko && !foe.ko) this.wins[1]++;
      else if (foe.ko && !me.ko) this.wins[0]++;
    }
    if (over) {
      this.overTimer += SIM_DT;
      const winner = me.ko ? foe : me;
      if (!winner.ko && !winner.won && this.overTimer > 0.9 && !winner.airborne) {
        winner.won = true;
        winner.blocking = winner.crouching = false;
        winner.anim.play("victory");
      }
    }
    this.curr = this.snapshot();
  }

  private snapshot(): SimState {
    const [me, foe] = this.fighters;
    return {
      frame: this.frame,
      playerHp: me.hp,
      bagHp: foe.hp,
      playerMax: me.stats.hp,
      bagMax: foe.stats.hp,
      fighters: this.fighters.map((f) => f.snap()),
      over: me.ko || foe.ko,
      winner: me.ko && foe.ko ? null : me.ko ? 1 : foe.ko ? 0 : null,
      countdown: this.countdown,
      sinceStart: this.sinceStart,
      round: this.round,
      wins: [this.wins[0], this.wins[1]],
      matchWinner: this.matchWinner,
      projectiles: this.projectiles.map((p) => ({ ...p })),
      puddles: this.puddles.map((p) => ({ ...p })),
    };
  }

  private startJump(f: Fighter) {
    if (f.airborne || f.pendingJump >= 0 || f.ko) return;
    f.anim.play("jumpCrouch");
    f.pendingJump = 0.11; // anticipation crouch before take-off
  }

  private control(f: Fighter, input: PlayerInput, tuning: Tuning) {
    if (f.ko) return;
    const other = this.fighters[f === this.fighters[0] ? 1 : 0];
    if (!f.airborne && !other.ko) f.facing = other.x >= f.x ? 1 : -1;
    if (f.won) {
      f.vx = 0;
      return;
    }
    const busy = f.anim.busy && (isAttack(f.anim.move) || f.anim.move === "hit" || f.anim.move === "hitLow" || f.anim.move === "jumpCrouch");
    const stunned = f.stun > 0 || f.scatter > 0;
    // held states
    const wantBlock = !!input.block && !f.airborne && !stunned;
    const wantCrouch = !!input.crouch && !f.airborne && !stunned && !wantBlock;
    if (wantBlock !== f.blocking) {
      f.blocking = wantBlock;
      if (!busy || wantBlock) f.anim.play(wantBlock ? "block" : "idle");
    }
    if (wantCrouch !== f.crouching) {
      f.crouching = wantCrouch;
      if (!busy || wantCrouch) f.anim.play(wantCrouch ? "crouch" : "idle");
    }
    if (!f.blocking && !f.crouching && !f.airborne && !busy && (f.anim.base === "block" || f.anim.base === "crouch")) f.anim.play("idle");

    // frozen by ice, or wading through the other side's puddle: slower
    const wading = this.puddles.some((p) => p.owner !== this.fighters.indexOf(f) && Math.abs(f.x - p.x) < p.w && !f.airborne);
    const speed = tuning.walkSpeed * 0.62 * f.stats.speed * (f.frozen > 0 ? 0.5 : 1) * (wading ? 0.55 : 1);
    if (!f.airborne) {
      const canWalk = !busy && !stunned && !f.blocking && !f.crouching && f.pendingJump < 0;
      const target = canWalk ? input.x * speed * (input.x * f.facing < 0 ? 0.8 : 1) : 0;
      // friction / acceleration toward the target speed
      const accel = (tuning.walkForce / 60) * 14;
      const dv = target - f.vx;
      f.vx += Math.sign(dv) * Math.min(Math.abs(dv), accel * SIM_DT * this.pace);
    } else {
      f.vx += (input.x * speed - f.vx) * Math.min(1, SIM_DT * this.pace * 3);
    }
    // keep a punch steered at the nearest bit of the foe's drawn body while it extends
    if (f.anim.move === "punch" && f.anim.busy) f.anim.aimAt = this.punchTarget(f, other);
    if (stunned) return;
    if (input.jump && !busy) this.startJump(f);
    // wings: a second jump in the air
    if (input.jump && f.airborne && f.airJumps > 0 && f.dive === 0 && f.passives.has("wings")) {
      f.airJumps--;
      f.vy = Math.sqrt(2 * tuning.gravity * G_SCALE * 0.4) * f.stats.jump;
      this.fx.push({ kind: "jump", x: f.x, y: f.y });
    }
    if (input.special && !busy && f.special && f.cool <= 0 && f.pendingJump < 0 && f.dash.t <= 0 && f.dive === 0) this.startSpecial(f, other);
    if ((input.punch || input.kick) && !busy && f.pendingJump < 0) {
      // each body picks its own move: a dog bites (or charges when running in), a blob slams, a car rams …
      const running = !f.airborne && f.vx * f.facing > speed * 0.6 && Math.abs(other.x - f.x) > 0.5 + f.rig.extent.front + other.rig.extent.front;
      const move = f.anim.attack(input.punch ? "punch" : "kick", { air: f.airborne, running: running && !!input.punch });
      this.startAttack(f, move);
    }
  }

  private physics(f: Fighter, tuning: Tuning, dt: number) {
    const g = tuning.gravity * G_SCALE;
    this.gNow = g;
    f.stun = Math.max(0, f.stun - dt);
    if (f.pendingJump >= 0) {
      f.pendingJump -= dt;
      if (f.pendingJump < 0) {
        f.vy = Math.sqrt(2 * g * 0.5) * f.stats.jump;
        f.y = 0.0002;
        this.fx.push({ kind: "jump", x: f.x, y: 0 });
      }
    }
    if (f.airborne) {
      f.vy -= g * dt;
      f.y += f.vy * dt;
      if (f.y <= 0) {
        f.y = 0;
        f.vy = 0;
        this.fx.push({ kind: "land", x: f.x, y: 0 });
        if (f.dive === 2) f.lunge = { v: f.lunge.v * 0.5, t: Math.min(f.lunge.t, 0.12) };
        f.dive = 0;
        if (f.slam) this.slamDown(f);
      }
    }
    if (f.lunge.t > 0) {
      f.lunge.t -= dt;
      f.vx = f.lunge.v;
      // a punch / kick step-in stops where the body meets the foe's body: the fist or foot does the reaching
      if (this.limbStrike(f) && !f.airborne) {
        const foe = this.fighters[f === this.fighters[0] ? 1 : 0];
        if (!foe.ko && (big(f) || big(foe)) && Math.sign(foe.x - f.x) === Math.sign(f.lunge.v) && this.bodyGap(f, foe) < BODY_STOP) f.vx = 0;
      }
    }
    if (f.dash.t > 0) {
      f.dash.t -= dt;
      f.vx = f.dash.v;
      if (f.dash.t <= 0) f.vx = f.dash.v * 0.2;
    }
    // wings: climb, then dive at the foe; a slow glide when falling
    if (f.dive === 1 && f.vy < 0.5) {
      const foe = this.fighters[f === this.fighters[0] ? 1 : 0];
      f.dive = 2;
      f.facing = foe.x >= f.x ? 1 : -1;
      // swoop down onto the foe: steer so the landing is right on it
      f.vy = -1.4;
      const g = tuning.gravity * G_SCALE;
      const tLand = (f.vy + Math.sqrt(f.vy * f.vy + 2 * g * f.y)) / g;
      const aim = foe.x - f.facing * (f.rig.extent.front + foe.rig.extent.front) * 0.5;
      f.lunge = { v: Math.max(-6, Math.min(6, (aim - f.x) / Math.max(0.12, tLand))), t: 1 };
    }
    if (f.passives.has("wings") && f.dive === 0 && f.vy < -0.9 && f.airborne) f.vy = -0.9;
    // leaping attacks (a pounce) launch partway through the wind-up
    const leap = SPECS[f.anim.move]?.leap;
    if (leap && !f.leapt && !f.ko && f.anim.time >= leap.at && !f.airborne) {
      f.leapt = true;
      f.vy = leap.vy;
      f.y = 0.0002;
      f.lunge = { v: leap.vx * f.facing, t: 0.4 };
      this.fx.push({ kind: "jump", x: f.x, y: 0 });
    }
    f.x += f.vx * dt;
    if (f.ko) f.vx *= 0.9;
    const [lo, hi] = wallBounds(f);
    f.x = Math.max(lo, Math.min(hi, f.x));
    if (!f.airborne) f.airJumps = 1;
    if (f.anim.ragdoll instanceof RapierRagdoll) {
      // the winner's bones are solid to the falling body
      const o = this.fighters[f === this.fighters[0] ? 1 : 0];
      const loc = (q: Pt): Pt => ({ x: (o.x + o.facing * q.x - f.x) * f.facing, y: o.y + q.y - f.y });
      f.anim.ragdoll.setFoe(BONE_PAIRS.map(([a, b]) => [loc(o.anim.joints[a]), loc(o.anim.joints[b])] as [Pt, Pt]));
    }
    f.anim.update(f.frozen > 0 ? dt * 0.6 : dt, {
      speed: f.airborne ? 0 : f.vx * f.facing,
      air: f.airborne ? { vy: f.vy } : null,
      tuning: { wn: tuning.balanceWn, zeta: tuning.balanceZeta, muscle: tuning.muscleScale, damping: tuning.dampingScale, gravity: tuning.gravity },
    });
  }

  private separate() {
    const [a, b] = this.fighters;
    if (a.ko || b.ko) return;
    // a lightning dash goes straight through
    if ((a.dash.t > 0 && a.dash.kind === "lightning") || (b.dash.t > 0 && b.dash.kind === "lightning")) return;
    // keep the drawn bodies apart (a long dog or a wide blob needs more room than a stick man)
    const front = (f: Fighter) => f.rig.extent.front;
    // push boxes shrink while someone is mid-attack, so lunges and headbutts can land
    const attacking = (f: Fighter) => f.lunge.t > 0 || f.anim.active;
    const hitting = a.anim.active || b.anim.active;
    // only the gap shrinks (a long snake must not let the foe walk over it)
    let min = front(a) + front(b) + (hitting ? 0.03 : attacking(a) || attacking(b) ? 0.1 : 0.18);
    const d = b.x - a.x;
    if (Math.abs(d) < min && Math.abs(a.y - b.y) < 0.6) {
      const push = (min - Math.abs(d)) / 2;
      const s = Math.sign(d) || 1;
      a.x -= s * push;
      b.x += s * push;
    }
    // a big body throwing a punch / kick doesn't barge in: its body as drawn right now (a leaning chest) stops
    // short of the foe's and the fist or foot does the reaching. Only the attacker gives way (the foe isn't shoved).
    for (const [att, vic] of [[a, b], [b, a]] as const) {
      if (!big(att) || !this.limbStrike(att) || Math.abs(att.y - vic.y) >= 0.6) continue;
      const s = Math.sign(vic.x - att.x) || 1;
      const need = this.bodyFront(att, s) + this.bodyFront(vic, -s) + BODY_TOUCH - Math.abs(vic.x - att.x);
      if (need <= 0) continue;
      const [lo, hi] = wallBounds(att);
      const room = s > 0 ? att.x - lo : hi - att.x;
      const back = Math.min(need, Math.max(0, room));
      att.x -= s * back;
      vic.x += s * (need - back);
    }
  }

  /** a punch or kick in progress (the limb strikes; the body should not barge into the foe) */
  private limbStrike(f: Fighter) {
    if (!f.anim.busy || f.ko) return false;
    const st = SPECS[f.anim.move]?.striker;
    if (st !== "punch" && st !== "kick") return false;
    // a body whose "punch" is its head (a dog's lunge) strikes with the body: no stop for it
    const tip = f.rig.strike[st];
    return tip === J.handF || tip === J.handB || tip === J.footF || tip === J.footB;
  }

  /** how far the body (torso + head ink, and a drawn solid chest) reaches from f.x toward `dir` right now */
  private bodyFront(f: Fighter, dir: number) {
    const solid = new Set(f.rig.solid ?? []);
    let m = 0;
    skinStrokes(f.rig, f.anim.joints, f.anim.deform).forEach((st, i) => {
      if (st.label === "costume" && !solid.has(i)) return;
      const src = f.rig.strokes[i]?.points;
      st.points.forEach((p, k) => {
        const b = src?.[k]?.b0 ?? -1;
        if (b === 0 || b === 1) m = Math.max(m, p.x * f.facing * dir);
      });
    });
    return m;
  }

  /** the gap between the two bodies as drawn right now (limbs not counted) */
  private bodyGap(f: Fighter, foe: Fighter) {
    const s = Math.sign(foe.x - f.x) || 1;
    return Math.abs(foe.x - f.x) - this.bodyFront(f, s) - this.bodyFront(foe, -s);
  }

  /** the closest point of the foe's ink to our shoulder, a little past it (figure space), or null when out of range */
  private punchTarget(f: Fighter, foe: Fighter): Pt | null {
    const sh = f.anim.joints[J.shF];
    const reach = f.rig.shape.upperArmF + f.rig.shape.foreArmF;
    let best: Pt | null = null;
    let bd = Infinity;
    let bestScore = Infinity;
    for (const s of fightStrokes(foe.rig, foe.anim.joints, foe.anim.deform)) {
      for (let i = 0; i < s.points.length; i += 2) {
        const w = foe.world(s.points[i]);
        const p = { x: (w.x - f.x) * f.facing, y: w.y - f.y };
        if (p.x < sh.x - 0.02) continue;
        const d = Math.hypot(p.x - sh.x, p.y - sh.y);
        // prefer the upper body of a standing foe (a jab to the face), but take what's there on a low one
        const score = d + 0.6 * Math.max(0, sh.y - 0.08 - p.y);
        if (score < bestScore) {
          bestScore = score;
          bd = d;
          best = p;
        }
      }
    }
    if (!best || bd > reach * 2.2) return null;
    const dir = { x: (best.x - sh.x) / (bd || 1), y: (best.y - sh.y) / (bd || 1) };
    return { x: best.x + dir.x * 0.04, y: best.y + dir.y * 0.04 };
  }

  /** world-space sample points of whatever is doing the hitting this frame */
  private strikerPoints(att: Fighter, striker: Striker): Pt[] {
    const aj = att.anim.joints;
    const chain = (tipJ: number) => {
      const midJ = tipJ === J.footF ? J.kneeF : tipJ === J.footB ? J.kneeB : tipJ === J.handF ? J.elbowF : tipJ === J.handB ? J.elbowB : J.chest;
      const rootJ = midJ === J.elbowF ? J.shF : midJ === J.elbowB ? J.shB : midJ === J.kneeF ? J.hipF : midJ === J.kneeB ? J.hipB : J.chest;
      // the whole striking segment (fist→forearm, foot→shin) can connect, not just the tip
      return [...[0.5, 1].map((k) => lerpPt(aj[rootJ], aj[midJ], k)), ...[0.25, 0.5, 0.75, 1].map((k) => lerpPt(aj[midJ], aj[tipJ], k))].map((p) => att.world(p));
    };
    if (striker === "punch") return chain(att.rig.strike.punch);
    if (striker === "kick") return chain(att.rig.strike.kick);
    const rig = att.rig;
    const ink = fightStrokes(rig, aj, att.anim.deform);
    const pick = (keep: (i: number) => boolean, pointOk: (i: number, k: number) => boolean = () => true) => {
      const out: Pt[] = [];
      ink.forEach((s, i) => {
        if (!keep(i)) return;
        for (let k = 0; k < s.points.length; k += 2) if (pointOk(i, k)) out.push(att.world(s.points[k]));
      });
      return out;
    };
    const isHead = (i: number) => rig.strokes[i].part === "head";
    const isBody = (i: number) => rig.strokes[i].part === "torso";
    let pts: Pt[] = [];
    if (striker === "weapon" && rig.weapon) pts = [...pick((i) => rig.weapon!.strokes.includes(i)), ...chain(rig.weapon.limb === "armF" ? J.handF : J.handB)];
    else if (striker === "head") pts = pick(isHead);
    else if (striker === "tail") pts = rig.tail.length ? pick((i) => rig.tail.includes(i)) : pick(isBody, (i, k) => rig.strokes[i].points[k].t0 < 0.4);
    else if (striker === "body") pts = pick((i) => isBody(i) || isHead(i));
    else if (striker === "front") pts = pick((i) => isHead(i) || rig.strokes[i].part === "aux" || isBody(i), (i, k) => !isBody(i) || rig.strokes[i].points[k].t0 > 0.55);
    // no ink for that part (an invisible head): fall back to the chest → crown line
    if (pts.length === 0) pts = [0.5, 1].map((k) => att.world(lerpPt(aj[J.chest], aj[J.crown], k)));
    return pts;
  }

  private strike(att: Fighter, vic: Fighter, tuning: Tuning, pre?: { move: string; active: boolean }) {
    // `pre`: the attacker's move as the frame began, so two blows thrown together both land (a trade)
    const move = (pre?.move ?? att.anim.move) as typeof att.anim.move;
    const spec = SPECS[move];
    if (att.ko || !spec || !isAttack(move)) {
      att.tip = null;
      return;
    }
    const samples = this.strikerPoints(att, spec.striker);
    // the leading edge, for smear trails: a weapon's far end, otherwise the most forward point
    const anchor = spec.striker === "weapon" ? att.world(att.anim.joints[att.rig.weapon?.limb === "armB" ? J.handB : J.handF]) : null;
    att.tip = samples.reduce((a, p) => (anchor ? Math.hypot(p.x - anchor.x, p.y - anchor.y) > Math.hypot(a.x - anchor.x, a.y - anchor.y) : (p.x - a.x) * att.facing > 0) ? p : a, samples[0]);
    if (vic.ko || att.struck || !(pre?.active ?? att.anim.active)) return;
    // a skeleton lying in a pile of bones: the blow passes through
    if (vic.scatter > 0) return;
    // hurtbox = the victim's actual bones (its drawn proportions)
    let d = Infinity;
    let tip = att.tip;
    let part: PartKey = "torso";
    const vj = vic.anim.joints;
    for (const [a, b, p] of [[J.pelvis, J.chest, "torso"], [J.chest, J.crown, "head"], [J.shF, J.elbowF, "armF"], [J.elbowF, J.handF, "armF"], [J.shB, J.elbowB, "armB"], [J.hipF, J.kneeF, "legF"], [J.hipB, J.kneeB, "legB"], [J.kneeF, J.footF, "legF"], [J.kneeB, J.footB, "legB"]] as const) {
      if (!vic.rig.found.legF && (a === J.hipF || a === J.kneeF)) continue;
      if (!vic.rig.found.legB && (a === J.hipB || a === J.kneeB)) continue;
      const A = vic.world(vj[a]);
      const B = vic.world(vj[b]);
      for (const q of samples) {
        const e = segDist(q, A, B);
        if (e < d) {
          d = e;
          tip = q;
          part = p;
        }
      }
    }
    // the player's strikes get a little extra tolerance: near misses count
    const slack = att === this.fighters[0] || this.ai === "versus" ? 0.035 : 0;
    if (d > 0.075 + (move === "kick" ? 0.02 : 0) + slack) {
      // the drawn ink is the hurtbox too: a blob's outline, a dog's snout, a big hat, a car's bumper
      let inkD = Infinity;
      for (const s of fightStrokes(vic.rig, vj, vic.anim.deform)) {
        const p: PartKey = s.label === "weapon" || s.label === "weapon part" ? "weapon" : s.label === "tail" ? "tail" : s.part === "head" ? "head" : s.part === "armF" || s.part === "armB" || s.part === "legF" || s.part === "legB" ? s.part : "torso";
        for (let i = 0; i < s.points.length; i += 2) {
          const w = vic.world(s.points[i]);
          for (const q of samples) {
            const e = Math.hypot(w.x - q.x, w.y - q.y);
            if (e < inkD) {
              inkD = e;
              tip = q;
              part = p;
            }
          }
        }
      }
      if (inkD > 0.07 + slack) return;
    }
    att.struck = true;
    const chestY = vic.world(vic.anim.joints[J.chest]).y;
    const high = tip.y > chestY - 0.05;
    const dir = att.facing;
    // difficulty: the rival hits softer on Easy/Normal, the player a bit harder (tests run on the raw numbers with the AI off)
    const prof = AI_PROFILES[this.difficulty];
    const scale = this.ai !== "on" ? 1 : att === this.fighters[0] ? prof.playerDmg : prof.rivalDmg;
    // the drawings' own stats: a dark striking limb hits harder, a dark part that gets hit takes less
    const base = spec.dmg * scale * att.stats.dmg[spec.striker] * vic.stats.armour[part];
    const front = (vic.x - att.x) * vic.facing < 0; // victim faces the attacker
    if (vic.blocking && front) {
      // a drawn shield takes the whole blow
      const dmg = base * (vic.passives.has("shield") ? 0.04 : 0.15);
      vic.hp = Math.max(0, vic.hp - dmg);
      vic.anim.play("blockHit");
      vic.vx = dir * 0.6;
      this.hitstop = Math.round(2 * tuning.hitStopScale);
      this.fx.push({ kind: "block", ...tip, power: dmg });
      this.impact += 0.15;
      return;
    }
    const dmg = base * (vic.crouching && high ? 0 : 1);
    if (dmg === 0) return; // ducked under it
    vic.hp = Math.max(0, vic.hp - dmg);
    vic.blocking = vic.crouching = false;
    // spikes: hitting a spiky fighter hurts the hand that hits
    if (vic.passives.has("spikes") && !att.ko) {
      const prof = AI_PROFILES[this.difficulty];
      const gift = this.ai === "on" && vic === this.fighters[1] ? prof.rivalSpecial : 1;
      const back = Math.max(0.5, dmg * 0.12 * gift * (vic.stats.powers.find((p) => p.kind === "spikes")?.strength ?? 1));
      att.hp = Math.max(1, att.hp - back);
    }
    const kb = spec.kb * (spec.dmg >= 13 ? tuning.kickImpulse / 1.6 : tuning.jabImpulse) * 1.1;
    vic.vx = dir * kb;
    vic.stun = 0.32;
    // hit-stop grows with the blow: a jab ~3 frames, a big hit up to 10
    this.hitstop = Math.min(10, Math.round((2 + dmg / 5) * tuning.hitStopScale));
    this.impact += dmg / 18;
    this.fx.push({ kind: "hit", ...tip, power: dmg, low: !high, word: spec.word, who: this.fighters.indexOf(vic), move, heavy: att.size > 1.1 });
    if (att === this.fighters[1]) {
      // the rival counts its hits in a row; after a combo it backs off and lets the player breathe
      this.aiCombo = this.sinceStart - this.aiCombo.t < 1.6 ? { n: this.aiCombo.n + 1, t: this.sinceStart } : { n: 1, t: this.sinceStart };
      if (this.aiCombo.n >= prof.combo) {
        this.aiBackOff = prof.backOff;
        this.aiCombo = { n: 0, t: this.sinceStart };
      }
    }
    if (vic.hp <= 0) this.knockOut(vic, att, kb);
    else vic.anim.play(high ? "hit" : "hitLow");
  }

  // ------------------------------------------------------------- powers (drawn add-ons)
  private startSpecial(f: Fighter, foe: Fighter) {
    const kind = f.special!;
    f.cool = f.coolMax;
    f.blocking = f.crouching = false;
    const dir = f.facing;
    this.fx.push({ kind: "special", ...f.world(f.anim.joints[J.chest]), power: kind, dir });
    // the body throws / lunges with its own attack animation; the special does the hitting, not the limb
    const cast = (which: "punch" | "kick", air = false) => {
      const mv = f.anim.attack(which, { air });
      f.struck = true;
      f.leapt = true;
      f.lunge = { v: 0, t: 0 };
      return mv;
    };
    if (kind === "fire" || kind === "water" || kind === "ice") {
      cast("punch");
      f.pendingShot = { t: 0.12, kind };
    } else if (kind === "lightning") {
      cast("kick");
      f.dash = { t: 0.28, v: 5.6 * dir, kind, hit: false };
    } else if (kind === "shield") {
      f.anim.play("block");
      f.dash = { t: 0.26, v: 3.2 * dir, kind, hit: false };
    } else if (kind === "wings") {
      if (!f.airborne) {
        f.vy = 2.3 * f.stats.jump;
        f.y = 0.0002;
        this.fx.push({ kind: "jump", x: f.x, y: 0 });
      }
      f.dive = 1;
      f.diveHit = false;
      cast("kick", true);
    } else if (kind === "spikes") {
      cast("punch");
      const gap = Math.abs(foe.x - f.x) - f.rig.extent.front - foe.rig.extent.front;
      if (gap < 0.65 && Math.abs(foe.y - f.y) < 0.6) this.specialHit(f, foe, "spikes", 7, 2.4, 0.3, f.world(f.anim.joints[J.chest]));
    } else if (kind === "pumpkin") {
      cast("punch");
      f.pendingShot = { t: 0.16, kind: "pumpkin" };
    } else if (kind === "quake") {
      // a heavy stomp: the shockwave leaves the foot as it comes down
      cast("kick");
      f.pendingShot = { t: 0.2, kind: "quake" };
    } else if (kind === "bones") {
      f.anim.play("crouch");
      f.scatter = SCATTER_T;
      f.vx = 0;
    } else if (kind === "leap") {
      // a huge jump that lands just short of the foe
      const g = this.gNow;
      // about a figure-height high whatever the gravity, landing right on top of the foe's front
      const vy = Math.sqrt(2 * g * 1.0);
      const air = (2 * vy) / g;
      const aim = foe.x - dir * (f.rig.extent.front + foe.rig.extent.front) * 0.35;
      const vx = Math.max(-4.2, Math.min(4.2, (aim - f.x) / air));
      f.vy = vy;
      f.y = 0.0002;
      f.dash = { t: air, v: vx, kind: "leap", hit: true };
      f.slam = true;
      cast("kick", true);
      this.fx.push({ kind: "jump", x: f.x, y: 0 });
    }
  }

  /** a special lands: block/shield, element counters, the power's own effect, K.O. */
  private specialHit(att: Fighter, vic: Fighter, kind: PowerKind, dmg0: number, kb: number, stun: number, at: Pt, shot = false) {
    if (vic.ko || vic.scatter > 0) return;
    const prof = AI_PROFILES[this.difficulty];
    const scale = this.ai === "on" ? (att === this.fighters[0] ? prof.playerDmg : prof.rivalDmg * prof.rivalSpecial) : 1;
    const elem = kind === "fire" || kind === "water" || kind === "lightning" || kind === "ice" ? kind : null;
    const counter = elementMult(elem, vic.element);
    let dmg = dmg0 * scale * att.powerMult * att.stats.bodyScale * counter * vic.stats.armour.torso;
    const dir = Math.sign(vic.x - att.x) || att.facing;
    const front = (vic.x - att.x) * vic.facing < 0;
    const color = { fire: "#e07a2f", water: "#1d4f89", lightning: "#c4962c", ice: "#3f7fbf", wings: "#2a241c", shield: "#2a241c", spikes: "#2a241c", pumpkin: "#e07a2f", bones: "#2a241c", quake: "#8a5a32", leap: "#2a241c" }[kind];
    if (vic.blocking && front) {
      // a drawn shield stops shots and specials cold; a bare block takes a little
      dmg *= vic.passives.has("shield") ? 0 : 0.2;
      vic.hp = Math.max(0, vic.hp - dmg);
      vic.anim.play("blockHit");
      vic.vx = dir * 0.8;
      this.hitstop = 2;
      this.fx.push({ kind: "block", ...at, power: dmg });
      if (vic.hp <= 0) this.knockOut(vic, att, kb);
      return;
    }
    if (shot && vic.passives.has("shield")) dmg *= 0.75;
    vic.hp = Math.max(0, vic.hp - dmg);
    vic.blocking = vic.crouching = false;
    vic.vx = dir * kb;
    vic.stun = Math.max(vic.stun, stun);
    if (kind === "fire") vic.burn = { t: 1.6, dps: 2.2 * att.powerMult, by: this.fighters.indexOf(att) };
    if (kind === "water") vic.burn.t = 0; // puts the fire out
    if (kind === "ice") vic.frozen = 1.7 * att.powerMult;
    if (kind === "water") this.puddles.push({ x: vic.x, w: 0.45, t: 3, owner: this.fighters.indexOf(att) });
    this.hitstop = Math.min(10, Math.round(3 + dmg / 5));
    this.impact += dmg / 16;
    const word = counter > 1 ? `${POWER_INFO[kind].word.replace("!", "")} ×1.5!` : POWER_INFO[kind].word;
    this.fx.push({ kind: "hit", ...at, power: dmg, low: false, word, color, who: this.fighters.indexOf(vic), heavy: att.size > 1.1 });
    if (vic.hp <= 0) this.knockOut(vic, att, kb);
    else vic.anim.play("hit");
  }

  /** shots in flight, dashes, dives, burns, puddles */
  private powers(dt: number, frozenTime: boolean) {
    const F = this.fighters;
    for (const [i, f] of F.entries()) {
      const foe = F[1 - i];
      if (!frozenTime) f.cool = Math.max(0, f.cool - dt);
      f.frozen = Math.max(0, f.frozen - dt);
      if (f.burn.t > 0 && !f.ko) {
        f.burn.t -= dt;
        f.hp = Math.max(0, f.hp - f.burn.dps * dt);
        if (f.hp <= 0) this.knockOut(f, F[f.burn.by] ?? foe, 0.5);
      }
      if (f.ko) {
        f.dash.t = 0;
        f.dive = 0;
        continue;
      }
      // the throw leaves the hand partway through the wind-up
      if (f.pendingShot.t >= 0) {
        f.pendingShot.t -= dt;
        if (f.pendingShot.t < 0 && f.pendingShot.kind) {
          const k = f.pendingShot.kind;
          const hand = f.world(f.anim.joints[f.rig.strike.punch]);
          if (k === "pumpkin") {
            // lobbed in an arc that comes down on the foe's chest (aimed where the foe stands now)
            const x0 = f.x + f.facing * (f.rig.extent.front + 0.06);
            const y0 = Math.max(0.45, Math.min(0.8, hand.y + 0.05));
            const g = PUMPKIN_G;
            const dx = Math.max(0.25, Math.min(3.4, Math.abs(foe.x - x0)));
            const vx = Math.max(1.1, Math.min(2.3, dx / 0.55)); // a short toss still hangs in the air a moment
            const T = dx / vx;
            const vy = (0.42 - y0 + 0.5 * g * T * T) / T;
            this.projectiles.push({ kind: "pumpkin", owner: i, x: x0, y: y0, vx: vx * f.facing, vy, r: 0.085, life: 2.4, dmg: 10, g });
          } else if (k === "quake") {
            this.projectiles.push({ kind: "quake", owner: i, x: f.x + f.facing * (f.rig.extent.front + 0.04), y: 0.05, vx: 2.9 * f.facing, vy: 0, r: 0.13, life: 1.25, dmg: 8 });
            this.impact += 0.55;
            this.fx.push({ kind: "land", x: f.x + f.facing * 0.15, y: 0 });
          } else {
            const y = k === "water" ? 0.2 : Math.max(0.3, Math.min(0.55, hand.y));
            const spec = { fire: { v: 3.3, r: 0.075, dmg: 9 }, water: { v: 2.6, r: 0.2, dmg: 7 }, ice: { v: 3.0, r: 0.065, dmg: 8 }, lightning: { v: 0, r: 0, dmg: 0 } }[k];
            this.projectiles.push({ kind: k, owner: i, x: f.x + f.facing * (f.rig.extent.front + 0.08), y, vx: spec.v * f.facing, vy: 0, r: spec.r, life: 1.6, dmg: spec.dmg });
          }
          f.pendingShot = { t: -1, kind: null };
        }
      }
      // Bone scatter: back together a step forward, with a bony strike
      if (f.scatter > 0) {
        f.scatter -= dt;
        f.vx = 0;
        if (f.scatter <= 0) {
          f.scatter = 0;
          f.facing = foe.x >= f.x ? 1 : -1;
          const room = Math.max(0, Math.abs(foe.x - f.x) - f.rig.extent.front - foe.rig.extent.front - 0.05);
          f.x += f.facing * Math.min(SCATTER_STEP, room);
          const [lo, hi] = wallBounds(f);
          f.x = Math.max(lo, Math.min(hi, f.x));
          f.anim.attack("punch", { air: false });
          f.struck = true;
          f.lunge = { v: 0, t: 0 };
          this.fx.push({ kind: "special", ...f.world(f.anim.joints[J.chest]), power: "bones", dir: f.facing });
          const near = Math.abs(foe.x - f.x) - f.rig.extent.front - foe.rig.extent.front;
          if (near < 0.45 && Math.abs(foe.y - f.y) < 0.6) this.specialHit(f, foe, "bones", 8, 1.6, 0.35, f.world(f.anim.joints[J.chest]));
        }
      }
      // dashes and dives hit once on contact
      const gap = Math.abs(foe.x - f.x) - f.rig.extent.front - foe.rig.extent.front;
      if (f.dash.t > 0 && !f.dash.hit && !foe.ko) {
        const through = f.dash.kind === "lightning" && Math.sign(foe.x - f.x) !== Math.sign(f.dash.v);
        if ((gap < 0.26 || through) && Math.abs(foe.y - f.y) < 0.5) {
          f.dash.hit = true;
          const at = { x: (f.x + foe.x) / 2, y: foe.y + 0.45 };
          if (f.dash.kind === "lightning") this.specialHit(f, foe, "lightning", 7, 1.2, 0.3, at);
          else this.specialHit(f, foe, "shield", 7, 2.4, 0.7, at);
          if (f.dash.kind === "shield") f.dash.t = Math.min(f.dash.t, 0.03);
        }
      }
      if (f.dive === 2 && !f.diveHit && !foe.ko && gap < 0.28 && f.y - foe.y < 0.7 && f.y - foe.y > -0.2) {
        f.diveHit = true;
        this.specialHit(f, foe, "wings", 11, 1.8, 0.35, { x: (f.x + foe.x) / 2, y: foe.y + 0.5 });
      }
    }
    // shots fly; opposite shots clash (water douses fire, fire melts ice, ice freezes water, lightning … has no shot)
    for (const p of this.projectiles) {
      if (p.g) p.vy -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      // a pumpkin that misses splats on the ground
      if (p.kind === "pumpkin" && p.y <= 0.04 && p.life > 0) {
        p.life = 0;
        this.fx.push({ kind: "clash", x: p.x, y: 0.05, word: "SPLAT!", color: "#e07a2f" });
      }
    }
    for (const a of this.projectiles)
      for (const b of this.projectiles) {
        if (a === b || a.owner === b.owner || a.life <= 0 || b.life <= 0 || Math.abs(a.x - b.x) > a.r + b.r || Math.abs(a.y - b.y) > a.r + b.r + 0.15) continue;
        if (!isElement(a.kind) || !isElement(b.kind)) continue;
        const m = elementMult(a.kind, b.kind);
        const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (m >= 1) b.life = 0;
        if (m <= 1) a.life = 0;
        const winner = m > 1 ? a.kind : m < 1 ? b.kind : null;
        this.fx.push({ kind: "clash", ...at, word: winner === "water" ? "PSSHH!" : winner === "fire" ? "HISS!" : winner === "ice" ? "CRACK!" : "POOF!", color: winner === "fire" ? "#e07a2f" : winner === "ice" ? "#3f7fbf" : "#1d4f89" });
      }
    for (const p of this.projectiles) {
      if (p.life <= 0 || frozenTime) continue;
      const vic = F[1 - p.owner];
      const att = F[p.owner];
      if (vic.ko || vic.scatter > 0) continue;
      // the shockwave runs along the ground: a fighter in the air is not on it
      if (p.kind === "quake" && vic.airborne) continue;
      const vj = vic.anim.joints;
      let d = Infinity;
      for (const [a, b] of BONE_PAIRS) d = Math.min(d, segDist(p, vic.world(vj[a]), vic.world(vj[b])));
      if (d < p.r + 0.06) {
        p.life = 0;
        const kb = p.kind === "water" ? 2.8 : p.kind === "quake" ? 1.5 : p.kind === "pumpkin" ? 1.3 : 1.1;
        const stun = p.kind === "fire" ? 0.25 : p.kind === "quake" ? 0.75 : p.kind === "pumpkin" ? 0.5 : 0.3;
        this.specialHit(att, vic, p.kind, p.dmg, kb, stun, { x: p.x, y: Math.max(0.15, p.y) }, true);
      }
    }
    // a water wave that misses still leaves its puddle where it lands
    for (const p of this.projectiles) if (p.life <= 0 && p.kind === "water" && p.dmg > 0 && Math.abs(p.x) < STAGE && !this.puddles.some((q) => Math.abs(q.x - p.x) < 0.3)) {
      p.dmg = 0;
      this.puddles.push({ x: p.x, w: 0.4, t: 2.5, owner: p.owner });
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0 && Math.abs(p.x) < STAGE + 0.4);
    for (const q of this.puddles) q.t -= dt;
    this.puddles = this.puddles.filter((q) => q.t > 0);
  }

  /** Mega leap lands: a smash that hits anyone near the landing (in the air it misses) */
  private slamDown(f: Fighter) {
    f.slam = false;
    f.dash.t = 0;
    f.vx = 0;
    this.impact += 0.9;
    const foe = this.fighters[f === this.fighters[0] ? 1 : 0];
    const near = Math.abs(foe.x - f.x) - f.rig.extent.front - foe.rig.extent.front;
    if (!foe.ko && near < 0.65 && foe.y < 0.25) this.specialHit(f, foe, "leap", 12, 2.2, 0.55, { x: (f.x + foe.x) / 2, y: 0.35 });
    else this.fx.push({ kind: "clash", x: f.x, y: 0.1, word: "THUD!", color: "#2a241c" });
  }

  private knockOut(vic: Fighter, att: Fighter, kb: number) {
    if (vic.ko) return;
    vic.ko = true;
    vic.blocking = vic.crouching = false;
    // impulse in the victim's local frame: away from the attacker, and up
    const away = (vic.x - att.x) * vic.facing >= 0 ? 1 : -1;
    vic.anim.walls = [(-WALL_X - vic.x) * vic.facing, (WALL_X - vic.x) * vic.facing];
    vic.anim.knockout({ x: away * (0.9 + kb * 0.5), y: 1.1 }, SIM_DT * this.pace);
    vic.vx = 0;
    this.impact += 0.6;
    // the final blow hangs in the air
    this.hitstop = Math.max(this.hitstop, 14);
    this.fx.push({ kind: "ko", ...vic.world(vic.anim.joints[J.chest]), who: this.fighters.indexOf(vic) });
  }

  // ------------------------------------------------------------- CPU
  private think(me: Fighter, foe: Fighter): PlayerInput {
    const forced = this.forced.shift();
    if (forced && forced.who === 1) {
      return { x: 0, punch: forced.move === "punch", kick: forced.move === "kick", jump: forced.move === "jump", block: forced.move === "block", crouch: forced.move === "crouch" };
    }
    if (this.ai === "off") return { x: 0, punch: false, kick: false, jump: false, block: this.aiHold.block > 0 };
    const prof = AI_PROFILES[this.difficulty];
    // the CPU's clock: a slower fight is easier to read for a human, so the CPU decides closer to real
    // time than the fighters move (AI_PACE of the way back toward 1), which keeps Normal fair
    const dt = SIM_DT * (this.pace + (1 - this.pace) * AI_PACE);
    this.aiHold.block = Math.max(0, this.aiHold.block - dt);
    this.aiTimer -= dt;
    const gap = Math.abs(foe.x - me.x);
    const toward = Math.sign(foe.x - me.x);
    const reach = me.rig.extent.front + foe.rig.extent.front;
    const out: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: this.aiHold.block > 0 };

    // backing off after a combo: walk away, don't attack
    if (this.aiBackOff > 0) {
      this.aiBackOff -= dt;
      out.x = gap < 1.2 + reach ? -toward : 0;
      if (this.aiBackOff <= 0) this.aiTimer = Math.max(this.aiTimer, 0.35);
      return out;
    }

    // the player's attack is noticed only after a human-ish reaction time, and blocked only sometimes
    const foeAttacking = foe.anim.busy && isAttack(foe.anim.move);
    if (!foeAttacking) {
      this.aiSeen = -1;
      this.aiDecided = false;
    } else {
      if (this.aiSeen < 0) this.aiSeen = 0;
      this.aiSeen += dt;
      if (!this.aiDecided && this.aiSeen >= prof.reaction) {
        this.aiDecided = true;
        // an animal's bite, tail whip, charge or pounce comes low and from odd angles: harder to read and block
        const read = HARD_TO_READ.has(foe.anim.move) ? HARD_TO_READ_BLOCK : 1;
        // the skeleton's answer to a hit coming in: fall to bits (the hit whiffs) and reform next to you
        if (me.special === "bones" && me.cool <= 0 && gap < 0.9 + reach && this.rnd() < prof.special * 1.6) {
          out.special = true;
          return out;
        }
        if (gap < 0.9 + reach && this.rnd() < prof.block * read) this.aiHold.block = 0.45;
      }
    }

    if (this.aiHold.x !== 0) {
      out.x = this.aiHold.x;
      if (this.aiTimer < 0.3) this.aiHold.x = 0;
    } else if (gap > 0.4 + reach) out.x = toward;
    if (this.aiTimer <= 0 && !out.block) {
      this.aiTimer = prof.think[0] + this.rnd() * prof.think[1];
      // its drawn special, when ready and the range suits it (shots from afar, dashes from mid range, bursts up close)
      if (me.special && me.cool <= 0 && this.rnd() < prof.special) {
        const k = me.special;
        const g = gap - reach;
        // signatures: a pumpkin is lobbed from mid range, the stomp only when the foe is on the ground,
        // the mega leap from afar, the bone scatter up close (and mostly as an answer, above)
        const grounded = foe.y < 0.05;
        const fits =
          k === "pumpkin" ? g > 0.2 && g < 3
          : k === "quake" ? g < 2.2 && grounded
          : k === "leap" ? g < 4 && grounded
          : k === "bones" ? g < 0.25 && this.rnd() < 0.4
          : k === "fire" || k === "water" || k === "ice" ? g > 0.35 : k === "lightning" || k === "wings" ? g > 0.15 && g < 1.4 : k === "shield" ? g < 0.8 : g < 0.45;
        if (fits) {
          out.special = true;
          return out;
        }
      }
      const r = this.rnd();
      // a thrower or a leaper with its special ready makes room for it now and then
      if ((me.special === "pumpkin" || me.special === "leap") && me.cool <= 0 && gap < 0.65 + reach && r < 0.15) {
        this.aiHold.x = -toward;
        this.aiTimer = 0.7;
        return out;
      }
      if (gap < 0.65 + reach) {
        if (r < prof.attack * 0.6) out.punch = true;
        else if (r < prof.attack) out.kick = true;
        else if (r < prof.attack + (1 - prof.attack) * 0.4) this.aiHold.block = 0.5;
        else if (r < prof.attack + (1 - prof.attack) * 0.8) {
          this.aiHold.x = -toward;
          this.aiTimer = 0.6;
        } else out.jump = true;
      } else if (r < 0.12) out.jump = true;
      else if (r < 0.3 && me.anim.moves.run && Math.abs(me.vx) > 0.5) out.punch = true; // charge / ram from range
    }
    return out;
  }
}

const NO_INPUT: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
const BONE_PAIRS = [[J.pelvis, J.chest], [J.chest, J.crown], [J.shF, J.elbowF], [J.elbowF, J.handF], [J.shB, J.elbowB], [J.hipF, J.kneeF], [J.hipB, J.kneeB], [J.kneeF, J.footF], [J.kneeB, J.footB]] as const;

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1e-6;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

export async function createSim(opts: SimOptions = {}): Promise<NotebookSim> {
  if (opts.physics === "rapier") await loadPhysics();
  return new NotebookSim(opts);
}
