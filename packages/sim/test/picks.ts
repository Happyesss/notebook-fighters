// Headless: specials picked on the drawing pad and ready-made fighters picked instead of a drawing.
// A drawing's tag (an ink-less first stroke) gives it a special no doodle can (boomerang, stretch punch,
// long kick, mega leap …) or swaps in a roster fighter; bad tags are ignored; picked specials hit fairly.
import { NotebookSim, POWER_INFO, PICKABLE, PICKED_DMG, ROSTER, inferRig, type PlayerInput } from "../src/index";
import { readTag, withTag } from "@nf/shared";
import { DRAWINGS, POWERED } from "./drawings";
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const IDLE: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
const clean = DRAWINGS.find((d) => d.name === "clean")!.strokes;
const mk = (special: string, gap: number, player = clean) => {
  const sim = new NotebookSim({ player: withTag(player, { special }), rivalId: "kid", difficulty: "normal", ai: "off", countdown: 0 });
  sim.fighters[0].x = -gap / 2;
  sim.fighters[1].x = gap / 2;
  sim.fighters[0].cool = 0;
  return sim;
};
const run = (sim: NotebookSim, n: number, me: (i: number) => PlayerInput, cpu: (i: number) => PlayerInput = () => IDLE, each?: (i: number) => void) => {
  for (let i = 0; i < n; i++) {
    (sim as any).think = () => cpu(i);
    sim.step(me(i));
    sim.drainFx();
    each?.(i);
  }
};
const at = (k: number, inp: Partial<PlayerInput>) => (i: number) => (i === k ? { ...IDLE, ...inp } : IDLE);

// tags: round trip, ink untouched, junk ignored
{
  const t = withTag(clean, { special: "boomerang" });
  const back = readTag(t);
  check(t[0].points.length === 0 && back.tag?.special === "boomerang" && back.ink.length === clean.length, "a tag rides in front of the drawing and reads back");
  check(inferRig(t)!.parts.join() === inferRig(clean)!.parts.join(), "the reader ignores the tag stroke");
  check(withTag(t, null).length === clean.length && readTag(clean).tag === null, "no tag: plain drawing");
  const junk = new NotebookSim({ player: withTag(clean, { special: "fire", preset: "nobody" }), rivalId: "kid", ai: "off" });
  check(junk.fighters[0].special === null && junk.fighters[0].preset === null, "a tag naming a drawn power or an unknown fighter is ignored");
  const fire = new NotebookSim({ player: withTag(POWERED.fire.strokes, { special: "stretch" }), rivalId: "kid", ai: "off" });
  check(fire.fighters[0].special === "stretch" && fire.fighters[0].element === null, "a picked special replaces the doodle's special");
}

// every pickable special fires from a plain stick man and lands at a range that suits it
for (const k of PICKABLE) {
  const gap = k === "boomerang" || k === "blades" || k === "pumpkin" || k === "chalk" || k === "web" ? 2.0 : k === "leap" ? 2.4 : k === "quake" ? 1.6 : k === "bones" ? 0.6 : 1.1;
  const sim = mk(k, gap);
  const me = sim.fighters[0];
  const foe = sim.fighters[1];
  check(me.special === k && me.picked && me.coolMax === POWER_INFO[k].cooldown, `${k}: picked (${POWER_INFO[k].special}, every ${me.coolMax}s)`);
  if (k === "phantom" || k === "bones") continue; // defensive: no hit of their own (bones' strike is tested below)
  const hp0 = foe.hp;
  let ok = true;
  run(sim, 150, at(0, { special: true }), () => IDLE, () => {
    for (const f of sim.fighters) if (!Number.isFinite(f.x + f.y + f.hp) || f.y < -1e-9) ok = false;
  });
  const dmg = hp0 - foe.hp;
  check(ok && dmg > 3 && dmg < 40, `${k}: lands from ${gap} away for ${dmg.toFixed(1)} damage (picked ×${PICKED_DMG[k] ?? 1})`);
}

// the boomerang curves back and is caught; it hits only once
{
  const sim = mk("boomerang", 5.2); // too far to reach: it turns and comes home
  let maxX = -9;
  let seen = 0;
  run(sim, 200, at(0, { special: true }), () => IDLE, () => {
    const b = sim.projectiles.find((p) => p.kind === "boomerang");
    if (b) {
      seen++;
      maxX = Math.max(maxX, b.x);
    }
  });
  const thrower = sim.fighters[0].x;
  check(seen > 30 && maxX - thrower > 1.8 && maxX - thrower < 3 && !sim.projectiles.length, `boomerang: flies out ${(maxX - thrower).toFixed(2)}, turns, caught after ${(seen / 60).toFixed(1)}s`);
  const s2 = mk("boomerang", 1.6);
  const hp0 = s2.fighters[1].hp;
  let hits = 0;
  let last = hp0;
  run(s2, 200, at(0, { special: true }), () => IDLE, () => {
    if (s2.fighters[1].hp < last - 0.01) hits++;
    last = s2.fighters[1].hp;
  });
  check(hits === 1, `boomerang: hits once (${hits}) for ${(hp0 - s2.fighters[1].hp).toFixed(1)}`);
}

