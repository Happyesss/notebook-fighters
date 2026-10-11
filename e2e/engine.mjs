// Phase 5 (engine): the PixiJS renderer and the Canvas2D fallback draw the same scene; the toggles
// are saved; the K.O. ragdoll runs on Rapier2D (and the classic one on ?physics=classic); and an fps
// benchmark of both renderers on the same busy fight.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
const OUT = process.env.OUT || new URL("./shots/p5", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT/.test(m.text()) && errs.push(m.text()));
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const B = "http://localhost:3100";
await p.goto(B + "/", { waitUntil: "load", timeout: 90000 });
await p.evaluate((s) => {
  localStorage.setItem("nf:fighter", JSON.stringify(s));
  localStorage.removeItem("nf:renderer");
  localStorage.removeItem("nf:physics");
  localStorage.setItem("nf:mute", "1");
}, SET.find((d) => d.name === "swordsman").strokes);
const boot = async (q) => {
  await p.goto(`${B}/play?${q}`, { waitUntil: "load", timeout: 90000 });
  await p.waitForFunction(() => window.__nf?.sim && window.__nf?.view, null, { timeout: 60000 });
  await p.evaluate(() => (window.__nf.paused = true));
};

// ---- defaults and toggles
await boot("ai=off");
let info = await p.evaluate(() => ({ r: window.__nf.view.backend, f: window.__nf.view.fallback, k: window.__nf.sim.koPhysics }));
// phase 5B decision: Rapier KO by default; Canvas2D stays the default renderer (Pixi is opt-in)
check(info.k === "rapier" && info.r === "canvas" && !info.f, `defaults: renderer ${info.r}${info.f ? ` (fallback: ${info.f})` : ""}, KO physics ${info.k}`);
const firstR = info.r;
const flip = firstR === "pixi" ? "canvas" : "pixi";
await p.getByTestId("renderer-toggle").click();
await p.waitForFunction((want) => window.__nf?.view?.backend === want, flip, { timeout: 60000 });
const savedR = await p.evaluate(() => localStorage.getItem("nf:renderer"));
await p.getByTestId("physics-toggle").click();
await p.waitForFunction(() => window.__nf?.sim?.koPhysics === "classic", null, { timeout: 60000 });
const savedP = await p.evaluate(() => localStorage.getItem("nf:physics"));
await p.reload({ waitUntil: "load", timeout: 90000 });
await p.waitForFunction(() => window.__nf?.view, null, { timeout: 60000 });
info = await p.evaluate(() => ({ r: window.__nf.view.backend, k: window.__nf.sim.koPhysics, lr: document.querySelector('[data-testid="renderer-toggle"]').textContent, lp: document.querySelector('[data-testid="physics-toggle"]').textContent }));
check(savedR === flip && savedP === "classic" && info.r === flip && info.k === "classic", `toggles saved and survive a reload: "${info.lr}" / "${info.lp}"`);
await p.evaluate(() => {
  localStorage.removeItem("nf:renderer");
  localStorage.removeItem("nf:physics");
});

// ---- same frame, both renderers (visual parity)
const scene = async () => {
  await p.evaluate(() => {
    const nf = window.__nf;
    nf.advance(40, { x: 1 });
    nf.advance(1, { kick: true });
    nf.advance(9);
  });
};
for (const r of ["canvas", "pixi"]) {
  await boot(`ai=off&countdown=0&renderer=${r}`);
  await scene();
  await p.waitForTimeout(150);
  await p.locator("canvas").screenshot({ path: `${OUT}/parity_${r}.png` });
}
check(fs.statSync(`${OUT}/parity_pixi.png`).size > 20000, `parity shots: ${OUT}/parity_canvas.png vs parity_pixi.png`);

