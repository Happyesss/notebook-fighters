import { NotebookSim, skinStrokes, J } from "../src/index";
import { DRAWINGS } from "./drawings";
const NONE = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false };
const [name, whoS, move] = process.argv.slice(2);
const who = Number(whoS);
const d = DRAWINGS.find((x) => x.name === name)!;
const sim = new NotebookSim({ player: d.strokes, ai: "off" });
const [me, foe] = sim.fighters;
me.x = 0; foe.x = 0.2 + me.rig.extent.front + foe.rig.extent.front;
for (let i = 0; i < 20; i++) sim.step(NONE);
if (who === 1) sim.forced.push({ who: 1, move }); else sim.force(0, move);
const att = sim.fighters[who], vic = sim.fighters[1 - who];
let best = 9, info = "";
for (let i = 0; i < 60; i++) {
  sim.step(NONE);
  const tip = att.tip;
  if (!tip || !att.anim.active) continue;
  for (const s of skinStrokes(vic.rig, vic.anim.joints, vic.anim.deform)) for (const p of s.points) { const w = vic.world(p); const dd = Math.hypot(w.x - tip.x, w.y - tip.y); if (dd < best) { best = dd; info = `f${i} tip=(${tip.x.toFixed(2)},${tip.y.toFixed(2)}) ink=(${w.x.toFixed(2)},${w.y.toFixed(2)}) ${s.label} attX=${att.x.toFixed(2)} vicX=${vic.x.toFixed(2)} aim=${att.anim.aim.toFixed(2)}`; } }
}
const ys = skinStrokes(vic.rig, vic.anim.joints).flatMap((s) => s.points.map((p) => p.y));
console.log(name, move, "closest(tip)", best.toFixed(3), info, "vic hp", vic.hp, "vic y range", Math.min(...ys).toFixed(2), Math.max(...ys).toFixed(2), "front", vic.rig.extent.front.toFixed(2), att.rig.extent.front.toFixed(2));