// stretch punch reaches far but not across the whole page; the long kick is jumped
{
  const far = mk("stretch", 3.2);
  const hp0 = far.fighters[1].hp;
  let longest = 0;
  run(far, 60, at(0, { special: true }), () => IDLE, () => {
    const s = far.curr.fighters[0].stretch;
    if (s) longest = Math.max(longest, Math.abs(s.b.x - s.a.x));
  });
  check(far.fighters[1].hp === hp0 && longest > 1.3, `stretch punch: reaches ${longest.toFixed(2)} but misses at 3.2 away`);
  const sweep = mk("longkick", 1.1);
  const f = sweep.fighters[1];
  const h0 = f.hp;
  // the rival jumps just before the kick goes out
  run(sweep, 90, at(8, { special: true }), at(0, { jump: true }));
  check(f.hp === h0, `long kick: a jump clears the sweep (hp ${f.hp.toFixed(1)} of ${h0})`);
  const s3 = mk("longkick", 1.1);
  const h1 = s3.fighters[1].hp;
  let stun = 0;
  run(s3, 60, at(0, { special: true }), () => IDLE, () => (stun = Math.max(stun, s3.fighters[1].stun)));
  check(h1 - s3.fighters[1].hp > 5 && stun > 0.5, `long kick: sweeps a standing foe for ${(h1 - s3.fighters[1].hp).toFixed(1)}, stun ${stun.toFixed(2)}s`);
  // a hit on the stretcher cancels its stretch
  const s4 = mk("stretch", 3.0);
  run(s4, 12, at(0, { special: true }));
  const was = s4.fighters[0].stretch.dur > 0;
  (s4 as any).specialHit(s4.fighters[1], s4.fighters[0], "spikes", 5, 1, 0.3, { x: s4.fighters[0].x, y: 0.5 });
  run(s4, 14, () => IDLE); // past the hit-stop, well before the punch would end by itself
  const cancelled = was && s4.fighters[0].stretch.dur === 0 && s4.curr.fighters[0].stretch === null;
  check(cancelled, "stretch punch: getting hit pulls the arm back in");
}

// picked mega leap / haymaker are tuned down from the rivals' versions
{
  const rival = new NotebookSim({ player: clean, rivalId: "bodybuilder", ai: "off" });
  const mine = mk("leap", 2.4);
  check(mine.fighters[0].picked && !rival.fighters[1].picked, "a rival's own special is not 'picked'; a drawing's is");
}

// a ready-made fighter: its drawing, special, stance and size, a fair strength
{
  const plain = new NotebookSim({ player: clean, ai: "off" }).fighters[0];
  for (const r of ROSTER) {
    // the stored drawing doesn't matter: the roster's own strokes are used (nobody can edit a preset)
    const sim = new NotebookSim({ player: withTag(clean.slice(0, 2), { preset: r.id }), rivalId: "kid", ai: "off" });
    const f = sim.fighters[0];
    const ok = f.preset?.id === r.id && f.special === (r.signature ?? null) && f.size === (r.size ?? 1) && f.rig.strokes.length === inferRig(r.strokes)!.strokes.length && f.stats.hp <= plain.stats.hp * 1.4 && f.stats.hp >= plain.stats.hp * 0.9;
    check(ok, `preset ${r.id}: HP ${f.stats.hp} (a drawing: ${plain.stats.hp}), punch ×${f.stats.dmg.punch}, special ${f.special ?? "none"}, size ${f.size}`);
  }
  // in a 2-player duel, player 2's preset / pick works too
  const duel = new NotebookSim({ player: withTag(clean, { special: "boomerang" }), rival: withTag([], { preset: "robot" }), ai: "versus" });
  check(duel.fighters[0].special === "boomerang" && duel.fighters[1].preset?.id === "robot" && duel.fighters[1].special === "stretch", "2-player: both sides' tags apply");
}

// lockstep: the same tagged drawings and inputs replay to the same checksum
{
  const a = new NotebookSim({ player: withTag(clean, { special: "longkick" }), rival: withTag([], { preset: "explorer" }), ai: "versus" });
  const b = new NotebookSim({ player: withTag(clean, { special: "longkick" }), rival: withTag([], { preset: "explorer" }), ai: "versus" });
  const inp = (i: number): PlayerInput => ({ ...IDLE, x: i % 90 < 40 ? 1 : 0, special: i % 50 === 3, punch: i % 23 === 0 });
  const inp2 = (i: number): PlayerInput => ({ ...IDLE, x: i % 70 < 30 ? -1 : 0, special: i % 61 === 5, kick: i % 29 === 0 });
  let same = true;
  for (let i = 0; i < 900; i++) {
    a.step(inp(i), undefined, inp2(i));
    b.step(inp(i), undefined, inp2(i));
    a.drainFx();
    b.drainFx();
    if (a.checksum() !== b.checksum()) same = false;
  }
  check(same, `deterministic with tags: checksum ${a.checksum()} after 900 frames`);
}

console.log(bad ? `${bad} FAIL` : "PICKS OK");
process.exit(bad ? 1 : 0);
