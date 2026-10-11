// Draws a stick fighter in the notebook, opens the duel, and captures frame
// sequences of every move into e2e/shots/<iter>/<move>_NN.png
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ITER = process.argv[2] || "it1";
const BASE = process.env.BASE || "http://localhost:3100";
const OUT = path.join(new URL("./shots", import.meta.url).pathname, ITER);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(BASE + "/", { waitUntil: "networkidle" });
const slot = page.getByTestId("slot-0");
await slot.waitFor();
const box = await slot.boundingBox();
const P = (x, y) => [box.x + x * box.width, box.y + y * box.height];
async function stroke(pts) {
  await page.mouse.move(...P(...pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...P(...p), { steps: 3 });
  await page.mouse.up();
}
const circle = (cx, cy, r, n = 24) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * 6.283) * r, cy + Math.sin((i / n) * 6.283) * r * 1.05]);
const spiral = (cx, cy, r, turns = 3, n = 60) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; const a = t * turns * 6.283; const rr = r * (0.35 + 0.65 * t); return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; });
const DRAW = process.env.DRAW || "classic";
const pen = (name) => page.getByRole("button", { name }).click();
if (DRAW === "classic") {
  // a hand-drawn person: head, body, arms (one bent), legs, plus a red hat and a sword as extras
  await stroke(circle(0.5, 0.2, 0.08));
  await stroke([[0.5, 0.29], [0.505, 0.45], [0.5, 0.6]]);
  await stroke([[0.5, 0.36], [0.62, 0.42], [0.72, 0.33]]);
  await stroke([[0.5, 0.36], [0.4, 0.43], [0.3, 0.5]]);
  await stroke([[0.5, 0.6], [0.43, 0.75], [0.4, 0.9]]);
  await stroke([[0.5, 0.6], [0.58, 0.75], [0.62, 0.9]]);
  await pen("Red");
  await stroke([[0.42, 0.13], [0.5, 0.03], [0.58, 0.13], [0.42, 0.13]]);
  await pen("Blue");
  await stroke([[0.72, 0.33], [0.8, 0.18]]);
} else if (DRAW === "messy") {
  // messy: spiral-scribble head, body+back leg in ONE stroke, both arms in ONE stroke, spiky hair, cape
  await pen("Green");
  await stroke(circle(0.46, 0.22, 0.1, 30));
  await stroke(spiral(0.46, 0.22, 0.05, 2));
  await stroke([[0.46, 0.33], [0.47, 0.48], [0.46, 0.6], [0.38, 0.74], [0.33, 0.92]]);
  await stroke([[0.46, 0.6], [0.55, 0.76], [0.62, 0.92]]);
  await stroke([[0.22, 0.48], [0.33, 0.41], [0.46, 0.38], [0.6, 0.41], [0.72, 0.5]]);
  await pen("Purple");
  await stroke([[0.38, 0.14], [0.4, 0.06], [0.44, 0.12], [0.47, 0.04], [0.5, 0.12], [0.54, 0.05], [0.55, 0.15]]);
  await pen("Red");
  await stroke([[0.45, 0.37], [0.36, 0.45], [0.3, 0.58], [0.27, 0.68]]);
}
if (!["classic", "messy"].includes(DRAW)) await stroke([[0.45, 0.5], [0.55, 0.5]]); // any ink so the duel button shows; replaced by the preset
await page.screenshot({ path: path.join(OUT, "00_notebook.png"), clip: { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 } });

await page.getByRole("button", { name: "Duel with fighter 1" }).click();
await page.waitForURL("**/play");
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const preset = SET.find((d) => d.name === DRAW);
if (preset) await page.evaluate((s) => localStorage.setItem("nf:fighter", JSON.stringify(s)), preset.strokes);
await page.goto(BASE + "/play?ai=off" + (process.env.Q ? "&" + process.env.Q : ""));
await page.waitForFunction(() => !!window.__nf);
await page.evaluate(() => (window.__nf.paused = true));
const reading = await page.getByTestId("reading").textContent();

const crop = async () =>
  page.evaluate(() => {
    const { view, sim } = window.__nf;
    const c = view.canvas;
    const r = c.getBoundingClientRect();
    const k = r.width / c.width;
    const f = sim.curr.fighters[0];
    const S = view.cam.scale;
    const sx = (c.width / 2 + (f.x - view.cam.x) * S) * k;
    const gy = c.height * 0.8 * k;
    const e = f.rig.extent;
    const left = sx - S * k * (Math.max(0.35, e.back) + 0.6);
    const width = S * k * (Math.max(0.35, e.back) + Math.max(0.35, e.front) + 1.2);
    return { x: Math.max(0, left), y: Math.max(0, gy - S * k * 1.45), width, height: S * k * 1.6 };
  });
