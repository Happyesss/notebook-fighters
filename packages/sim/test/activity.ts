// How busy is the CPU rival? Per level: attacks it starts, hits it lands, hits blocked, vs the casual bot,
// per minute of fight, plus the bot's win share. ROUNDS per body (default 10), BODIES as in bot.ts.
import { NotebookSim, ROSTER, type Difficulty } from "../src/index";
import { playRound, bodyStrokes } from "./bot";
const N = Number(process.argv[3] ?? 10);
// experiments: SIZE=1 / NOSTANCE=1 override the Bodybuilder's look
{
  const bb = ROSTER.find((r) => r.id === "bodybuilder")!;
  if (process.env.SIZE) bb.size = Number(process.env.SIZE);
  if (process.env.NOSTANCE) delete bb.stance;
}
const levels = (process.argv[2]?.split(",") ?? ["easy", "normal", "hard"]) as Difficulty[];
const bodies = process.env.BODIES?.split(",") ?? ["clean", "fire", "quadruped", "car", "blob", "swordsman"];
const ATT = new Set(["punch", "kick", "jumpKick", "special", "bite", "tailWhip", "charge", "pounce", "headbutt", "slam", "sweep", "uppercut"]);
for (const level of levels) {
  const tier = level === "easy" ? 1 : level === "hard" ? 3 : 2;
  const pool = process.env.RIVAL ? [process.env.RIVAL] : ROSTER.filter((r) => r.tier === tier).map((r) => r.id);
  const c = { t: 0, rStart: 0, rHit: 0, pStart: 0, pHit: 0, rBlocked: 0, pBlocked: 0, wins: 0, n: 0 };
  const moves: Record<string, number> = {};
  for (const who of bodies) {
    const sims = pool.map((id) => new NotebookSim({ player: bodyStrokes(who), difficulty: level, countdown: 3, rivalPower: "auto", rivalId: id }));
    for (let i = 0; i < N; i++) {
      const sim = sims[i % sims.length];
      sim.reset(true);
      const last = ["", ""];
      const step = NotebookSim.prototype.step.bind(sim); // the unwrapped step (sims are reused across rounds)
      sim.step = ((inp: unknown) => {
        const r = step(inp as never);
        sim.fighters.forEach((f, k) => {
          const m = f.anim.busy ? f.anim.move : "";
          if (m !== last[k] && m && !["hit", "hitLow", "idle", "walk", "land", "jump", "block", "blockHit", "crouch", "jumpCrouch"].includes(m)) {
            if (k === 1) { c.rStart++; moves[m] = (moves[m] ?? 0) + 1; } else c.pStart++;
          }
          last[k] = m;
        });
        return r;
      }) as typeof sim.step;
      const drain = NotebookSim.prototype.drainFx.bind(sim);
      sim.drainFx = () => {
        const o = drain();
        for (const e of o.events as { kind: string; who?: number; x?: number }[]) {
          if (e.kind === "hit") e.who === 0 ? c.rHit++ : c.pHit++;
          if (e.kind === "block") {
            // block events carry no fighter: the blocker is the fighter nearest the spark
            const d = sim.fighters.map((f) => Math.abs(f.x - (e.x ?? 0)));
            d[0] <= d[1] ? c.rBlocked++ : c.pBlocked++;
          }
        }
        return o;
      };
      const r = playRound(sim);
      c.t += r.t - 3;
      c.n++;
      if (r.winner === 0) c.wins++;
    }
  }
  const pm = (v: number) => ((v / c.t) * 60).toFixed(1);
  console.log(`${level.padEnd(6)} rounds ${c.n} avg ${(c.t / c.n).toFixed(1)}s | per minute: rival attacks ${pm(c.rStart)}, rival hits landed ${pm(c.rHit)}, blocked by bot ${pm(c.rBlocked)} | bot attacks ${pm(c.pStart)}, bot hits ${pm(c.pHit)}, blocked by rival ${pm(c.pBlocked)} | rival share of hits ${((100 * c.rHit) / (c.rHit + c.pHit)).toFixed(0)}% | bot wins ${((100 * c.wins) / c.n).toFixed(0)}%  ${JSON.stringify(moves)}`);
}
