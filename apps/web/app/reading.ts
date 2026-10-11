/**
 * Fighter stats come from the same part reader that rigs and animates the drawing (@nf/sim inferRig) and
 * the same stats model the duel uses (@nf/sim computeStats): each part drawn over again (darker) is
 * stronger, a bigger body has more HP but is slower, long legs or wheels go faster, and a power budget
 * plus a per-body-type balance keep any one drawing from being best at everything.
 */
import { Animator, MOVE_TITLES, computeStats, inferRig, moveDamage, moveStriker, sketchFighter, type FighterStats, type MoveName } from "@nf/sim";

export type FighterReading = {
  name: string;
  kind: string;
  line: string;
  hp: number;
  punch: number;
  speed: number;
  /** what the reader found and the moves it gave the drawing */
  parts?: string[];
  moves?: string[];
  /** why the stats are what they are, e.g. "dark right arm (3 passes): punch +30%" */
  why?: string[];
  stats?: FighterStats;
};

export type BattleBrief = {
  fighters: FighterReading[];
  rivals: FighterReading[];
};

type Ink = { points: { x: number; y: number }[]; color?: string };

export function judgeClan(drawings: Ink[][]): BattleBrief {
  const fighters = drawings.map((strokes, index) => judgeDrawing(strokes, index));
  return {
    fighters,
    rivals: fighters.map((fighter, index) => rivalFor(fighter, index)),
  };
}

export function judgeDrawing(strokes: Ink[], index: number): FighterReading {
  const ink = strokes.filter((stroke) => stroke.points.length > 1);
  const box = bounds(ink);
  if (ink.length === 0 || (box.w < 0.02 && box.h < 0.02)) return rock(index);
  const rig = inferRig(ink.map((s) => ({ color: s.color ?? "#2a241c", points: s.points })));
  if (!rig) return rock(index);
  // the same stats the duel uses: passes per part (scribble it darker), length, body type, power budget
  const stats = computeStats(rig);
  const moves = new Animator(rig).moves;
  const title = (mv: MoveName | undefined) => (mv ? MOVE_TITLES[mv] ?? mv : "");
  const moveList = [title(moves.punch), title(moves.kick), title(moves.run), title(moves.air)].filter((v, i, a) => v && a.indexOf(v) === i);
  // "punch" on the cards = how hard its two main moves hit, relative to a plain stick man's jab and kick
  const hit = (mv: MoveName) => moveDamage(mv) * stats.dmg[moveStriker(mv)];
  const punch = (hit(moves.punch) + hit(moves.kick)) / 21;
  const counts = new Map<string, number>();
  rig.parts.forEach((label, i) => rig.over[i] < 0 && counts.set(label, (counts.get(label) ?? 0) + 1));
  const parts = [...counts].map(([label, n]) => (n > 1 ? `${n}× ${label}` : label));
  const why = stats.lines.map((l) => l.text);
  return {
    name: `Fighter ${index + 1}`,
    kind: rig.kind,
    line: `${why.length ? cap(why.slice(0, 2).join("; ")) : "One pass everywhere: scribble a part again to make it stronger"}. Moves: ${moveList.join(", ")}.`,
    hp: stats.hp,
    punch: round1(Math.max(0.5, Math.min(2, punch))),
    speed: round1(stats.speed),
    parts,
    moves: moveList,
    why,
    stats,
  };
}

/** the other hall's fighter for slot `order`: a blue stick guard (even slots) or brute (odd slots) */
export function rivalSketch(order: number) {
  return sketchFighter(order * 7 + 11, "#1d4f89", order % 2 ? "brute" : "guard");
}

/**
 * The other hall answers each drawing with a stick fighter of exactly the same HP, punch and speed,
 * so the battle is decided by the moves, not by a stat gap. The card says so, and says which of our
 * drawings it was matched to; its body and moves come from reading its own sketch.
 */
function rivalFor(fighter: FighterReading, index: number): FighterReading {
  const rig = inferRig(rivalSketch(index));
  const moves = rig ? new Animator(rig).moves : null;
  const moveList = moves ? [moves.punch, moves.kick].map((m) => MOVE_TITLES[m] ?? m) : ["punch", "kick"];
  const kind = index % 2 ? "brute (stick fighter, shoulder pads)" : "guard (stick fighter, helmet)";
  if (fighter.kind === "rock") {
    return { name: `Guard ${index + 1}`, kind, line: "Sent against a rock. A rock cannot beat a body.", hp: 100, punch: 1.1, speed: 1, moves: moveList };
  }
  return {
    name: `Guard ${index + 1}`,
    kind,
    line: `Matched to ${fighter.name} (${fighter.kind}): same HP, punch and speed, so the moves decide it. Moves: ${moveList.join(", ")}.`,
    hp: fighter.hp,
    punch: fighter.punch,
    speed: fighter.speed,
    moves: moveList,
  };
}

function rock(index: number): FighterReading {
  return { name: `Rock ${index + 1}`, kind: "rock", line: "A rock has no arms and no legs, so it cannot fight.", hp: 42, punch: 0.5, speed: 0.7 };
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

type Box = { minX: number; minY: number; w: number; h: number };
function bounds(strokes: Ink[]): Box {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const stroke of strokes) {
    for (const pt of stroke.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  }
  return { minX, minY, w: Math.max(0.001, maxX - minX), h: Math.max(0.001, maxY - minY) };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function evenReading(index: number, side: "ours" | "theirs"): FighterReading {
  return { name: side === "ours" ? `Fighter ${index + 1}` : `Rival ${index + 1}`, kind: "fighter", line: "Even strength.", hp: 100, punch: 1, speed: 1 };
}
