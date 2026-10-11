// Debug: one body against each rival power (Normal), to see which rival power is too weak/strong.
import { NotebookSim, type PowerKind } from "../src/index";
import { bodyStrokes, playRound } from "./bot";
const who = process.argv[2] ?? "clean";
const N = Number(process.argv[3] ?? 60);
for (const rp of [null, "fire", "water", "lightning", "ice", "wings", "shield", "spikes"] as (PowerKind | null)[]) {
  const sim = new NotebookSim({ player: bodyStrokes(who), difficulty: "normal", countdown: 3, rivalPower: rp });
  let w = 0;
  for (let i = 0; i < N; i++) {
    sim.reset(true);
    if (playRound(sim).winner === 0) w++;
  }
  console.log(`${who} vs ${rp ?? "-"}: bot wins ${Math.round((w / N) * 100)}%`);
}
