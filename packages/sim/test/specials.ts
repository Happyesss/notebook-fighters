// Headless: every drawn power does its thing in the sim — shots fly and hurt, dashes stun, wings
// double-jump, a drawn shield stops a shot, spikes hurt the attacker, ice slows, water douses fire.
import { NotebookSim, POWER_INFO, type PlayerInput } from "../src/index";
import { DRAWINGS, POWERED } from "./drawings";
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const IDLE: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
const clean = DRAWINGS.find((d) => d.name === "clean")!.strokes;
const mk = (p: string | null, r: string | null, gap = 1.6) => {
  const sim = new NotebookSim({ player: p ? POWERED[p].strokes : clean, rival: r ? POWERED[r].strokes : clean, ai: "off", countdown: 0 });
  sim.fighters[0].x = -gap / 2;
  sim.fighters[1].x = gap / 2;
  return sim;
};
const run = (sim: NotebookSim, n: number, inp: (i: number) => PlayerInput = () => IDLE, rival?: (i: number) => PlayerInput) => {
  for (let i = 0; i < n; i++) {
    if (rival) (sim as any).think = () => rival(i);
    sim.step(inp(i));
  }
};
const press = (k: keyof PlayerInput) => (i: number) => (i === 0 ? { ...IDLE, [k]: true } : IDLE);

