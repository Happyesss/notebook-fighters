// The bot against every pre-drawn rival on every level (all body types, N rounds each): each rival
// gets a sensible win rate, the bot does worse as the level goes up, and the Bodybuilder (the Hulk)
// stays the hardest. `pnpm --filter @nf/sim rivals [N]`
import { NotebookSim, ROSTER, type Difficulty } from "../src/index";
import { playRound, BODIES, bodyStrokes } from "./bot";
const N = Number(process.argv[2] ?? 6);
const LV: Difficulty[] = ["easy", "normal", "hard"];
const rate: Record<string, Record<string, number>> = {};
const ONLY = process.env.ONLY?.split(",");
const LIST = ROSTER.filter((r) => !ONLY || ONLY.includes(r.id));
for (const r of LIST) {
  rate[r.id] = {};
  for (const level of LV) {
    let w = 0;
    let n = 0;
    for (const who of BODIES) {
      const sim = new NotebookSim({ player: bodyStrokes(who), difficulty: level, countdown: 3, rivalPower: "auto", rivalId: r.id });
      for (let i = 0; i < N; i++) {
        sim.reset(true);
        if (playRound(sim).winner === 0) w++;
        n++;
      }
    }
    rate[r.id][level] = w / n;
  }
  console.log(`${r.name.padEnd(12)} tier ${r.tier}  bot wins  ${LV.map((l) => `${l} ${(rate[r.id][l] * 100).toFixed(0).padStart(3)}%`).join("  ")}`);
}
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "BAD "} ${msg}`);
  if (!ok) bad++;
};
for (const r of LIST) {
  const [e, n, h] = LV.map((l) => rate[r.id][l]);
  check(e >= 0.3 && e <= 0.95 && h >= 0.08 && h <= 0.8 && e >= h - 0.05, `${r.name}: sensible on every level (easy ${(e * 100).toFixed(0)}% ≥ hard ${(h * 100).toFixed(0)}%)`);
}
const hard = LIST.map((r) => [r.id, rate[r.id].hard] as const).sort((a, b) => a[1] - b[1]);
if (!ONLY) check(hard[0][0] === "bodybuilder", `the hardest rival on Hard: ${hard[0][0]} (bot wins ${(hard[0][1] * 100).toFixed(0)}%)`);
console.log(bad ? `${bad} BAD` : "RIVALS OK");
process.exit(bad);
