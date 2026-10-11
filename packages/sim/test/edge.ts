import { inferRig, Animator, CLIPS, J, skinStrokes, type MoveName } from "../src/index";
import { DRAWINGS } from "./drawings";
const dog = DRAWINGS.find((d) => d.name === "quadruped")!;
const cases: Record<string, { color: string; points: { x: number; y: number }[] }[]> = {
  dogFacingLeft: dog.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ x: 1 - p.x, y: p.y })) })),
  singleLine: [{ color: "k", points: [{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.9 }] }],
  scribble: [{ color: "k", points: Array.from({ length: 80 }, (_, i) => ({ x: 0.5 + Math.sin(i * 1.7) * 0.2, y: 0.5 + Math.cos(i * 2.3) * 0.2 })) }],
  noLegs: [{ color: "k", points: Array.from({ length: 25 }, (_, i) => ({ x: 0.5 + Math.cos(i / 3.8) * 0.08, y: 0.2 + Math.sin(i / 3.8) * 0.08 })) }, { color: "k", points: [{ x: 0.5, y: 0.28 }, { x: 0.5, y: 0.6 }] }, { color: "k", points: [{ x: 0.5, y: 0.35 }, { x: 0.7, y: 0.45 }] }],
  squiggleOnly: [{ color: "k", points: Array.from({ length: 60 }, (_, i) => ({ x: 0.1 + i * 0.013, y: 0.5 + Math.sin(i / 4) * 0.05 })) }],
  dot: [{ color: "k", points: [{ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.502 }] }],
  randomLines: Array.from({ length: 30 }, (_, i) => ({ color: "k", points: [{ x: 0.5 + Math.sin(i * 12.9) * 0.4, y: 0.5 + Math.cos(i * 7.1) * 0.4 }, { x: 0.5 + Math.sin(i * 3.3) * 0.4, y: 0.5 + Math.cos(i * 5.7) * 0.4 }] })),
  carFacingLeft: DRAWINGS.find((d) => d.name === "car")!.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ x: 1 - p.x, y: p.y })) })),
  armsOnly: [{ color: "k", points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }] }, { color: "k", points: [{ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.7 }] }],
};
let bad = 0;
for (const [name, strokes] of Object.entries(cases)) {
  const rig = inferRig(strokes)!;
  const a = new Animator(rig);
  let ok = true;
  for (const m of [...Object.keys(CLIPS), "ko"] as MoveName[]) {
    if (m === "ko") a.knockout({ x: -1, y: 1 }, 1 / 60);
    else a.play(m);
    for (let i = 0; i < 40; i++) a.update(1 / 60, { speed: m === "walk" ? 1 : 0 });
    if (a.joints.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) ok = false;
    if (skinStrokes(rig, a.joints, a.deform).some((s) => s.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) ok = false;
  }
  // a car drawn facing left must be turned round to face its foe
  if (name === "carFacingLeft" && !rig.mirrored) ok = false;
  if (!ok) bad++;
  console.log(`${ok ? "ok " : "NaN"} ${name}: plan=${rig.plan} mirrored=${rig.mirrored} kind="${rig.kind}" moves=${a.moves.punch}/${a.moves.kick} parts=[${rig.parts.join(", ")}]`);
}
process.exit(bad);