for (const [name, d] of Object.entries(POWERED)) {
  const sim = mk(name, null, d.expect === "spikes" ? 0.8 : d.expect === "shield" ? 1.0 : d.expect === "lightning" ? 1.3 : 1.6);
  const me = sim.fighters[0];
  const foe = sim.fighters[1];
  check(me.special === d.expect || (d.expect === "spikes" && me.special === "spikes"), `${name}: special ${me.special} (${POWER_INFO[d.expect].special})`);
  const hp0 = foe.hp;
  let shots = 0;
  const fx: string[] = [];
  for (let i = 0; i < 150; i++) {
    sim.step(i === 0 ? { ...IDLE, special: true } : IDLE);
    shots = Math.max(shots, sim.projectiles.length);
    fx.push(...sim.drainFx().events.map((e: any) => e.kind + (e.word ? ":" + e.word : "")));
  }
  const dealt = hp0 - foe.hp;
  check(dealt > 3 && me.cool > 0, `${name}: ${POWER_INFO[d.expect].special} hits for ${dealt.toFixed(1)} (shots ${shots}, cooldown left ${me.cool.toFixed(1)}s) fx ${[...new Set(fx)].filter((f) => f !== "land" && f !== "whoosh").join(" ")}`);
  // pressing again during the cooldown does nothing
  const cool = me.cool;
  sim.step({ ...IDLE, special: true });
  check(me.cool < cool && sim.projectiles.length === 0, `${name}: no second special on cooldown`);
}
// fire burns; ice slows; water puddle
{
  const sim = mk("fire", null);
  run(sim, 60, press("special"));
  check(sim.fighters[1].burn.t > 0 || sim.fighters[1].hp < sim.fighters[1].stats.hp - 9, "fireball sets the rival burning");
}
{
  const sim = mk("ice", null);
  run(sim, 60, press("special"));
  check(sim.fighters[1].frozen > 0, `ice shard freezes (${sim.fighters[1].frozen.toFixed(2)}s)`);
  const x0 = sim.fighters[1].x;
  run(sim, 30, () => IDLE, () => ({ ...IDLE, x: 1 }));
  const slow = Math.abs(sim.fighters[1].x - x0);
  const s2 = mk(null, null);
  const x1 = s2.fighters[1].x;
  run(s2, 30, () => IDLE, () => ({ ...IDLE, x: 1 }));
  const norm = Math.abs(s2.fighters[1].x - x1);
  check(slow < norm * 0.75, `frozen walks slower: ${slow.toFixed(2)} vs ${norm.toFixed(2)}`);
}
{
  const sim = mk("water", null);
  run(sim, 70, press("special"));
  check(sim.puddles.length > 0, `water wave leaves a puddle (${sim.puddles.length})`);
}
// lightning dash goes through and stuns
{
  const sim = mk("lightning", null, 1.2);
  let stun = 0;
  run(sim, 40, (i) => { stun = Math.max(stun, sim.fighters[1].stun); return i === 0 ? { ...IDLE, special: true } : IDLE; });
  check(stun >= 0.25 && sim.fighters[0].x > sim.fighters[1].x - 0.3, `lightning dash stuns (${stun.toFixed(2)}s) and ends past/at the rival (x ${sim.fighters[0].x.toFixed(2)} vs ${sim.fighters[1].x.toFixed(2)})`);
}
// wings: double jump
{
  const a = mk("wings", null);
  const b = mk(null, null);
  const jump = (sim: NotebookSim) => {
    let top = 0;
    run(sim, 90, (i) => { top = Math.max(top, sim.fighters[0].y); return i === 0 || i === 22 ? { ...IDLE, jump: true } : IDLE; });
    return top;
  };
  const ta = jump(a), tb = jump(b);
  check(ta > tb * 1.2, `wings double-jump higher: ${ta.toFixed(2)} vs ${tb.toFixed(2)}`);
}
// shield blocks a fireball completely; bare block takes chip
{
  for (const def of ["shield", null]) {
    const sim = mk("fire", def);
    const hp0 = sim.fighters[1].hp;
    run(sim, 80, press("special"), () => ({ ...IDLE, block: true }));
    const took = hp0 - sim.fighters[1].hp;
    check(def ? took === 0 : took > 0 && took < 4, `${def ?? "bare"} block vs fireball: takes ${took.toFixed(2)}`);
  }
}
// spikes: punching a spiky fighter hurts
{
  const sim = mk(null, "spikes", 0.9);
  const hp0 = sim.fighters[0].hp;
  run(sim, 50, press("punch"));
  const took = hp0 - sim.fighters[0].hp;
  check(sim.fighters[1].hp < sim.fighters[1].stats.hp && took > 0, `thorns: punching spikes costs ${took.toFixed(2)} HP`);
}
// counters: water douses a fireball; water hits fire ×1.5
{
  const sim = mk("fire", "water", 2.4);
  const words: string[] = [];
  run(sim, 120, (i) => { words.push(...sim.drainFx().events.filter((e: any) => e.kind === "clash").map((e: any) => e.word)); return i === 0 ? { ...IDLE, special: true } : IDLE; }, (i) => (i === 0 ? { ...IDLE, special: true } : IDLE));
  check(words.includes("PSSHH!") && sim.fighters[1].hp === sim.fighters[1].stats.hp, `water wave douses the fireball (${words.join(" ")}); water side unhurt`);
  check(sim.fighters[0].hp < sim.fighters[0].stats.hp, `…and the wave rolls on to hit fire (${(sim.fighters[0].stats.hp - sim.fighters[0].hp).toFixed(1)})`);
  const a = mk("water", "fire"), b = mk("water", null);
  run(a, 80, press("special"));
  run(b, 80, press("special"));
  const da = a.fighters[1].stats.hp - a.fighters[1].hp, db = b.fighters[1].stats.hp - b.fighters[1].hp;
  check(da > db * 1.3, `water vs fire hits harder: ${da.toFixed(1)} vs ${db.toFixed(1)}`);
}
// determinism
{
  const go = () => {
    const sim = new NotebookSim({ player: POWERED.fire.strokes, ai: "on", difficulty: "hard", rivalPower: "auto", countdown: 0 });
    for (let i = 0; i < 1200; i++) sim.step({ ...IDLE, x: i % 90 < 45 ? 1 : 0, special: i % 50 === 0, punch: i % 13 === 0 });
    return JSON.stringify([sim.fighters.map((f) => f.hp.toFixed(4)), sim.fighters[1].special]);
  };
  const a = go(), b = go();
  check(a === b && a.includes("water"), `deterministic; Hard rival counters fire with ${JSON.parse(a)[1]}`);
}
console.log(bad ? `${bad} FAILURES` : "SPECIALS OK");
process.exit(bad ? 1 : 0);
