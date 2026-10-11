// How far does a fighter's body (torso + head ink, incl. a drawn chest) pass into the foe's drawing while it strikes?
// Plays bot rounds vs a rival; at each landed hit measures the attacker's core penetration into the victim's ink
// (and core into core). Usage: tsx test/overlap.ts [rival=bodybuilder] [rounds=10] [level=normal]
import { NotebookSim, skinStrokes, J, type Difficulty } from "../src/index";
import { playRound, bodyStrokes } from "./bot";
const rival = process.argv[2] ?? "bodybuilder";
const N = Number(process.argv[3] ?? 10);
const level = (process.argv[4] ?? "normal") as Difficulty;
type F = NotebookSim["fighters"][number];
function ink(f: F) {
  const solid = new Set(f.rig.solid ?? []);
  const all: { x: number; y: number }[] = [], core: { x: number; y: number }[] = [];
  skinStrokes(f.rig, f.anim.joints, f.anim.deform).forEach((s, i) => {
    if (s.label === "costume" && !solid.has(i)) return;
    s.points.forEach((p, m) => {
      const w = f.world(p);
      all.push(w);
      const b = f.rig.strokes[i]?.points[m]?.b0 ?? -1;
      if (b === 0 || b === 1) core.push(w);
    });
  });
  return { all, core };
}
function pen(att: F, vic: F) {
  const d = Math.sign(vic.x - att.x) || 1;
  const a = ink(att), v = ink(vic);
  const front = Math.max(...a.core.map((p) => p.x * d));
  const near = Math.min(...v.all.map((p) => p.x * d));
  const nearCore = Math.min(...v.core.map((p) => p.x * d));
  const tipStrike = Math.max(...a.all.map((p) => p.x * d));
  return { ink: front - near, core: front - nearCore, reachPast: tipStrike - nearCore };
}
const res: Record<string, { ink: number[]; core: number[]; reach: number[] }> = { rival: { ink: [], core: [], reach: [] }, player: { ink: [], core: [], reach: [] } };
// the attacker's drawing minus the striking limb (its other fist / arm muscles): how far into the victim's body
function guard(att: F, vic: F) {
  const d = Math.sign(vic.x - att.x) || 1;
  const tip = att.rig.strike[att.anim.move === "kick" ? "kick" : "punch"];
  const skip = tip === J.handF ? [4, 5] : tip === J.handB ? [2, 3] : tip === J.footF ? [8, 9] : [6, 7];
  let m = -9;
  skinStrokes(att.rig, att.anim.joints, att.anim.deform).forEach((s, i) => s.points.forEach((p, k) => {
    if (!skip.includes(att.rig.strokes[i]?.points[k]?.b0 ?? -1)) m = Math.max(m, att.world(p).x * d);
  }));
  return m - Math.min(...ink(vic).core.map((p) => p.x * d));
}
const gaps: Record<string, number[]> = { rival: [], player: [] };
for (const who of (process.env.BODIES ?? "clean").split(",")) {
  const sim = new NotebookSim({ player: bodyStrokes(who), difficulty: level, countdown: 3, rivalPower: null, rivalId: rival as never });
  for (let r = 0; r < N; r++) {
    sim.reset(true);
    const drain = NotebookSim.prototype.drainFx.bind(sim);
    sim.drainFx = () => {
      const o = drain();
      for (const e of o.events as { kind: string; who?: number }[]) {
        if (e.kind !== "hit" || e.who === undefined) continue;
        const vic = sim.fighters[e.who], att = sim.fighters[1 - e.who];
        if (vic.ko || att.ko) continue;
        const p = pen(att, vic);
        gaps[e.who === 0 ? "rival" : "player"].push(guard(att, vic));
        const k = e.who === 0 ? "rival" : "player";
        res[k].ink.push(p.ink); res[k].core.push(p.core); res[k].reach.push(p.reachPast);
      }
      return o;
    };
    playRound(sim);
  }
}
const q = (a: number[], f: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? NaN; };
for (const [k, v] of Object.entries(res))
  console.log(`${k} hits ${v.reach.length ? '' : ''} ${v.ink.length} | core into foe ink: median ${q(v.ink, 0.5).toFixed(3)} p90 ${q(v.ink, 0.9).toFixed(3)} max ${q(v.ink, 1).toFixed(3)} | core into foe core: median ${q(v.core, 0.5).toFixed(3)} p90 ${q(v.core, 0.9).toFixed(3)} | attacker's farthest ink past foe body median ${q(v.reach, 0.5).toFixed(3)} p90 ${q(v.reach, 0.9).toFixed(3)} | attacker's other limbs into foe body: median ${q(gaps[k], 0.5).toFixed(3)} p90 ${q(gaps[k], 0.9).toFixed(3)}`);
