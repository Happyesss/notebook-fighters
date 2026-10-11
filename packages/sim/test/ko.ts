// Headless: every drawing's knockout ends lying on (not in) the floor; a car rolls onto its roof;
// a snake twitches, then settles.
import { inferRig, Animator, skinStrokes, J } from "../src/index";
import { DRAWINGS } from "./drawings";
let bad = 0;
for (const d of DRAWINGS) {
  const a = new Animator(inferRig(d.strokes)!);
  for (let i = 0; i < 20; i++) a.update(1 / 60);
  a.knockout({ x: -1.5, y: 1.1 }, 1 / 60);
  const amps: number[] = [];
  let worst = 0;
  for (let i = 0; i < 240; i++) {
    a.update(1 / 60);
    amps.push(a.deform.waveAmp);
    if (i > 30) worst = Math.min(worst, ...skinStrokes(a.rig, a.joints, a.deform).flatMap((s) => s.points.map((p) => p.y)));
  }
  const notes: string[] = [];
  const end = Math.min(...skinStrokes(a.rig, a.joints, a.deform).flatMap((s) => s.points.map((p) => p.y)));
  // a brief dip while landing is allowed (a fraction of a head), lying at rest in the floor is not
  if (worst < -0.08) notes.push(`ink dips ${worst.toFixed(2)} into the floor`);
  if (end < -0.03) notes.push(`ink rests ${end.toFixed(2)} into the floor`);
  if (a.rig.plan === "vehicle") {
    const dx = a.joints[J.chest].x - a.joints[J.pelvis].x;
    const dy = a.joints[J.chest].y - a.joints[J.pelvis].y;
    if (!(dx < 0 && Math.abs(dy) < 0.2)) notes.push(`car did not roll over (axle dx=${dx.toFixed(2)})`);
  }
  if (a.rig.plan === "serpent") {
    const early = Math.max(...amps.slice(0, 120)) - Math.min(...amps.slice(0, 120));
    const late = Math.max(...amps.slice(200)) - Math.min(...amps.slice(200));
    if (!(early > 0.02 && late < 0.004)) notes.push(`snake ripple: early swing ${early.toFixed(3)}, late swing ${late.toFixed(3)}`);
  }
  if (notes.length) bad++;
  console.log(`${notes.length ? "BAD" : "ok "} ${d.name.padEnd(10)} lowest ink ${worst.toFixed(3)} at rest ${end.toFixed(3)} ${notes.join("; ")}`);
}
console.log(bad ? `${bad} BAD` : "KO OK");
process.exit(bad);
