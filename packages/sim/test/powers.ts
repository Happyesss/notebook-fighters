// Headless: the power reader finds each add-on doodle (and nothing on plain drawings), and the
// doodles don't disturb the fighter's own parts.
import { inferRig, POWER_INFO } from "../src/index";
import { DRAWINGS, POWERED, SCRIBBLED } from "./drawings";
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
for (const [name, d] of Object.entries(POWERED)) {
  const rig = inferRig(d.strokes)!;
  const kinds = rig.powers.map((p) => p.kind);
  check(kinds.length === 1 && kinds[0] === d.expect && rig.kind === "fighter" && rig.found.armF && rig.found.legF, `${name.padEnd(14)} → ${kinds.join("+") || "none"} (want ${d.expect}: special ${POWER_INFO[d.expect].special}); body still "${rig.kind}"; parts ${rig.parts.slice(6).join(", ")}`);
}
for (const d of [...DRAWINGS, ...Object.entries(SCRIBBLED).map(([name, strokes]) => ({ name, strokes }))]) {
  const rig = inferRig(d.strokes)!;
  const want = d.name === "swordsman" ? ["shield"] : [];
  check(JSON.stringify(rig.powers.map((p) => p.kind)) === JSON.stringify(want), `${d.name.padEnd(14)} plain drawing → ${rig.powers.map((p) => p.kind).join("+") || "no powers"}`);
}
console.log(bad ? `${bad} FAILURES` : "POWERS READ OK");
process.exit(bad ? 1 : 0);
