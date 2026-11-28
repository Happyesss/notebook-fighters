// Headless: every fighter fights. Each roster character as the computer's rival (on every level), as a
// player's ready-made pick, in 2-player duels against every other character, and every pickable special
// on a plain drawing. Two scripted "casual humans" play; every frame is audited:
//   numbers finite · nobody below the floor, flying off, or past a wall · HP within [0, max] and never
//   healing mid-round · projectiles sane · a stretched limb stays on the page · bodies don't sit inside
//   each other · nobody hangs in the air · every round ends with a K.O.
// Usage: tsx test/allfights.ts [rounds=2]  (FIGHTS=rivals,presets,duels,picks picks the parts)
import { loadPhysics, wallBounds, NotebookSim, ROSTER, PICKABLE, WALL_X, J, type Difficulty, type PlayerInput } from "../src/index";
import { withTag } from "@nf/shared";
import { DRAWINGS } from "./drawings";

const N = Number(process.argv[2] ?? 2);
const DUEL_N = Number(process.env.DUEL_N ?? 1);
const PARTS = new Set((process.env.FIGHTS ?? "rivals,presets,duels,picks").split(","));
const PHYS = (process.env.PHYS ?? "classic") as "classic" | "rapier";
const clean = DRAWINGS.find((d) => d.name === "clean")!.strokes;
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
let rs = 777;
const rand = () => ((rs = (rs * 48271) % 2147483647) - 1) / 2147483646;
const IDLE: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
type F = NotebookSim["fighters"][number];

/** a casual human: reacts late, walks in, punches and kicks, blocks sometimes, uses its special when the range suits */
function makeBot() {
  const hist: { gap: number; attacking: boolean }[] = [];
  let hold: PlayerInput = { ...IDLE };
  let holdFor = 0;
  let next = 0;
  const lag = 13 + Math.floor(rand() * 8);
  return (sim: NotebookSim, me: F, foe: F): PlayerInput => {
    hist.push({ gap: Math.abs(foe.x - me.x) - me.rig.extent.front - foe.rig.extent.front, attacking: foe.anim.busy && !["hit", "hitLow", "idle", "walk"].includes(foe.anim.move) });
    const seen = hist[Math.max(0, hist.length - 1 - lag)];
    let input: PlayerInput = { ...hold, punch: false, kick: false, jump: false, special: false };
    next -= 1 / 60;
    holdFor -= 1 / 60;
    if (holdFor <= 0) hold = { ...IDLE };
    if (next <= 0 && sim.curr.countdown <= 0) {
      next = 0.22 + rand() * 0.35;
      const toward = Math.sign(foe.x - me.x);
      const r = rand();
      const sp = me.special;
      const far = sp === "boomerang" || sp === "blades" || sp === "pumpkin" || sp === "chalk" || sp === "web" || sp === "fire" || sp === "water" || sp === "ice" || sp === "leap";
      const mid = sp === "stretch" || sp === "longkick" || sp === "quake" || sp === "flykick" || sp === "slash" || sp === "bite" || sp === "haymaker" || sp === "lightning" || sp === "wings";
      if (sp && me.cool <= 0 && rand() < 0.35 && (far ? seen.gap > 0.4 : mid ? seen.gap > 0.1 && seen.gap < 1.2 : seen.gap < 0.5)) input = { ...input, special: true };
      else if (seen.attacking && seen.gap < 0.5 && r < 0.3) {
        hold = { ...IDLE, block: true };
        holdFor = 0.35;
      } else if (seen.gap > 0.3) {
        hold = { ...IDLE, x: toward };
        holdFor = 0.25 + rand() * 0.3;
      } else if (r < 0.5) input = { ...input, punch: true };
      else if (r < 0.75) input = { ...input, kick: true };
      else if (r < 0.82) input = { ...input, jump: true };
      else if (r < 0.9) {
        hold = { ...IDLE, x: -toward };
        holdFor = 0.2;
      }
    }
    return input;
  };
}

/** what went wrong in a fight (first time each), and how it went */
type Report = { issues: Map<string, string>; winner: number | null; secs: number; specials: [number, number]; landed: [number, number] };

