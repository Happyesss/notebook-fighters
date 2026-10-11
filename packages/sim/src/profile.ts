/**
 * A computer rival's card, read from the fight itself: it builds the same NotebookSim the /play page
 * builds (your drawing, that rival, that level, the rival's power picked the usual way) and reports
 * the rival fighter's real numbers, so the home page never shows invented stats.
 */
import type { InkStroke } from "@nf/shared";
import { MOVE_TITLES, type MoveName } from "./anim";
import { POWER_INFO, isSignature, type PowerKind } from "./powers";
import { ROSTER, type RosterId } from "./roster";
import { AI_PROFILES, NotebookSim, moveDamage, moveStriker, type Difficulty } from "./sim";
import type { StrikeKey } from "./stats";

export type RivalMove = {
  /** which button / situation plays it */
  button: "punch" | "kick" | "run" | "air";
  move: MoveName;
  title: string;
  /** damage of one clean hit on this level, before blocks and the target's armour */
  damage: number;
  striker: StrikeKey;
};

export type RivalProfile = {
  id: RosterId;
  name: string;
  blurb: string;
  tier: 1 | 2 | 3;
  difficulty: Difficulty;
  /** what the reader made of the drawing (e.g. "fighter", "swordsman", "quadruped") */
  kind: string;
  hp: number;
  /** walk speed and jump height multipliers (1 = a plain stick figure) */
  speed: number;
  jump: number;
  /** arm reach in figure heights (with a held weapon) */
  reach: number;
  /** damage multiplier per striker after the fair-rival scaling */
  dmg: Record<StrikeKey, number>;
  /** incoming damage multipliers where it is hit (below 1 = armoured) */
  armour: { head: number; body: number; arms: number; legs: number };
  /** drawn this many times the usual figure height */
  size: number;
  /** the level's damage scale for the computer's hits */
  levelDmg: number;
  moves: RivalMove[];
  special: { kind: PowerKind; name: string; move: string; passive: string; cooldown: number; strength: number; signature: boolean } | null;
  /** plain-words reasons from the stats reader ("dark right arm (3 passes): punch +30%") */
  abilities: string[];
};

const round = (n: number, k = 100) => Math.round(n * k) / k;

/**
 * The rival `id` ("auto": whoever the computer picks for this drawing and level) as it will fight you
 * on `difficulty`. `player` is your drawing (it decides the rival's power on Normal / Hard).
 */
export function rivalProfile(id: RosterId | "auto", difficulty: Difficulty = "normal", player: InkStroke[] | null = null): RivalProfile {
  const sim = new NotebookSim({ player, rivalId: id, rivalPower: "auto", difficulty, ai: "on", physics: "classic" });
  try {
    const f = sim.fighters[1];
    const e = sim.rivalEntry ?? ROSTER[0];
    const st = f.stats;
    const levelDmg = AI_PROFILES[difficulty].rivalDmg;
    const set = f.anim.moves;
    const moves: RivalMove[] = [];
    for (const button of ["punch", "kick", "run", "air"] as const) {
      const move = set[button];
      if (!move || moves.some((m) => m.move === move && button !== "punch" && button !== "kick")) continue;
      const striker = moveStriker(move) as StrikeKey;
      moves.push({ button, move, title: MOVE_TITLES[move] ?? move, striker, damage: round(moveDamage(move) * st.dmg[striker] * levelDmg, 10) });
    }
    const pw = f.special;
    const special = pw
      ? { kind: pw, name: POWER_INFO[pw].name, move: POWER_INFO[pw].special, passive: POWER_INFO[pw].passive, cooldown: Math.round(f.coolMax * 10) / 10, strength: st.powers.find((p) => p.kind === pw)?.strength ?? 1, signature: isSignature(pw) }
      : null;
    return {
      id: e.id,
      name: e.name,
      blurb: e.blurb,
      tier: e.tier,
      difficulty,
      kind: f.rig.kind,
      hp: st.hp,
      speed: st.speed,
      jump: st.jump,
      reach: st.reach,
      dmg: { ...st.dmg },
      armour: {
        head: st.armour.head,
        body: st.armour.torso,
        arms: round((st.armour.armF + st.armour.armB) / 2),
        legs: round((st.armour.legF + st.armour.legB) / 2),
      },
      size: f.size,
      levelDmg,
      moves,
      special,
      abilities: st.lines.filter((l) => !l.text.startsWith("drawing quality") && !l.text.startsWith("body-type balance")).map((l) => l.text),
    };
  } finally {
    sim.destroy();
  }
}
