// Calibrate BODY_EDGE: play the human-like bot with each body type on Normal and nudge each type's
// power until it wins about half its rounds. Prints the table to paste into stats.ts.
import { BODY_EDGE, NotebookSim, bodyClass, inferRig, type BodyClass } from "../src/index";
import { DRAWINGS } from "./drawings";
import { BODIES, playRound } from "./bot";
const N = Number(process.argv[2] ?? 40);
const iters = Number(process.argv[3] ?? 4);
for (let it = 0; it < iters; it++) {
  const rates = new Map<BodyClass, number[]>();
  for (const who of BODIES) {
    const strokes = DRAWINGS.find((d) => d.name === who)!.strokes;
    const cls = bodyClass(inferRig(strokes)!);
    const sim = new NotebookSim({ player: strokes, difficulty: "normal", countdown: 3 });
    let wins = 0;
    for (let i = 0; i < N; i++) {
      sim.reset(true);
      if (playRound(sim).winner === 0) wins++;
    }
    if (!rates.has(cls)) rates.set(cls, []);
    rates.get(cls)!.push(wins / N);
  }
  const line: string[] = [];
  for (const [cls, rs] of rates) {
    if (cls === "biped") {
      line.push(`biped ${(rs.reduce((a, b) => a + b, 0) / rs.length * 100).toFixed(0)}% (reference: the CPU rival is a biped)`);
      continue;
    }
    const r = Math.min(0.92, Math.max(0.08, rs.reduce((a, b) => a + b, 0) / rs.length));
    const odds = r / (1 - r);
    BODY_EDGE[cls] = Math.round(BODY_EDGE[cls] * Math.pow(odds, 1 / 5) * 100) / 100;
    line.push(`${cls} ${(r * 100).toFixed(0)}%→${BODY_EDGE[cls]}`);
  }
  console.log(`iter ${it}: ${line.join("  ")}`);
}
console.log(JSON.stringify(BODY_EDGE));