// ---- Rapier ragdoll KO (all drawings get this in moves.mjs; here: a close look + the classic one)
const ko = async (phys, name) => {
  await p.evaluate((s) => localStorage.setItem("nf:fighter", JSON.stringify(s)), SET.find((d) => d.name === name).strokes);
  await boot(`ai=off&countdown=0&physics=${phys}&renderer=pixi`);
  const r = await p.evaluate(() => {
    const nf = window.__nf;
    const sim = nf.sim;
    sim.fighters[1].hp = 6;
    for (let i = 0; i < 400 && !sim.curr.over; i++) {
      const [a, b] = sim.fighters;
      const gap = b.x - a.x - a.rig.extent.front - b.rig.extent.front;
      nf.advance(1, gap > 0.32 ? { x: 1 } : i % 12 === 0 ? { kick: true } : {});
    }
    const over = sim.curr.over;
    const rd = sim.fighters[1].anim.ragdoll;
    const kind = !rd ? null : "freed" in rd ? "RapierRagdoll" : "q" in rd ? "Ragdoll" : "Tumble";
    nf.advance(26);
    return { over, kind, chest: sim.fighters[1].anim.joints[1].y };
  });
  await p.waitForTimeout(100);
  await p.locator("canvas").screenshot({ path: `${OUT}/ko_${phys}_${name}.png` });
  const later = await p.evaluate(() => {
    window.__nf.advance(150);
    const j = window.__nf.sim.fighters[1].anim.joints;
    return { chest: j[1].y, low: Math.min(...j.map((q) => q.y)), settled: window.__nf.sim.fighters[1].anim.ragdoll?.settled ?? 0 };
  });
  await p.locator("canvas").screenshot({ path: `${OUT}/ko_${phys}_${name}_rest.png` });
  return { ...r, later };
};
const rk = await ko("rapier", "clean");
check(rk.over && /Rapier/.test(rk.kind ?? "") && rk.later.chest < 0.5 && rk.later.low > -0.05, `Rapier KO: ${rk.kind}, mid-fall chest ${rk.chest.toFixed(2)}, at rest chest ${rk.later.chest.toFixed(2)} lowest joint ${rk.later.low.toFixed(3)}, settled ${rk.later.settled.toFixed(2)} s`);
const ck = await ko("classic", "clean");
check(ck.over && ck.kind === "Ragdoll", `classic KO still available: ${ck.kind}`);

// ---- fps benchmark: same busy fight (CPU vs CPU on Hard) drawn by each renderer
const bench = {};
for (const [r, q] of [["canvas", "renderer=canvas"], ["pixi", "renderer=pixi"], ["pixi_noMSAA", "renderer=pixi&aa=0"]]) {
  await p.evaluate((s) => localStorage.setItem("nf:fighter", JSON.stringify(s)), SET.find((d) => d.name === "clean").strokes);
  await boot(`countdown=0&${q}&level=hard&rivalPower=fire`);
  // (1) throughput: step + draw 600 frames back-to-back, GPU flushed at the end
  const t = await p.evaluate(async () => {
    const nf = window.__nf;
    const sim = nf.sim;
    const view = nf.view;
    const ms = [];
    const t0 = performance.now();
    for (let i = 0; i < 600; i++) {
      if (sim.curr.over) sim.rematch();
      const a = performance.now();
      nf.advance(1, { punch: i % 9 === 0, x: i % 50 < 25 ? 1 : -1, special: i % 120 === 0 });
      ms.push(performance.now() - a);
    }
    const gl = view.canvas.getContext("webgl2") || view.canvas.getContext("webgl");
    gl?.finish?.();
    const wall = performance.now() - t0;
    ms.sort((x, y) => x - y);
    return { wall, avg: ms.reduce((s, x) => s + x, 0) / ms.length, p95: ms[Math.floor(ms.length * 0.95)], ops: view.perf.ops };
  });
  // (2) live: the real rAF loop for 4 s
  const live = await p.evaluate(async () => {
    window.__nf.paused = false;
    const d0 = window.__nf.view.perf.draws;
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 4000));
    const n = window.__nf.view.perf.draws - d0;
    return (n * 1000) / (performance.now() - t0);
  });
  bench[r] = { throughputFps: Math.round(600 / (t.wall / 1000)), frameMsAvg: +t.avg.toFixed(2), frameMsP95: +t.p95.toFixed(2), liveFps: +live.toFixed(1), drawOps: t.ops };
}
console.log("BENCH " + JSON.stringify(bench));
fs.writeFileSync(`${OUT}/bench.json`, JSON.stringify({ when: new Date().toISOString(), note: "headless Chromium, SwiftShader (software) WebGL, 1280x720, step+draw per frame", ...bench }, null, 2));
check(bench.pixi.liveFps > 20 && bench.canvas.liveFps > 20, `benchmark: Canvas2D ${bench.canvas.throughputFps} fps max (${bench.canvas.frameMsAvg} ms/frame, live ${bench.canvas.liveFps}) · Pixi ${bench.pixi.throughputFps} fps max (${bench.pixi.frameMsAvg} ms/frame, live ${bench.pixi.liveFps}) · Pixi no-MSAA live ${bench.pixi_noMSAA.liveFps}`);
check(errs.length === 0, `page errors: ${errs.length ? errs.slice(0, 5).join(" | ") : 0}`);
await b.close();
console.log(bad ? `${bad} FAIL` : "ENGINE OK");
process.exit(bad);
