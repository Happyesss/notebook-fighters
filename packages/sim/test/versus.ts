// Headless: local 2-player. Player 2's input drives the second fighter (no CPU), both get the
// same step-in help, both can use their drawn specials, and a best-of-3 match is scored.
import { NotebookSim, type PlayerInput } from "../src/index";
import { DRAWINGS, POWERED } from "./drawings";
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const IDLE: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
const clean = DRAWINGS.find((d) => d.name === "clean")!.strokes;
{
  const sim = new NotebookSim({ player: clean, rival: DRAWINGS.find((d) => d.name === "quadruped")!.strokes, ai: "versus", countdown: 0 });
  // P2 idles: the CPU must not act for it
  for (let i = 0; i < 240; i++) sim.step(IDLE, undefined, IDLE);
  check(Math.abs(sim.fighters[1].x - 1.1) < 0.05 && sim.fighters[0].hp === sim.fighters[0].stats.hp, `P2 idle stays put (x ${sim.fighters[1].x.toFixed(2)}), no CPU attacks`);
  // P2 walks left (toward P1) and attacks
  let p2hits = 0;
  for (let i = 0; i < 300; i++) {
    const [a, b] = sim.fighters;
    const gap = b.x - a.x - a.rig.extent.front - b.rig.extent.front;
    sim.step(IDLE, undefined, { ...IDLE, x: gap > 0.25 ? -1 : 0, punch: gap <= 0.25 && i % 20 === 0, kick: gap <= 0.25 && i % 20 === 10 });
    p2hits += sim.drainFx().events.filter((e) => e.kind === "hit").length;
  }
  check(p2hits >= 3 && sim.fighters[0].hp < sim.fighters[0].stats.hp, `P2 walks in and lands ${p2hits} hits (P1 HP ${sim.fighters[0].hp.toFixed(0)})`);
  check(sim.fighters[1].facing === -1 && sim.fighters[0].facing === 1, "they face each other");
}
{
  // both mash at once until someone wins the match (best of 3)
  const sim = new NotebookSim({ player: POWERED.fire.strokes, rival: POWERED.water.strokes, ai: "versus", countdown: 0 });
  let rounds = 0;
  let specials = 0;
  for (let i = 0; i < 60 * 300 && sim.curr.matchWinner === null; i++) {
    const [a, b] = sim.fighters;
    const gap = b.x - a.x;
    const p1: PlayerInput = { ...IDLE, x: gap > 0.7 ? 1 : 0, punch: i % 23 === 0, kick: i % 37 === 5, special: i % 97 === 0 };
    const p2: PlayerInput = { ...IDLE, x: gap > 0.7 ? -1 : 0, punch: i % 29 === 3, kick: i % 31 === 7, block: i % 120 < 20, special: i % 101 === 0 };
    sim.step(p1, undefined, p2);
    specials += sim.drainFx().events.filter((e) => e.kind === "special").length;
    if (sim.curr.over && !sim.curr.matchWinner && sim.curr.matchWinner !== 0) {
      for (let k = 0; k < 120; k++) sim.step(IDLE, undefined, IDLE);
      rounds++;
      if (sim.curr.matchWinner === null) sim.rematch();
    }
  }
  check(sim.curr.matchWinner !== null && Math.max(...sim.curr.wins) === 2, `a best-of-3 match ends ${sim.curr.wins.join("–")} (winner P${(sim.curr.matchWinner ?? -1) + 1}) after ${rounds + 1} rounds; ${specials} specials thrown by both`);
}
console.log(bad ? `${bad} FAILURES` : "VERSUS OK");
process.exit(bad ? 1 : 0);
