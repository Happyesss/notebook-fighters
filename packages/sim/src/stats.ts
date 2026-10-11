/**
 * Stats from the drawing (plan §5): every part's strength comes from how many times it was drawn over
 * (and how dark the pencil is), its length, and the body it belongs to. A power budget keeps any one
 * drawing from being best at everything, and each body type gets the same total power at one pass,
 * so a fast car pays for its speed with HP, a heavy blob with speed.
 */
import { POWER_INFO, type PowerKind } from "./powers";
import { J, skinStrokes, type Plan, type Rig } from "./rig";

export type PartKey = "head" | "torso" | "armF" | "armB" | "legF" | "legB" | "weapon" | "tail";
/** what lands a blow: the same "striker" the duel's hit detection uses */
export type StrikeKey = "punch" | "kick" | "head" | "weapon" | "body" | "front" | "tail";

export type StatLine = { stat: "hp" | "punch" | "kick" | "speed" | "jump" | "armour" | "reach" | "power"; text: string; delta: number };

export type FighterStats = {
  /** max HP */
  hp: number;
  /** damage multiplier for each kind of strike */
  dmg: Record<StrikeKey, number>;
  /** walking speed and jump height multipliers */
  speed: number;
  jump: number;
  /** incoming damage multiplier when that part is hit (dark parts are armoured) */
  armour: Record<PartKey, number>;
  /** 0..1 strength of each drawn part, and its passes (how many times it was drawn over) */
  strength: Record<PartKey, number>;
  passes: Record<PartKey, number>;
  /** arm reach in figure heights (bone length + a held weapon) */
  reach: number;
  /** share of the scribble budget used (1 = full; more ink beyond it is spread thinner) */
  budget: number;
  /** body-type normaliser applied to HP and damage so no body type is best at everything */
  bodyScale: number;
  /** powers from add-on doodles: how many times each was drawn, and its effect multiplier (0.85 … 1.15) */
  powers: { kind: PowerKind; passes: number; strength: number }[];
  /** plain-words reasons, e.g. "dark right arm (3 passes): punch +30%" */
  lines: StatLine[];
  /**
   * drawing quality (effort and care): 0–100 from detail, a neatly closed head, symmetry, darker
   * scrubbed parts and add-ons. It buys a small, capped bonus: HP up to +QUALITY_HP, hits up to +QUALITY_DMG.
   */
  quality: { score: number; detail: number; closed: number; symmetry: number; dark: number; addons: number; hp: number; dmg: number };
};

/** the most a careful drawing can add (kept small so a neat drawing helps but never decides a fight) */
export const QUALITY_HP = 0.1;
export const QUALITY_DMG = 0.06;

/** effort and care in the drawing, each 0..1 (see FighterStats.quality) */
export function drawingQuality(rig: Rig, strength: Record<PartKey, number>) {
  const originals = rig.over.filter((o) => o < 0).length || rig.strokes.length;
  const sh = rig.shape;
  // detail: a bare stick man is ~6 lines; faces, hair, belts, muscles and props add more
  const detail = clamp((originals - 5) / 7, 0, 1);
  const closed = rig.found.head ? rig.headClosure : 0;
  // symmetry: left and right limbs of about the same length
  const ratio = (a: number, b: number) => (a > 0 && b > 0 ? Math.min(a, b) / Math.max(a, b) : 0.5);
  const sym: number[] = [];
  if (rig.found.armF && rig.found.armB) sym.push(ratio(sh.upperArmF + sh.foreArmF, sh.upperArmB + sh.foreArmB));
  if (rig.found.legF && rig.found.legB) sym.push(ratio(sh.thighF + sh.shinF, sh.thighB + sh.shinB));
  const symmetry = sym.length ? clamp((sym.reduce((a, v) => a + v, 0) / sym.length - 0.6) / 0.35, 0, 1) : 0.3;
  // darker scrubbed parts (the same passes the stats already reward, a little extra for the care)
  const body = ["head", "torso", "armF", "armB", "legF", "legB"] as PartKey[];
  const dark = clamp(body.reduce((a, p) => a + strength[p], 0) / 2.4, 0, 1);
  // add-ons: weapons, hats, belts, power doodles, extra limbs
  const addons = clamp((rig.extras + (rig.weapon ? 1 : 0) + rig.powers.length + rig.aux.length * 0.5) / 3, 0, 1);
  const score = Math.round(100 * clamp(0.3 * detail + 0.2 * closed + 0.2 * symmetry + 0.15 * dark + 0.15 * addons, 0, 1));
  const q = score / 100;
  return { score, detail, closed, symmetry, dark, addons, hp: Math.round(QUALITY_HP * q * 100) / 100, dmg: Math.round(QUALITY_DMG * q * 100) / 100 };
}

