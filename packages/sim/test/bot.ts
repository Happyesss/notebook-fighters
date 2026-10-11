// Headless: a scripted "casual human" plays rounds against the CPU rival on each difficulty.
// The bot sees the fight ~0.25 s late (reaction time), decides a few times a second, walks in,
// punches and kicks, blocks sometimes when it notices an attack, and is a bit random.
// Checks on Normal: the bot wins a fair share (35–65%) and rounds last more than 15 s.
import { NotebookSim, BODY_EDGE, POWER_EDGE, AI_PROFILES, ROSTER, type Difficulty, type RosterId } from "../src/index";
// tuning aid: EDGE="armed=1.2,shield=1.1" tries other body / power edges without editing stats.ts
for (const kv of process.env.EDGE?.split(",") ?? []) {
  const [k, v] = kv.split("=");
  if (k in BODY_EDGE) (BODY_EDGE as Record<string, number>)[k] = Number(v);
  else POWER_EDGE[k] = Number(v);
}
// tuning aid: AI="hard.rivalDmg=0.8,easy.attack=0.7" tries other level settings without editing sim.ts
for (const kv of process.env.AI?.split(",") ?? []) {
  const [path, v] = kv.split("=");
  const [lv, key] = path.split(".") as [Difficulty, string];
  (AI_PROFILES[lv] as unknown as Record<string, unknown>)[key] = v.includes("/") ? v.split("/").map(Number) : Number(v); // think=0.7/0.6
}
import { DRAWINGS, POWERED } from "./drawings";
import type { PlayerInput } from "@nf/shared";

let rs = Number(process.env.SEED ?? 12345);
const rand = () => ((rs = (rs * 48271) % 2147483647) - 1) / 2147483646;

export function playRound(sim: NotebookSim, maxSec = 120) {
  const hist: { gap: number; rivalAttacking: boolean }[] = [];
  let hold: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false };
  let holdFor = 0;
  let next = 0;
  let t = 0;
  const lag = 13 + Math.floor(rand() * 8); // ~0.22–0.35 s reaction
  while (!sim.curr.over && t < maxSec) {
    const [me, foe] = sim.fighters;
    hist.push({ gap: Math.abs(foe.x - me.x) - me.rig.extent.front - foe.rig.extent.front, rivalAttacking: foe.anim.busy && foe.anim.move !== "hit" && foe.anim.move !== "hitLow" && foe.anim.move !== "idle" && foe.anim.move !== "walk" });
    const seen = hist[Math.max(0, hist.length - 1 - lag)];
    let input: PlayerInput = { ...hold, punch: false, kick: false, jump: false };
    next -= 1 / 60;
    holdFor -= 1 / 60;
    if (holdFor <= 0) hold = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false };
    if (next <= 0 && sim.curr.countdown <= 0) {
      next = 0.22 + rand() * 0.35;
      const toward = Math.sign(foe.x - me.x);
      const r = rand();
      // a drawn special, now and then when it is ready (shots from afar, the rest up close)
      const sp = me.special;
      if (sp && me.cool <= 0 && rand() < 0.3 && ((sp === "fire" || sp === "water" || sp === "ice") ? seen.gap > 0.4 : sp === "lightning" || sp === "wings" ? seen.gap > 0.2 && seen.gap < 1.3 : seen.gap < 0.5)) {
        input = { ...input, special: true };
      } else if (seen.rivalAttacking && seen.gap < 0.5 && r < 0.3) {
        hold = { ...hold, x: 0, block: true };
        holdFor = 0.35;
      } else if (seen.gap > 0.3) {
        hold = { ...hold, x: toward, block: false };
        holdFor = 0.25 + rand() * 0.3;
      } else if (r < 0.5) input = { ...input, punch: true };
      else if (r < 0.75) input = { ...input, kick: true };
      else if (r < 0.82) input = { ...input, jump: true };
      else if (r < 0.9) {
        hold = { ...hold, x: -toward };
        holdFor = 0.2;
      }
    }
    sim.step(input);
    sim.drainFx();
    t += 1 / 60;
  }
  return { t, winner: sim.curr.winner, myHp: sim.curr.playerHp, rivalHp: sim.curr.bagHp };
}

/** one drawing per body type (biped variants too): the bot must have a fair chance with every one */
export const BODIES = (process.env.BODIES?.split(",") ?? ["clean", "swordsman", "fourArms", "bigHead", "tree", "plusSign", "quadruped", "snake", "blob", "car", "fire", "water", "lightning", "ice", "wings", "shield", "spikes"]);
/** a body by name: the plain drawings, or a powered one (the clean fighter plus a power doodle) */
export const bodyStrokes = (who: string) => DRAWINGS.find((d) => d.name === who)?.strokes ?? POWERED[who].strokes;

if (process.argv[1]?.endsWith("bot.ts")) {
  const levels = (process.argv[2]?.split(",") ?? ["easy", "normal", "hard"]) as Difficulty[];
  const N = Number(process.argv[3] ?? 40);
  let bad = 0;
  for (const level of levels) {
    let lw = 0;
    let ln = 0;
    for (const who of BODIES) {
      // the rival is what the vs-computer page uses: "Computer picks" from the pre-drawn roster (RIVAL=sketch for the old stick man)
      // the rival is what the vs-computer page uses: a pre-drawn fighter of the level's tier. The page picks one from the
      // drawing and the round, so the test plays the whole tier in turn (RIVAL=sketch: the old stick man, RIVAL=<id>: one fighter)
      const tier = level === "easy" ? 1 : level === "hard" ? 3 : 2;
      const pool: (RosterId | null)[] = process.env.RIVAL === "sketch" ? [null] : process.env.RIVAL ? [process.env.RIVAL as RosterId] : ROSTER.filter((r) => r.tier === tier).map((r) => r.id);
      const sims = pool.map((id) => new NotebookSim({ player: bodyStrokes(who), difficulty: level, countdown: 3, rivalPower: "auto", rivalId: id }));
      let sim = sims[0];
      let wins = 0;
      let total = 0;
      let dealt = 0;
      let shortest = Infinity;
      for (let i = 0; i < N; i++) {
        sim = sims[i % sims.length];
        sim.reset(true);
        const r = playRound(sim);
        if (r.winner === 0) wins++;
        total += r.t - 3;
        dealt += sim.curr.bagMax - r.rivalHp;
        shortest = Math.min(shortest, r.t - 3);
      }
      const rate = wins / N;
      const avg = total / N;
      lw += wins;
      ln += N;
      // per body: rounds must last and the casual bot wins 35–65% against every kind of drawing
      // (40 rounds a body: with 20 the dice alone swing a share by ±11%)
      const ok = level !== "normal" || (avg > 15 && rate >= 0.35 && rate <= 0.65);
      if (!ok) bad++;
      console.log(`${ok ? "ok " : "BAD"} ${level.padEnd(6)} ${who.padEnd(9)} vs ${(sim.fighters[1].special ?? "-").padEnd(9)} bot wins ${(rate * 100).toFixed(0).padStart(3)}%  avg round ${avg.toFixed(1)}s  shortest ${shortest.toFixed(1)}s  avg dmg dealt ${(dealt / N).toFixed(0)}`);
    }
    const share = lw / ln;
    const ok = level !== "normal" || (share >= 0.35 && share <= 0.65);
    if (!ok) bad++;
    console.log(`${ok ? "ok " : "BAD"} ${level.padEnd(6)} all bodies: bot wins ${(share * 100).toFixed(0)}% of ${ln} rounds`);
  }
  console.log(bad ? `${bad} BAD` : "BOT OK");
  process.exit(bad);
}
