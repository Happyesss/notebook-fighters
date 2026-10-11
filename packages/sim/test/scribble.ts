// Headless: drawing a part over again (darker) makes it stronger, and only that part; the extra passes
// never become extra limbs; the scribble budget caps the total; no drawing is best at everything.
import { computeStats, inferRig } from "../src/index";
import { judgeDrawing } from "../../../apps/web/app/reading";
import { DRAWINGS, SCRIBBLED } from "./drawings";
import type { InkStroke } from "@nf/shared";

const clean = DRAWINGS[0].strokes;
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const st = (strokes: InkStroke[]) => {
  const rig = inferRig(strokes)!;
  return { rig, s: computeStats(rig) };
};
const base = st(clean);
for (const [name, strokes] of Object.entries(SCRIBBLED)) {
  const { rig, s: x } = st(strokes);
  console.log(`     ${name.padEnd(15)} ${rig.kind.padEnd(10)} HP ${x.hp} punch ×${x.dmg.punch} kick ×${x.dmg.kick} speed ×${x.speed} budget ${(x.budget * 100).toFixed(0)}% | ${x.lines.map((l) => l.text).join("; ")}`);
  check(rig.kind === "fighter" && rig.aux.length === 0, `${name}: still a plain fighter, the extra passes are not extra limbs`);
}
const arm = st(SCRIBBLED.darkRightArm).s;
check(arm.dmg.punch >= base.s.dmg.punch * 1.25 && Math.abs(arm.hp - base.s.hp) <= 2 && Math.abs(arm.dmg.kick - base.s.dmg.kick) <= 0.02, "dark right arm: punch +25% or more, HP and kick unchanged");
check(arm.lines[0]?.text.startsWith("very dark right arm (4 passes): punch +"), `the card says why: "${arm.lines[0]?.text}"`);
check(st(SCRIBBLED.scrubbedArm).s.dmg.punch > base.s.dmg.punch * 1.25, "one back-and-forth scrub along the arm counts as passes too");
const head = st(SCRIBBLED.darkHead).s;
check(head.hp >= base.s.hp * 1.2 && head.armour.head < 0.85, "dark head: HP +20% or more and head hits hurt less");
const legs = st(SCRIBBLED.darkLegs).s;
check(legs.speed > base.s.speed * 1.08 && legs.jump > base.s.jump && legs.dmg.kick > base.s.dmg.kick * 1.2, "dark legs: faster, jump higher, kick harder");
const all = st(SCRIBBLED.darkEverything).s;
check(all.budget >= 1 && all.lines.some((l) => l.text.startsWith("over the scribble budget")), "darkening everything hits the scribble budget");
check(all.dmg.punch < arm.dmg.punch && all.hp < head.hp && all.speed <= legs.speed, "…so it is not best at anything: the specialists beat it at their thing");
// no drawing is best at everything (HP, hits, speed) among all test drawings + the scribbled ones
const cards = [...DRAWINGS.map((d, i) => ({ n: d.name, r: judgeDrawing(d.strokes, i) })), ...Object.entries(SCRIBBLED).map(([n, d], i) => ({ n, r: judgeDrawing(d, i) }))];
const dominant = cards.filter((a) => cards.every((b) => b === a || (a.r.hp >= b.r.hp && a.r.punch >= b.r.punch && a.r.speed >= b.r.speed)));
check(dominant.length === 0, `no drawing is best at HP, hits and speed at once${dominant.length ? ": " + dominant.map((d) => d.n).join(", ") : ""}`);
console.log(bad ? `${bad} FAILURES` : "SCRIBBLE OK");
process.exit(bad ? 1 : 0);