const PARTS: PartKey[] = ["head", "torso", "armF", "armB", "legF", "legB", "weapon", "tail"];
/** pass radius (figure heights): ink this close to a point of the part's line counts as going over it */
const PASS_R = 0.026;
/** diminishing returns: s = 1 − exp(−(d − 1)/τ) (plan §3.5, τ 3.5 there; 2.5 here so 2–4 passes matter) */
const TAU = 2.5;
/** scribble budget (plan §5.3: head + torso + ½·each limb); beyond it every part is scaled down */
const BUDGET = 1.6;
/**
 * How strong a body's own moves are, measured with the human-like bot against the Normal CPU
 * (packages/sim/test/bot.ts). Used only to even out body types; >1 = its moves are better than a stick man's.
 */
export type BodyClass = "biped" | "armed" | "manyArms" | "bigHead" | "tree" | "legless" | "armless" | Exclude<Plan, "biped">;
/** how much each drawn power is worth in the power budget (tuned by the bot test like BODY_EDGE) */
export const POWER_EDGE: Record<string, number> = { fire: 1.04, water: 1, lightning: 1, ice: 1.08, wings: 1.18, shield: 1.7, spikes: 1.05 };
export const BODY_EDGE: Record<BodyClass, number> = { biped: 1, armed: 0.82, manyArms: 0.94, bigHead: 1.12, tree: 1.06, legless: 0.97, armless: 1, quadruped: 1.06, blob: 0.5, serpent: 1.22, vehicle: 0.68 };
/** how much walking speed is worth in a duel (closing in and backing off): power ∝ speed^SPEED_WEIGHT */
const SPEED_WEIGHT = 0.5;

/** the body type, for balancing: what the drawing is, in the reader's words */
export function bodyClass(rig: Rig): BodyClass {
  if (rig.plan !== "biped") return rig.plan;
  const k = rig.kind;
  if (k === "armed fighter") return "armed";
  if (k === "walking tree") return "tree";
  if (k === "big-headed fighter") return "bigHead";
  if (k.startsWith("legless") || k.startsWith("living stick")) return "legless";
  if (k.startsWith("armless")) return "armless";
  if (/^\d+-armed/.test(k)) return "manyArms";
  return "biped";
}