function audit(sim: NotebookSim, st: { inside: number; air: [number, number]; hp: [number, number] }, issues: Map<string, string>, frame: number) {
  const note = (k: string, v: string) => issues.has(k) || issues.set(k, `${v} (frame ${frame})`);
  sim.fighters.forEach((f, i) => {
    const nums = [f.x, f.y, f.vx, f.vy, f.hp, ...f.anim.joints.flatMap((j) => [j.x, j.y])];
    if (!nums.every(Number.isFinite)) note("nan", `fighter ${i} has a non-finite number`);
    if (f.y < -1e-6) note("floor", `fighter ${i} below the floor (y ${f.y.toFixed(3)})`);
    if (f.y > 2.6) note("sky", `fighter ${i} flew off the page (y ${f.y.toFixed(2)})`);
    const [lo, hi] = wallBounds(f);
    if (!f.ko && (f.x < lo - 0.02 || f.x > hi + 0.02)) note("wall", `fighter ${i}'s body past a wall (x ${f.x.toFixed(2)}, allowed ${lo.toFixed(2)}..${hi.toFixed(2)})`);
    if (f.hp < -1e-9 || f.hp > f.stats.hp + 1e-6) note("hp", `fighter ${i} HP ${f.hp} out of [0, ${f.stats.hp}]`);
    if (f.hp > st.hp[i] + 1e-6 && !sim.curr.over) note("heal", `fighter ${i} healed mid-round ${st.hp[i].toFixed(1)} → ${f.hp.toFixed(1)}`);
    st.hp[i] = f.hp;
    st.air[i] = f.airborne && !f.ko ? st.air[i] + 1 : 0;
    if (st.air[i] > 60 * 6) note("hang", `fighter ${i} in the air for 6 s`);
    const s = sim.curr.fighters[i].stretch;
    if (s && (Math.abs(s.b.x) > WALL_X + 0.05 || !Number.isFinite(s.b.x + s.b.y))) note("stretch", `fighter ${i}'s stretched limb off the page (${s.b.x.toFixed(2)})`);
    // a KO'd ragdoll's bones stay on the page too
    if (f.ko)
      for (const [k, j] of f.anim.joints.entries()) {
        const w = f.world(j);
        if (Math.abs(w.x) > WALL_X + 0.6 || w.y < -0.3) note("ragdoll", `fighter ${i}'s K.O. ragdoll left the page (joint ${k} at ${w.x.toFixed(2)}, ${w.y.toFixed(2)}; body x ${f.x.toFixed(2)} y ${f.y.toFixed(2)}, ${sim.koPhysics})`);
      }
  });
  if (sim.projectiles.length > 40 || !sim.projectiles.every((p) => Number.isFinite(p.x + p.y + p.vx + p.vy))) note("shots", `${sim.projectiles.length} projectiles / non-finite`);
  const [a, b] = sim.fighters;
  const grounded = !a.airborne && !b.airborne && !a.ko && !b.ko && a.dash.t <= 0 && b.dash.t <= 0 && a.scatter <= 0 && b.scatter <= 0;
  const tight = Math.abs(a.x - b.x) < (a.rig.extent.front + b.rig.extent.front) * 0.45;
  st.inside = grounded && tight ? st.inside + 1 : 0;
  if (st.inside > 45) note("inside", `bodies stuck inside each other (dx ${Math.abs(a.x - b.x).toFixed(2)}, fronts ${a.rig.extent.front.toFixed(2)}+${b.rig.extent.front.toFixed(2)})`);
}

function fight(sim: NotebookSim, rounds: number, versus: boolean): Report[] {
  const out: Report[] = [];
  for (let r = 0; r < rounds; r++) {
    const bots = [makeBot(), makeBot()];
    const issues = new Map<string, string>();
    const st = { inside: 0, air: [0, 0] as [number, number], hp: [sim.fighters[0].hp, sim.fighters[1].hp] as [number, number] };
    const specials: [number, number] = [0, 0];
    const landed: [number, number] = [0, 0];
    let frame = 0;
    const hp0 = [sim.fighters[0].hp, sim.fighters[1].hp];
    while (!sim.curr.over && frame < 60 * 150) {
      const [me, foe] = sim.fighters;
      const cool = [me.cool, foe.cool];
      sim.step(bots[0](sim, me, foe), undefined, versus ? bots[1](sim, foe, me) : undefined);
      const fx = sim.drainFx().events;
      for (const e of fx) {
        if (e.kind === "special") specials[me.cool > cool[0] ? 0 : foe.cool > cool[1] ? 1 : 0] += 0;
        if (e.kind === "hit" && e.color && e.who !== undefined) landed[1 - e.who]++;
      }
      if (me.cool > cool[0] + 0.5) specials[0]++;
      if (foe.cool > cool[1] + 0.5) specials[1]++;
      frame++;
      audit(sim, st, issues, frame);
    }
    if (!sim.curr.over) issues.set("stall", `no K.O. after 150 s (HP ${sim.fighters[0].hp.toFixed(0)}/${hp0[0]} vs ${sim.fighters[1].hp.toFixed(0)}/${hp0[1]})`);
    // let the K.O. ragdoll fall and settle, auditing it too
    for (let k = 0; k < 150 && sim.curr.over; k++) {
      sim.step(IDLE, undefined, versus ? IDLE : undefined);
      sim.drainFx();
      audit(sim, st, issues, ++frame);
    }
    out.push({ issues, winner: sim.curr.winner, secs: frame / 60, specials, landed });
    sim.rematch();
  }
  return out;
}