const adv = (n, input = {}) => page.evaluate(([n, input]) => { const s = window.__nf.advance(n, input); return { move: s.fighters[0].move, rival: s.fighters[1].move, hp: [s.playerHp, s.bagHp], x: s.fighters.map((f) => f.x), y: s.fighters[0].y }; }, [n, input]);

const log = [];
async function capture(name, frames, every, input = {}, opts = {}) {
  let first = true;
  const region = opts.region || (await crop());
  for (let i = 0; i < frames; i++) {
    const st = await adv(i === 0 ? 1 : every, first ? input : { ...input, punch: false, kick: false, jump: false });
    first = false;
    await page.screenshot({ path: path.join(OUT, `${name}_${String(i).padStart(2, "0")}.png`), clip: opts.full ? undefined : region });
    log.push(`${name}[${i}] move=${st.move} rival=${st.rival} hp=${st.hp.map(Math.round)} x=${st.x.map((v) => v.toFixed(2))} y=${st.y.toFixed(2)}`);
  }
}
const force = (who, move) => page.evaluate(([w, m]) => window.__nf.sim.force(w, m), [who, move]);

await adv(30);
await capture("idle", 8, 12);
await capture("walk", 10, 4, { x: 1 });
await adv(20);
await capture("walkback", 8, 4, { x: -1 });
await adv(20);
await capture("jump", 12, 5, { jump: true });
await adv(30);
// close the gap to the dummy for contact moves
for (let i = 0; i < 40; i++) {
  const s = await adv(3, { x: 1 });
  if (s.x[1] - s.x[0] < 0.22 + (await page.evaluate(() => window.__nf.sim.fighters.reduce((t, f) => t + f.rig.extent.front, 0)))) break;
}
await adv(25);
await capture("punch", 10, 3, { punch: true });
await adv(30);
await capture("kick", 12, 3, { kick: true });
await adv(40);
// body-specific extras (a beast's pounce and charge): start from a run-up distance
const moves = await page.evaluate(() => window.__nf.sim.fighters[0].anim.moves);
for (const m of [moves.run, moves.air].filter((m, i, all) => m && m !== moves.punch && m !== moves.kick && all.indexOf(m) === i)) {
  await adv(30);
  await page.evaluate((gap) => { const [a, b] = window.__nf.sim.fighters; b.x = a.x + gap + a.rig.extent.front + b.rig.extent.front; }, 0.75);
  await adv(2);
  const r = await crop();
  await force(0, m);
  await capture(`x_${m}`, 12, 3, {}, { region: { ...r, width: r.width * 1.7 } });
  await adv(30);
}
await capture("crouch", 6, 5, { crouch: true });
await adv(20);
// block: hold block while the rival jabs
await adv(10, { block: true });
const closeIn = () => page.evaluate(() => { const [a, b] = window.__nf.sim.fighters; b.x = a.x + 0.2 + a.rig.extent.front + b.rig.extent.front; });
await closeIn();
await page.evaluate(() => window.__nf.sim.forced.push({ who: 1, move: "punch" }));
await capture("block", 8, 4, { block: true });
await adv(30);
await closeIn();
await page.evaluate(() => window.__nf.sim.forced.push({ who: 1, move: "punch" }));
await capture("hit", 10, 3);
await adv(30);
await closeIn();
await page.evaluate(() => window.__nf.sim.forced.push({ who: 1, move: "kick" }));
await capture("hitlow", 10, 3);
await adv(40);
const region = await crop();
await force(0, "ko");
await capture("ko", 14, 5, {}, { region: { ...region, x: Math.max(0, region.x - region.width * 0.6), width: region.width * 1.8 } });
await page.screenshot({ path: path.join(OUT, "ko_full.png") });
// victory: reset, KO the rival, watch the player celebrate
await page.evaluate(() => window.__nf.sim.reset());
await adv(30);
await force(1, "ko");
await adv(70);
await capture("victory", 10, 4);
await page.screenshot({ path: path.join(OUT, "victory_full.png") });

fs.writeFileSync(path.join(OUT, "log.txt"), [`reading: ${reading}`, `moves: ${JSON.stringify(moves)}`, ...errors.filter((e) => !/Failed to load resource/.test(e)).map((e) => "ERROR " + e), ...log].join("\n"));
console.log("reading:", reading);
console.log("errors:", errors.length, errors.slice(0, 5));
console.log(log.filter((_, i) => i % 3 === 0).join("\n"));
await browser.close();