const sat = (v: number, k: number) => 1 - Math.exp(-v * k);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** luminance 0..1 of a #rrggbb pencil */
function lum(color: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  if (!m) return 0.2;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** body measurements in figure heights, from the rigged drawing in its bind pose */
export function measure(rig: Rig) {
  const lines = skinStrokes(rig, rig.bind);
  let bulk = 0;
  let armor = 0;
  lines.forEach((s, i) => {
    if (rig.over?.[i] >= 0) return; // a second pass is darkness, not more body
    const label = rig.strokes[i].label;
    if (label === "costume") return;
    const pts = s.points;
    let arc = 0;
    for (let k = 1; k < pts.length; k++) arc += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    if (s.part === "torso" || s.part === "head") {
      if (label === "wheel" || label === "window" || label === "face" || label === "face / body detail" || label.startsWith("power")) return;
      const closed = pts.length > 5 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < arc * 0.2;
      bulk += closed ? Math.abs(area(pts)) * 4 : arc * 0.35;
    } else if (label === "cape" || label === "shield / held thing" || label === "body add-on" || label === "head add-on") armor += 0.04;
  });
  const sh = rig.shape;
  const armReach = Math.max(rig.found.armF ? sh.upperArmF + sh.foreArmF : 0, rig.found.armB ? sh.upperArmB + sh.foreArmB : 0);
  const legLen = Math.max(rig.found.legF ? sh.thighF + sh.shinF : 0, rig.found.legB ? sh.thighB + sh.shinB : 0);
  const auxArms = rig.aux.filter((a) => a.src.startsWith("arm")).length;
  const auxLegs = rig.aux.filter((a) => a.src.startsWith("leg")).length;
  return { bulk, armor: Math.min(0.15, armor), armReach, legLen, auxArms, auxLegs };
}

/** which part a stroke point belongs to, from the bone it is skinned to */
function partOfBone(rig: Rig, bone: number): PartKey {
  if (bone === 0) return "torso";
  if (bone === 1) return "head";
  if (bone === 2 || bone === 3) return "armB";
  if (bone === 4 || bone === 5) return "armF";
  if (bone === 6 || bone === 7) return "legB";
  if (bone === 8 || bone === 9) return "legF";
  const aux = rig.aux[Math.floor((bone - 10) / 2)];
  return (aux?.src ?? "torso") as PartKey;
}

/** labels that are decoration, not the part they ride on (they don't make that part stronger) */
const DECOR = new Set(["face", "head add-on", "face / body detail", "window", "body add-on", "cape", "prop", "shield / held thing"]);

/**
 * Passes per part: for each point along a part's own line, count how many times any ink enters a small
 * circle around it (two strokes over it = 2; a scribble going back and forth = each crossing), weighted
 * by pencil darkness; the part's passes are the 75th percentile along its length (plan §3.5).
 */
export function partPasses(rig: Rig, raw = false): Record<PartKey, number> {
  // costume lines (pre-drawn rivals' outlines, masks, belts) are not part of the drawing's strength
  const ink = skinStrokes(rig, rig.bind).map((s, i) => (rig.strokes[i].label === "costume" ? { ...s, points: [] } : s));
  const weight = rig.strokes.map((s) => (raw ? 1 : 0.85 + 0.3 * (1 - lum(s.color))));
  const out = Object.fromEntries(PARTS.map((p) => [p, 0])) as Record<PartKey, number>;
  const masks = new Map<PartKey, { x: number; y: number }[]>();
  const keyOf = (i: number, k: number): PartKey | null => {
    const st = rig.strokes[i];
    if (st.label === "weapon" || st.label === "weapon part") return "weapon";
    if (st.label === "tail") return "tail";
    if (DECOR.has(st.label) || st.label.startsWith("power") || st.part === "extra") return null;
    if (st.label === "wheel") return ink[i].points.reduce((a, p) => a + p.x, 0) / ink[i].points.length > rig.pivotX ? "legF" : "legB";
    if (st.part === "head") return "head";
    const bone = st.points[k].b0;
    if (st.part === "aux") return bone >= 10 ? partOfBone(rig, bone) : null;
    const limbBone = bone >= 2 && bone <= 9;
    // a whole limb stroke belongs to its limb (its root blends into the body, but it is still arm ink)
    if ((st.part === "armF" || st.part === "armB" || st.part === "legF" || st.part === "legB") && !st.label.startsWith("both")) return st.part;
    if (limbBone) return partOfBone(rig, bone); // both arms in one line, a body that runs on into a leg
    return st.part === "torso" ? "torso" : null;
  };
  // every ink point's part (a pass only counts for the part it was drawn on: an arm meeting the body is not body ink)
  const keys = ink.map((s, i) => s.points.map((_, k) => keyOf(i, k)));
  ink.forEach((s, i) => {
    if (rig.over?.[i] >= 0) return; // masks come from the original lines only
    for (let k = 0; k < s.points.length; k++) {
      const key = keys[i][k];
      if (!key) continue;
      if (!masks.has(key)) masks.set(key, []);
      masks.get(key)!.push(s.points[k]);
    }
  });
  for (const [key, mask] of masks) {
    const d = mask.map((m) => {
      let n = 0;
      ink.forEach((s, i) => {
        let inside = false;
        for (let k = 0; k < s.points.length; k++) {
          const p = s.points[k];
          const now = keys[i][k] === key && Math.hypot(p.x - m.x, p.y - m.y) < PASS_R;
          if (now && !inside) n += weight[i];
          inside = now;
        }
      });
      return n;
    });
    d.sort((a, b) => a - b);
    out[key] = d[Math.floor(d.length * 0.75)] ?? 0;
  }
  return out;
}

export const strengthOf = (d: number) => (d <= 1 ? 0 : 1 - Math.exp(-(d - 1) / TAU));

export function computeStats(rig: Rig): FighterStats {
  const m = measure(rig);
  const passes = partPasses(rig);
  const counted = partPasses(rig, true);
  const strength = Object.fromEntries(PARTS.map((p) => [p, strengthOf(passes[p])])) as Record<PartKey, number>;
  // the scribble budget: head + torso count fully, each limb (and a weapon or tail) half
  // a power doodle drawn over again is a stronger power (plan §8.4: 0.85 + 0.3·s)
  const powerPasses = rig.powers.map((p) => {
    const base = p.strokes.filter((i) => rig.over[i] < 0).length || 1;
    return { kind: p.kind, passes: p.strokes.length / base };
  });
  const powerS = powerPasses.map((p) => strengthOf(p.passes));
  const used = strength.head + strength.torso + 0.5 * (strength.armF + strength.armB + strength.legF + strength.legB + strength.weapon + strength.tail + powerS.reduce((a, v) => a + v, 0));
  const squeeze = used > BUDGET ? BUDGET / used : 1;
  for (const p of PARTS) strength[p] *= squeeze;
  const powers = powerPasses.map((p, i) => ({ kind: p.kind, passes: Math.round(p.passes * 10) / 10, strength: Math.round((0.85 + 0.3 * powerS[i] * squeeze) * 100) / 100 }));
  const s = strength;
  const sh = rig.shape;
  const lines: StatLine[] = [];
  const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}%`;
  const side = (limb: "F" | "B") => ((limb === "F") !== rig.mirrored ? "right" : "left");
  const passesText = (p: PartKey) => `${Math.max(1, Math.round(counted[p]))} pass${Math.round(counted[p]) > 1 ? "es" : ""}`;
  const dark = (p: PartKey) => (s[p] > 0.6 ? "very dark" : "dark");

  // --- the body (one pass): HP from bulk, speed from how it moves and how heavy it is
  const gait = rig.gait;
  const hpBody = 0.88 + 0.32 * sat(m.bulk, 1.6) + m.armor;
  const legRatio = rig.found.legF || rig.found.legB ? m.legLen / Math.max(0.1, sh.torso) : 1;
  const legFactor = gait === "walk" ? clamp(0.8 + 0.2 * legRatio, 0.85, 1.15) : 1;
  const gaitSpeed = { walk: 1, trot: 1.15, roll: 1.3, slither: 0.95, bounce: 0.85, hop: 0.8 }[gait];
  const heavy = 1 - 0.15 * sat(m.bulk, 1);
  const speedBody = gaitSpeed * legFactor * heavy;
  const armReach = m.armReach + (rig.weapon ? rig.weapon.length * 0.6 : 0);
  const reachBody = rig.found.armF || rig.found.armB ? clamp(0.85 + 0.6 * (m.armReach / Math.max(0.12, sh.torso) - 0.5) * 0.5, 0.85, 1.15) : 1;
  const manyArms = 1 + 0.06 * Math.min(3, m.auxArms);

  // every body type gets the same power at one pass: speed (and reach, and extra arms) are paid for in HP and damage
  // a drawn power is worth something too: the body pays for it (the power budget)
  const edge = BODY_EDGE[bodyClass(rig)] * rig.powers.reduce((m, p) => m * (POWER_EDGE[p.kind] ?? 1), 1);
  const power0 = hpBody * reachBody * manyArms * Math.pow(speedBody, SPEED_WEIGHT) * edge;
  const bodyScale = clamp(Math.sqrt(1 / power0), 0.6, 1.6);

  // --- drawing quality: a careful, detailed drawing gets a small capped bonus
  const quality = drawingQuality(rig, strength);
  // --- scribbling: what each darker part buys
  const hp = clamp(Math.round(100 * hpBody * bodyScale * (1 + 0.4 * s.head + 0.15 * s.torso) * (1 + quality.hp)), 55, 175);
  const base = bodyScale * reachBody * manyArms * (1 + quality.dmg);
  const dmg: Record<StrikeKey, number> = {
    punch: base * (1 + 0.6 * (rig.strike.punch === J.crown ? s.head : rig.strike.punch === J.handB ? s.armB : s.armF) + 0.2 * (rig.strike.punch === J.handB ? s.armF : s.armB)),
    kick: base * (1 + 0.6 * (rig.strike.kick === J.crown ? s.head : rig.strike.kick === J.footB ? s.legB : rig.strike.kick === J.handF ? s.armF : s.legF) + 0.2 * (rig.strike.kick === J.footB ? s.legF : s.legB)),
    head: base * (1 + 0.6 * s.head),
    weapon: base * (1 + 0.5 * s.weapon + 0.3 * (rig.weapon?.limb === "armB" ? s.armB : s.armF)),
    body: base * (1 + 0.45 * s.torso + 0.15 * s.head),
    front: base * (1 + 0.4 * s.torso + 0.3 * s.head),
    tail: base * (1 + 0.6 * s.tail + 0.1 * s.torso),
  };
  for (const k of Object.keys(dmg) as StrikeKey[]) dmg[k] = Math.round(clamp(dmg[k], 0.6, 1.8) * 100) / 100;
  const meanLegs = rig.found.legF || rig.found.legB ? (s.legF + s.legB) / (rig.found.legF && rig.found.legB ? 2 : 1) : 0;
  const speed = Math.round(clamp(speedBody * (1 + 0.2 * meanLegs), 0.7, 1.45) * 100) / 100;
  const jump = Math.round(clamp(1 + 0.25 * meanLegs - 0.08 * sat(m.bulk, 1), 0.85, 1.3) * 100) / 100;
  const armour = Object.fromEntries(PARTS.map((p) => [p, Math.round((1 / (1 + 0.5 * s[p])) * 100) / 100])) as Record<PartKey, number>;

  // --- the reasons, biggest first
  const add = (stat: StatLine["stat"], delta: number, text: string) => {
    if (Math.abs(delta) >= 0.04) lines.push({ stat, delta, text });
  };
  const punchPart: PartKey = rig.strike.punch === J.crown ? "head" : rig.strike.punch === J.handB ? "armB" : "armF";
  const named = (p: PartKey) => (p === "armF" ? `${side("F")} arm` : p === "armB" ? `${side("B")} arm` : p === "legF" ? `${side("F")} leg` : p === "legB" ? `${side("B")} leg` : p);
  if (s[punchPart] > 0.05) add("punch", 0.6 * s[punchPart], `${dark(punchPart)} ${named(punchPart)} (${passesText(punchPart)}): punch ${pct(0.6 * s[punchPart])}`);
  const kickPart: PartKey = rig.strike.kick === J.footB ? "legB" : rig.strike.kick === J.crown ? "head" : rig.strike.kick === J.handF ? "armF" : "legF";
  if (s[kickPart] > 0.05 && kickPart !== punchPart) add("kick", 0.6 * s[kickPart], `${dark(kickPart)} ${named(kickPart)} (${passesText(kickPart)}): kick ${pct(0.6 * s[kickPart])}`);
  if (s.head > 0.05) add("hp", 0.4 * s.head, `${dark("head")} head (${passesText("head")}): HP ${pct(0.4 * s.head)}, hits to the head ${pct(armour.head - 1)}`);
  if (s.torso > 0.05) add("hp", 0.15 * s.torso + 0.45 * s.torso * 0.5, `${dark("torso")} body (${passesText("torso")}): HP ${pct(0.15 * s.torso)}, hits to the body ${pct(armour.torso - 1)}`);
  if (meanLegs > 0.05) add("speed", 0.2 * meanLegs, `dark legs: speed ${pct(0.2 * meanLegs)}, jump ${pct(0.25 * meanLegs)}`);
  if (s.weapon > 0.05) add("punch", 0.5 * s.weapon, `dark weapon: weapon hits ${pct(0.5 * s.weapon)}`);
  for (const p of ["armF", "armB", "legF", "legB"] as PartKey[])
    if (p !== punchPart && p !== kickPart && s[p] > 0.15) add("armour", 1 - armour[p], `${dark(p)} ${named(p)}: hits there ${pct(armour[p] - 1)}`);
  for (const p of powers) add("power", 0.5 + p.strength - 0.85, `${POWER_INFO[p.kind].name.toLowerCase()} doodle${p.passes >= 1.5 ? ` (drawn ${Math.round(p.passes)}×)` : ""}: special ${POWER_INFO[p.kind].special}${p.strength > 0.9 ? ` ${pct(p.strength - 1)}` : ""}, ${POWER_INFO[p.kind].passive}`);
  if (squeeze < 1) add("hp", -(1 - squeeze), `over the scribble budget: every dark part counts ${pct(squeeze - 1)}`);
  if (m.bulk > 0.9) add("hp", hpBody - 1, `big body: HP ${pct(hpBody - 1)}, speed ${pct(heavy - 1)}`);
  else if (m.bulk < 0.3 && rig.plan === "biped") add("hp", hpBody - 1, `thin body: HP ${pct(hpBody - 1)}`);
  if (m.armor > 0) add("hp", m.armor, `cape / shield / hat: HP ${pct(m.armor)}`);
  if (gaitSpeed !== 1) add("speed", gaitSpeed - 1, `${{ trot: "four legs trot", roll: "wheels roll", slither: "it slithers", bounce: "it bounces", hop: "no legs, it hops", walk: "" }[gait]}: speed ${pct(gaitSpeed - 1)}`);
  if (legFactor !== 1) add("speed", legFactor - 1, `${legFactor > 1 ? "long" : "short"} legs: speed ${pct(legFactor - 1)}`);
  if (rig.weapon) add("reach", rig.weapon.length * 0.6 / Math.max(0.2, m.armReach), `weapon: reach ${pct((rig.weapon.length * 0.6) / Math.max(0.2, m.armReach))}`);
  if (reachBody !== 1) add("punch", reachBody - 1, `${reachBody > 1 ? "long" : "short"} arms: ${reachBody > 1 ? "more reach" : "less reach"}, hits ${pct(reachBody - 1)}`);
  if (m.auxArms) add("punch", manyArms - 1, `${2 + m.auxArms} arms: hits ${pct(manyArms - 1)}`);
  if (Math.abs(bodyScale - 1) >= 0.04) add("hp", bodyScale - 1, `body-type balance: HP and hits ${pct(bodyScale - 1)}`);
  if (quality.score >= 10) add("hp", Math.max(0.04, quality.hp), `drawing quality ${quality.score}/100: HP ${pct(quality.hp)}, hits ${pct(quality.dmg)}`);
  lines.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { hp, dmg, speed, jump, armour, strength, passes, reach: Math.round(armReach * 100) / 100, budget: Math.min(1, used / BUDGET), bodyScale, powers, lines, quality };
}

function area(pts: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
