// Headless: the pre-drawn rivals' own specials. Halloween lobs a pumpkin that arcs and splats, the
// Skeleton falls to bits (the next hit whiffs) and reforms closer with a bony strike, the Pehelwan's
// stomp runs along the ground (a jump clears it), the Bodybuilder's mega leap lands in a smash.
import { NotebookSim, POWER_INFO, type PlayerInput, type RosterId, type Difficulty } from "../src/index";
import { DRAWINGS } from "./drawings";
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const IDLE: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
const clean = DRAWINGS.find((d) => d.name === "clean")!.strokes;
const mk = (id: RosterId, gap: number, difficulty: Difficulty = "normal") => {
  const sim = new NotebookSim({ player: clean, rivalId: id, rivalPower: "auto", difficulty, ai: "off", countdown: 0 });
  sim.fighters[0].x = -gap / 2;
  sim.fighters[1].x = gap / 2;
  sim.fighters[1].cool = 0; // skip the start-of-round wait
  return sim;
};
/** n frames: `me` is the player's input, `cpu` the rival's (frame index) */
const run = (sim: NotebookSim, n: number, me: (i: number) => PlayerInput = () => IDLE, cpu: (i: number) => PlayerInput = () => IDLE, each?: (i: number) => void) => {
  const fx: string[] = [];
  let shake = 0;
  for (let i = 0; i < n; i++) {
    (sim as any).think = () => cpu(i);
    sim.step(me(i));
    const d = sim.drainFx();
    shake = Math.max(shake, d.impact);
    fx.push(...d.events.map((e: any) => e.kind + (e.word ? ":" + e.word : "")));
    each?.(i);
  }
  return { fx: [...new Set(fx)], shake };
};
const at = (k: number, inp: Partial<PlayerInput>) => (i: number) => (i === k ? { ...IDLE, ...inp } : IDLE);

for (const [id, kind] of [["halloween", "pumpkin"], ["skeleton", "bones"], ["pehelwan", "quake"], ["bodybuilder", "leap"]] as const) {
  const sim = mk(id, 2);
  check(sim.fighters[1].special === kind, `${id}: own special ${POWER_INFO[kind].special} (not a drawn power), every ${sim.fighters[1].coolMax.toFixed(1)}s on Normal`);
}

// Halloween: THROW PUMPKIN arcs up then down, splats on the player (damage + a short stagger)
{
  const sim = mk("halloween", 2.2);
  const p = sim.fighters[0];
  const hp0 = p.hp;
  const ys: number[] = [];
  let stun = 0;
  const r = run(sim, 120, undefined, at(0, { special: true }), () => {
    const s = sim.projectiles.find((q) => q.kind === "pumpkin");
    if (s) ys.push(s.y);
    stun = Math.max(stun, p.stun);
  });
  const peak = Math.max(...ys);
  check(ys.length > 5 && peak > ys[0] + 0.05 && ys[ys.length - 1] < peak - 0.05, `halloween: pumpkin lobbed in an arc (from ${ys[0]?.toFixed(2)} up to ${peak.toFixed(2)}, down to ${ys[ys.length - 1]?.toFixed(2)})`);
  check(hp0 - p.hp > 5 && stun > 0.2, `halloween: the pumpkin splats for ${(hp0 - p.hp).toFixed(1)} and staggers ${stun.toFixed(2)}s · fx ${r.fx.filter((f) => f !== "land").join(" ")}`);
  const far = mk("halloween", 5.5);
  const r2 = run(far, 150, undefined, at(0, { special: true }));
  check(far.fighters[0].hp === far.fighters[0].stats.hp && r2.fx.some((f) => f.includes("SPLAT")), "halloween: a miss splats on the ground and hurts nobody");
}

// Skeleton: BONE SCATTER — the next hit passes through, then it reforms forward and strikes
{
  const sim = mk("skeleton", 1.3);
  const sk = sim.fighters[1];
  const p = sim.fighters[0];
  const x0 = sk.x;
  const hp0 = sk.hp;
  const php0 = p.hp;
  let scattered = 0;
  run(sim, 6, undefined, at(0, { special: true }), () => (scattered = Math.max(scattered, sk.scatter)));
  run(sim, 20, at(0, { punch: true }), () => IDLE);
  const hpMid = sk.hp;
  run(sim, 60);
  check(scattered > 0 && hpMid === hp0, `skeleton: falls to bits (scatter ${scattered.toFixed(2)}) and the punch passes through (HP ${hp0}→${hpMid})`);
  check(Math.abs(sk.x - x0) > 0.05 && php0 - p.hp > 3, `skeleton: reforms ${Math.abs(sk.x - x0).toFixed(2)} forward and strikes for ${(php0 - p.hp).toFixed(1)}`);
  const fire = mk("skeleton", 2);
  run(fire, 4, undefined, at(0, { special: true }));
  check(fire.fighters[1].scatter > 0 && fire.fighters[1].cool > 0, "skeleton: on cooldown after the scatter");
}

