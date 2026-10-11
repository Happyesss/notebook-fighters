// Headless: run the reader over every test drawing and check the part labels + bone binding.
import { inferRig, BONE_NAMES } from "../src/index";
import { DRAWINGS } from "./drawings";
import { POWERED, SCRIBBLED } from "./drawings";
import fs from "node:fs";
let fail = 0;
for (const d of DRAWINGS) {
  const rig = inferRig(d.strokes)!;
  const planOk = rig.plan === d.plan;
  if (!planOk) fail++;
  console.log(`\n== ${d.name}: plan=${rig.plan}${planOk ? "" : " (WANT " + d.plan + ")"} mirrored=${rig.mirrored} aux=${rig.aux.length} found=${Object.entries(rig.found).filter(([, v]) => v).map(([k]) => k).join(",")} strike=${JSON.stringify(rig.strike)}`);
  rig.strokes.forEach((s, i) => {
    const bones = [...new Set(s.points.map((p) => (p.b0 < 10 ? BONE_NAMES[p.b0] : `aux${Math.floor((p.b0 - 10) / 2)}${(p.b0 - 10) % 2 ? "lo" : "up"}`)))];
    const want = d.expect[i];
    const ok = !want || s.part === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${i} part=${s.part.padEnd(6)} label="${s.label}" bones=${bones.join("+")}${want ? " want=" + want : ""}`);
  });
}
fs.writeFileSync(new URL("../../../e2e/drawings.json", import.meta.url), JSON.stringify([...DRAWINGS.map((d) => ({ name: d.name, strokes: d.strokes })), ...Object.entries(SCRIBBLED).map(([name, strokes]) => ({ name, strokes })), ...Object.entries(POWERED).map(([name, d]) => ({ name: "power_" + name, strokes: d.strokes }))]));
console.log(fail ? `\n${fail} FAILURES` : "\nALL OK");
process.exit(fail ? 1 : 0);
