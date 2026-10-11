// Headless: every test drawing vs the rival. Each body's own moves (bite, slam, ram, swing …) must land,
// the rival's hits and blocks must land on it, and the drawing must also work as the rival.
import { NotebookSim, MOVE_TITLES, type MoveName } from "../src/index";
import { DRAWINGS } from "./drawings";
const NONE = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false };
let bad = 0;
const only = process.argv[2];
for (const d of DRAWINGS) {
  if (only && d.name !== only) continue;
  const res: string[] = [];
  const probe = new NotebookSim({ player: d.strokes, ai: "off" }).fighters[0].anim.moves;
  const extra = [probe.air, probe.run].filter((m): m is MoveName => !!m && m !== probe.punch && m !== probe.kick);
  const tests = ["punch", "kick", ...extra.map((m) => `force:${m}`), "rivalPunch", "rivalKick", "block", "asRivalPunch", "asRivalKick"];
  for (const test of tests) {
    const asRival = test.startsWith("asRival");
    const sim = new NotebookSim(asRival ? { rival: d.strokes, ai: "off" } : { player: d.strokes, ai: "off" });
    const [me, foe] = sim.fighters;
    me.x = 0;
    foe.x = 0.2 + me.rig.extent.front + foe.rig.extent.front;
    for (let i = 0; i < 20; i++) sim.step({ ...NONE, block: test === "block" });
    const hp0 = [me.hp, foe.hp];
    let played = "";
    if (test === "punch" || test === "kick") {
      sim.step({ ...NONE, [test]: true });
      played = me.anim.move;
    } else if (test.startsWith("force:")) {
      sim.force(0, test.slice(6));
      played = me.anim.move;
    } else sim.forced.push({ who: 1, move: test.endsWith("Kick") ? "kick" : "punch" });
    let blocked = false;
    for (let i = 0; i < 70; i++) {
      sim.step({ ...NONE, block: test === "block" });
      if (me.anim.move === "blockHit") blocked = true;
      if (asRival && !played && foe.anim.move !== "idle") played = foe.anim.move;
    }
    const mine = test === "punch" || test === "kick" || test.startsWith("force:");
    const ok = test === "block" ? blocked : mine ? foe.hp < hp0[1] : me.hp < hp0[0];
    if (!ok) bad++;
    const label = test.startsWith("force:") ? test.slice(6) : test;
    res.push(`${label}${played && !test.startsWith("force:") ? "(" + (MOVE_TITLES[played as MoveName] ?? played) + ")" : ""}:${ok ? "ok" : "MISS"}`);
  }
  console.log(d.name.padEnd(10), res.join("  "));
}
console.log(bad ? `${bad} MISSES` : "ALL LAND");
process.exit(bad ? 1 : 0);
