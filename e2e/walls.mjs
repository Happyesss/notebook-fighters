// The stage walls are where the notebook says they are: holding A (walk back) takes the fighter's drawn body
// right up to the red margin line, and walking forward takes the rival to the matching line on the right.
// On desktop (Canvas2D and PixiJS), phone landscape and portrait, and a tablet. The sim walls are the same
// on every screen (online and nearby clients must agree): only the camera changes.
import { chromium, devices } from "playwright";
import fs from "node:fs";
const BASE = (process.env.BASE || "http://localhost:8787").replace(/\/$/, "");
const OUT = process.env.OUT || new URL("./shots/walls", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const DESKTOP = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
const CASES = [
  ["Desktop 1280x720", DESKTOP, "", "keys"],
  ["Desktop 1280x720 PixiJS", DESKTOP, "&renderer=pixi", "keys"],
  ["Desktop 1920x600 (wide)", { viewport: { width: 1920, height: 600 }, deviceScaleFactor: 1 }, "", "keys"],
  ["iPhone 13 landscape", devices["iPhone 13 landscape"], "", "steps"],
  ["iPhone 13", devices["iPhone 13"], "", "steps"],
  ["iPad Pro 11", devices["iPad Pro 11"], "", "steps"],
];
const TOL = 4; // css px
let simWalls = null;
for (const [name, opts, extra, how] of CASES) {
  const ctx = await b.newContext({ ...opts });
  await ctx.addInitScript(() => localStorage.setItem("nf:mute", "1"));
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
  await p.evaluate((s) => localStorage.setItem("nf:fighter", JSON.stringify(s)), SET.find((d) => d.name === "clean").strokes);
  await p.goto(BASE + `/play?rival=kid&ai=off&countdown=0${extra}`, { waitUntil: "load", timeout: 90000 });
  await p.waitForFunction(() => window.__nf?.sim && window.__nf?.view?.stage?.width > 0, null, { timeout: 30000 });
  await p.waitForTimeout(400);
  if (how === "keys") {
    await p.locator("canvas").first().click({ position: { x: 20, y: 20 } }).catch(() => {});
    await p.keyboard.down("a");
    await p.waitForTimeout(4500);
    await p.keyboard.up("a");
    await p.waitForTimeout(1200); // the camera settles
  } else {
    await p.evaluate(() => window.__nf.advance(300, { x: -1 }));
    for (let i = 0; i < 20; i++) await p.evaluate(() => window.__nf.advance(4));
  }
  const m = await p.evaluate(() => {
    const { sim, view } = window.__nf;
    const r = view.canvas.getBoundingClientRect();
    const k = r.width / view.stage.width; // canvas px → css px
    const f = sim.fighters[0];
    const ext = f.facing > 0 ? f.rig.extent.back : f.rig.extent.front;
    const bodyLeft = f.x - Math.min(0.5, ext);
    const toCss = (x) => (view.stage.width / 2 + (x - view.stage.cx) * view.stage.scale) * k;
    return { line: view.stage.left * k, body: toCss(bodyLeft), x: f.x, cssW: r.width, right: view.stage.right * k, renderer: view.backend };
  });
  await p.screenshot({ path: `${OUT}/left_wall_${name.replace(/[^a-z0-9]+/gi, "_")}.png` });
  check(Math.abs(m.body - m.line) <= TOL && m.line >= -1 && m.line < m.cssW * 0.2,
    `${name}: holding A → body edge at ${m.body.toFixed(1)} px, red margin line at ${m.line.toFixed(1)} px (gap ${(m.body - m.line).toFixed(1)} px, renderer ${m.renderer}, x ${m.x.toFixed(2)})`);
  // the right wall, in a 2-player duel: both walk right, so P2's back ends up against it
  await p.goto(BASE + `/play?mode=2p&countdown=0${extra}`, { waitUntil: "load", timeout: 90000 });
  await p.waitForFunction(() => window.__nf?.sim && window.__nf?.view?.stage?.width > 0, null, { timeout: 30000 });
  await p.evaluate(() => window.__nf.advance(400, { x: 1 }, { x: 1 }));
  for (let i = 0; i < 25; i++) await p.evaluate(() => window.__nf.advance(4, { x: 1 }, { x: 1 }));
  const r = await p.evaluate(() => {
    const { sim, view } = window.__nf;
    const rect = view.canvas.getBoundingClientRect();
    const k = rect.width / view.stage.width;
    const f = sim.fighters[1];
    const ext = f.facing > 0 ? f.rig.extent.front : f.rig.extent.back;
    const toCss = (x) => (view.stage.width / 2 + (x - view.stage.cx) * view.stage.scale) * k;
    return { line: view.stage.right * k, body: toCss(f.x + Math.min(0.5, ext)), cssW: rect.width, x: f.x, walls: [sim.fighters[0].x, f.x] };
  });
  check(Math.abs(r.body - r.line) <= TOL && r.line <= r.cssW + 1 && r.line > r.cssW * 0.8,
    `${name}: 2P, walking right → P2's body edge at ${r.body.toFixed(1)} px, right wall line at ${r.line.toFixed(1)} of ${Math.round(r.cssW)} px`);
  await p.screenshot({ path: `${OUT}/right_wall_${name.replace(/[^a-z0-9]+/gi, "_")}.png` });
  check(errs.length === 0, `${name}: no page errors${errs.length ? " " + errs[0] : ""}`);
  await ctx.close();
}
console.log(bad ? `${bad} FAIL` : "WALLS OK");
await b.close();
process.exit(bad ? 1 : 0);