const summary = (label: string, reps: Report[], side: 0 | 1 = 0) => {
  const issues = reps.flatMap((r) => [...r.issues.values()]);
  const wins = reps.filter((r) => r.winner === side).length;
  const sp = reps.reduce((a, r) => a + r.specials[1 - side], 0);
  const ld = reps.reduce((a, r) => a + r.landed[1 - side], 0);
  return { ok: issues.length === 0, line: `${label.padEnd(34)} won ${wins}/${reps.length} · ${(reps.reduce((a, r) => a + r.secs, 0) / reps.length).toFixed(0)}s/round · foe specials ${sp} (${ld} landed)${issues.length ? " · " + [...new Set(issues)].slice(0, 3).join(" | ") : ""}`, wins, sp, ld };
};

if (PHYS === "rapier") await loadPhysics();
const t0 = Date.now();
// 1. every character as the computer's rival, every level (the bot plays a plain drawing)
if (PARTS.has("rivals")) {
  // (whether it uses its special is counted over all three levels: on Easy it rarely reaches for it)
  const silent: string[] = [];
  for (const r of ROSTER) {
    let used = 0;
    for (const level of ["easy", "normal", "hard"] as Difficulty[]) {
      const sim = new NotebookSim({ player: clean, rivalId: r.id, rivalPower: "auto", difficulty: level, ai: "on", countdown: 0, physics: PHYS });
      const s = summary(`rival ${r.id} (${level})`, fight(sim, N, false), 0);
      used += s.sp;
      check(s.ok, s.line);
      sim.destroy();
    }
    if (r.signature && !used) silent.push(r.id);
  }
  check(silent.length === 0, `every rival with a special uses it${silent.length ? ": never used by " + silent.join(", ") : ""}`);
}
// 2. every character picked by the player (bot) against the computer on Normal
if (PARTS.has("presets")) {
  let wins = 0;
  let n = 0;
  for (const r of ROSTER) {
    const sim = new NotebookSim({ player: withTag([], { preset: r.id }), rivalId: "auto", rivalPower: "auto", difficulty: "normal", ai: "on", countdown: 0, physics: PHYS });
    const reps = fight(sim, N, false);
    const s = summary(`you as ${r.id} vs ${sim.rivalEntry?.id}`, reps, 0);
    wins += s.wins;
    n += reps.length;
    check(s.ok, s.line);
    sim.destroy();
  }
  check(wins / n > 0.2 && wins / n < 0.85, `ready-made fighters vs the computer on Normal: the bot wins ${wins}/${n} (fair, not a win button)`);
}
// 3. 2-player duels: every ready-made fighter against every other (both sides a bot)
if (PARTS.has("duels")) {
  const issues: string[] = [];
  const winsBy = new Map<string, number>();
  let n = 0;
  for (const a of ROSTER)
    for (const b of ROSTER) {
      const sim = new NotebookSim({ player: withTag([], { preset: a.id }), rival: withTag([], { preset: b.id }), ai: "versus", countdown: 0, physics: PHYS });
      for (const rep of fight(sim, DUEL_N, true)) {
        n++;
        for (const v of rep.issues.values()) issues.push(`${a.id} vs ${b.id}: ${v}`);
        if (rep.winner !== null) winsBy.set([a.id, b.id][rep.winner], (winsBy.get([a.id, b.id][rep.winner]) ?? 0) + 1);
      }
      sim.destroy();
    }
  check(issues.length === 0, `${n} duels, every character vs every character${issues.length ? ": " + issues.slice(0, 8).join(" · ") + (issues.length > 8 ? ` … (+${issues.length - 8})` : "") : ": clean"}`);
  const table = ROSTER.map((r) => `${r.id} ${winsBy.get(r.id) ?? 0}`).join(", ");
  const most = Math.max(...ROSTER.map((r) => winsBy.get(r.id) ?? 0));
  check(most <= ROSTER.length * 2 * DUEL_N * 0.85, `duel wins out of ${ROSTER.length * 2 * DUEL_N} each: ${table}`);
}
// 4. every pickable special on a plain drawing, against the computer on Normal
if (PARTS.has("picks")) {
  // (the bot reaches for it only now and then, so usage is counted over all the specials together)
  let usedKinds = 0;
  for (const k of PICKABLE) {
    const sim = new NotebookSim({ player: withTag(clean, { special: k }), rivalId: "auto", rivalPower: "auto", difficulty: "normal", ai: "on", countdown: 0, physics: PHYS });
    const reps = fight(sim, N, false);
    const s = summary(`your ${k} vs ${sim.rivalEntry?.id}`, reps, 0);
    const mine = reps.reduce((a, r) => a + r.specials[0], 0);
    if (mine > 0) usedKinds++;
    check(s.ok, `${s.line} · you used it ${mine}×`);
    sim.destroy();
  }
  check(usedKinds >= PICKABLE.length * 0.7, `picked specials fire in real fights: ${usedKinds}/${PICKABLE.length} used by the bot`);
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
console.log(bad ? `${bad} FAIL` : "ALL FIGHTS OK");
process.exit(bad ? 1 : 0);
