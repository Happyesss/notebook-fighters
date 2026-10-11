// Headless: main-page stats come from the rig reader. Print them and check they are sensible per body.
import { judgeDrawing } from "../../../apps/web/app/reading";
import { DRAWINGS } from "./drawings";
let bad = 0;
const rows = DRAWINGS.map((d, i) => ({ d, r: judgeDrawing(d.strokes, i) }));
for (const { d, r } of rows) console.log(`${d.name.padEnd(10)} ${r.kind.padEnd(30)} HP ${String(r.hp).padStart(3)}  P ${r.punch.toFixed(1)}  S ${r.speed.toFixed(1)}  | ${r.line}`);
const get = (n: string) => rows.find((x) => x.d.name === n)!.r;
const check = (ok: boolean, msg: string) => { if (!ok) { bad++; console.log("FAIL", msg); } };
check(get("blob").hp > get("clean").hp, "blob tougher than a stick man");
check(get("car").speed > get("clean").speed, "car faster than a stick man");
check(get("quadruped").speed > get("clean").speed, "dog faster than a stick man");
// the sword hits harder before the body pays for its shield doodle (the power budget)
check(get("swordsman").punch / get("swordsman").stats.bodyScale > get("clean").punch / get("clean").stats.bodyScale, "sword hits harder");
// like the sword: the trait itself, before the body-type balance (BODY_EDGE) scales the whole body
check(get("fourArms").punch / get("fourArms").stats.bodyScale > get("clean").punch / get("clean").stats.bodyScale, "four arms hit harder");
check(get("plusSign").speed < get("clean").speed, "legless is slower");
check(get("bigHead").hp / get("bigHead").stats.bodyScale > get("clean").hp / get("clean").stats.bodyScale, "big head soaks more");
check(rows.every(({ r }) => r.kind !== "rock"), "nothing drawn is a rock");
console.log(bad ? `${bad} FAILURES` : "STATS OK");
process.exit(bad ? 1 : 0);
