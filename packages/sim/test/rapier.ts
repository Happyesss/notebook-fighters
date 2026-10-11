// Headless: the Rapier2D (deterministic build) KO ragdoll. Every drawing falls, lies on (not in) the
// floor and settles; a full versus match with Rapier KOs is bit-for-bit repeatable (checksums), which
// is what the lockstep netcode needs.
import { Animator, NotebookSim, RapierRagdoll, RapierTumble, createSim, inferRig, loadPhysics, physicsVersion, skinStrokes, J, type PlayerInput } from "../src/index";
import { DRAWINGS, POWERED } from "./drawings";
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
check(await loadPhysics(), `Rapier loaded (${physicsVersion()})`);
const all = [...DRAWINGS.map((d) => [d.name, d.strokes] as const), ...Object.entries(POWERED).map(([k, v]) => [k, v.strokes] as const)];
for (const [name, strokes] of all) {
  const a = new Animator(inferRig(strokes)!);
  a.physics = "rapier";
  for (let i = 0; i < 20; i++) a.update(1 / 60);
  const chest0 = a.joints[J.chest].y;
  const crown0 = a.joints[J.crown].y;
  a.knockout({ x: -1.5, y: 1.1 }, 1 / 60);
  let worst = 0;
  let peak = -9;
  let finite = true;
  for (let i = 0; i < 300; i++) {
    a.update(1 / 60);
    peak = Math.max(peak, a.joints[J.chest].y);
    finite &&= a.joints.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (i > 30) worst = Math.min(worst, ...skinStrokes(a.rig, a.joints, a.deform).flatMap((s) => s.points.map((p) => p.y)));
  }
  const rapier = a.ragdoll instanceof RapierRagdoll || a.ragdoll instanceof RapierTumble;
  // a car goes over onto its roof (axle pelvis→chest flips)
  const dx = a.joints[J.chest].x - a.joints[J.pelvis].x;
  const dy = a.joints[J.chest].y - a.joints[J.pelvis].y;
  const rolled = a.rig.plan !== "vehicle" || (dx < 0 && Math.abs(dy) < 0.25);
  const end = Math.min(...skinStrokes(a.rig, a.joints, a.deform).flatMap((s) => s.points.map((p) => p.y)));
  const settled = (a.ragdoll as { settled: number } | null)?.settled ?? 0;
  const vehicle = a.rig.plan === "vehicle";
  // down = the body (or, for a giant head, the head) ends well below where it stood
  const fell = a.rig.plan !== "biped" || a.joints[J.chest].y < chest0 - 0.05 || a.joints[J.crown].y < crown0 - 0.2;
  const ok = finite && rapier && rolled && worst > -0.1 && end > -0.05 && fell && settled > 0.2;
  check(ok, `${name.padEnd(10)} ${vehicle ? `rapier tumble (axle dx ${dx.toFixed(2)})` : "rapier"} · chest ${chest0.toFixed(2)}→${a.joints[J.chest].y.toFixed(2)} (peak ${peak.toFixed(2)}) · lowest ink ${worst.toFixed(3)} · rest ${end.toFixed(3)} · settled ${settled.toFixed(2)}s`);
  a.revive();
}

// determinism: a mashing versus match (scripted pseudo-random inputs) twice → identical checksums
const IDLE: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
function scripted(seed: number) {
  let s = seed;
  const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  return (sim: NotebookSim, me: 0 | 1): PlayerInput => {
    const [a, b] = sim.fighters;
    const self = me ? b : a;
    const foe = me ? a : b;
    const toward = foe.x > self.x ? 1 : -1;
    const v = r();
    return { ...IDLE, x: v < 0.55 ? toward : v < 0.62 ? -toward : 0, punch: r() < 0.12, kick: r() < 0.08, jump: r() < 0.01, block: r() < 0.01, special: r() < 0.02 };
  };
}
async function match(physics: "rapier" | "classic") {
  const sim = await createSim({ player: POWERED.fire.strokes, rival: DRAWINGS.find((d) => d.name === "quadruped")!.strokes, ai: "versus", countdown: 0, physics });
  const p1 = scripted(7);
  const p2 = scripted(99);
  const sums: number[] = [];
  let kos = 0;
  let overFor = 0;
  for (let i = 0; i < 60 * 300 && sim.matchWinner === null; i++) {
    // between rounds: the next one starts 3 s after the KO (as online play does)
    overFor = sim.curr.over ? overFor + 1 : 0;
    if (overFor > 180) sim.rematch();
    sim.step(p1(sim, 0), undefined, p2(sim, 1));
    kos += sim.drainFx().events.filter((e) => e.kind === "ko").length;
    if (i % 30 === 0) sums.push(sim.checksum());
  }
  const out = { winner: sim.matchWinner, wins: [...sim.wins], frames: sim.frame, sums, kos, phys: sim.koPhysics };
  sim.dispose();
  return out;
}
const a = await match("rapier");
const b = await match("rapier");
const c = await match("classic");
check(a.phys === "rapier" && a.winner !== null && a.kos >= 2, `rapier match: winner P${(a.winner ?? -1) + 1} ${a.wins.join("-")} in ${a.frames} frames, ${a.kos} KOs`);
check(a.sums.length === b.sums.length && a.sums.every((x, i) => x === b.sums[i]) && a.winner === b.winner, `replayed match identical: ${a.sums.length} checksums match (last ${a.sums.at(-1)?.toString(16)})`);
const diverge = a.sums.findIndex((x, i) => x !== c.sums[i]);
check(diverge > 0, `classic vs rapier diverge only after the first KO (checksum #${diverge}) — Rapier really drives the KO`);
console.log(bad ? `${bad} FAIL` : "RAPIER OK");
process.exit(bad);
