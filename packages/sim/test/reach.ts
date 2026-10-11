import { NotebookSim, J } from "../src/index";
const sim = new NotebookSim({ ai: "off" });
const [me, foe] = sim.fighters;
me.x = 0.57 - 1.1 + 1.1; foe.x = 1.13; me.x = 0.57;
for (let i = 0; i < 20; i++) sim.step({ x: 0, punch: false, kick: false, jump: false });
for (const move of ["kick", "punch"] as const) {
  me.x = 0.57; foe.x = 1.13;
  sim.step({ x: 0, punch: move === "punch", kick: move === "kick", jump: false });
  let best = 9;
  for (let i = 0; i < 45; i++) {
    sim.step({ x: 0, punch: false, kick: false, jump: false });
    const tip = me.world(me.anim.joints[move === "kick" ? J.footF : J.handF]);
    const pel = foe.world(foe.anim.joints[J.pelvis]);
    const d = tip.x - pel.x;
    if (me.anim.active) best = Math.min(best, Math.abs(d));
    if (i % 3 === 0) console.log(move, i, me.anim.move, me.anim.active ? "ACTIVE" : "", "tip", tip.x.toFixed(2), tip.y.toFixed(2), "foePelvis", pel.x.toFixed(2), "hp", foe.hp, "meX", me.x.toFixed(2));
  }
  console.log(move, "closest dx during active", best.toFixed(3));
  for (let i = 0; i < 40; i++) sim.step({ x: 0, punch: false, kick: false, jump: false });
}