// Pehelwan: GROUND SHAKE hits a grounded foe; jumping clears it; the screen shakes
{
  const sim = mk("pehelwan", 2);
  const p = sim.fighters[0];
  const hp0 = p.hp;
  let stun = 0;
  const r = run(sim, 120, undefined, at(0, { special: true }), () => (stun = Math.max(stun, p.stun)));
  check(hp0 - p.hp > 4 && stun > 0.3 && r.shake >= 0.5, `pehelwan: the stomp's shockwave hits a grounded foe for ${(hp0 - p.hp).toFixed(1)}, stagger ${stun.toFixed(2)}s, shake ${r.shake.toFixed(2)}`);
  // jump just as the wave arrives
  const j = mk("pehelwan", 2);
  let first = -1;
  for (let i = 0; i < 120 && first < 0; i++) {
    (j as any).think = () => (i === 0 ? { ...IDLE, special: true } : IDLE);
    j.step(IDLE);
    j.drainFx();
    const w = j.projectiles.find((q) => q.kind === "quake");
    if (w && Math.abs(w.x - j.fighters[0].x) < 0.9) first = i;
  }
  const hp1 = j.fighters[0].hp;
  run(j, 90, at(0, { jump: true }));
  check(first > 0 && j.fighters[0].hp === hp1, `pehelwan: jumping over the shockwave takes no damage (HP ${hp1}→${j.fighters[0].hp})`);
}

// Bodybuilder: MEGA LEAP crosses the arena and lands in an area smash
{
  const sim = mk("bodybuilder", 3);
  const b = sim.fighters[1];
  const p = sim.fighters[0];
  const hp0 = p.hp;
  let top = 0;
  const x0 = b.x;
  const r = run(sim, 150, undefined, at(0, { special: true }), () => (top = Math.max(top, b.y)));
  check(top > 0.8 && Math.abs(b.x - x0) > 1.2, `bodybuilder: a huge leap (height ${top.toFixed(2)}, ${Math.abs(b.x - x0).toFixed(2)} across)`);
  check(hp0 - p.hp > 6 && r.shake >= 0.8, `bodybuilder: lands in a smash for ${(hp0 - p.hp).toFixed(1)}, shake ${r.shake.toFixed(2)} · fx ${r.fx.filter((f) => f !== "land").join(" ")}`);
}

// Easy is gentler: longer cooldown; Hard the shortest
for (const id of ["halloween", "skeleton", "pehelwan", "bodybuilder"] as const) {
  const [e, n, h] = (["easy", "normal", "hard"] as const).map((d) => mk(id, 2, d).fighters[1].coolMax);
  check(e > n && n > h, `${id}: cooldown easy ${e.toFixed(1)}s > normal ${n.toFixed(1)}s > hard ${h.toFixed(1)}s`);
}

// the CPU uses them, but not all the time; and it's all deterministic
for (const id of ["halloween", "skeleton", "pehelwan", "bodybuilder"] as const) {
  const play = () => {
    const sim = new NotebookSim({ player: clean, rivalId: id, rivalPower: "auto", difficulty: "hard", countdown: 0 });
    let uses = 0;
    const sums: number[] = [];
    for (let i = 0; i < 60 * 40; i++) {
      const c0 = sim.fighters[1].cool;
      sim.step({ ...IDLE, x: i % 240 < 120 ? 1 : -1, punch: i % 37 === 0, jump: i % 151 === 0 });
      if (sim.fighters[1].cool > c0 + 0.5) uses++;
      sim.drainFx();
      if (i % 60 === 0) sums.push(sim.checksum());
    }
    return { uses, sums: sums.join(",") };
  };
  const a = play();
  const b = play();
  check(a.uses >= 2 && a.uses <= 9 && a.sums === b.sums, `${id}: the CPU used it ${a.uses}× in 40 s on Hard (no spam), replay identical`);
}
console.log(bad ? `${bad} FAIL` : "SIGNATURES OK");
process.exit(bad);
