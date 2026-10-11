// Phase 7: controls per device. A mouse + keyboard (pointer: fine, no touch) sees only the keyboard legend; phones
// and tablets see only the touch pads; a hybrid touch laptop starts from its primary pointer, switches to the pads
// on the first real touch and back to the legend on a key press. Checked on every fight page: 1P, 2P, online.
// The gamepad works either way (a stubbed pad walks P1 with the legend showing). Screenshots in shots/p7.
import { chromium, devices } from "playwright";
import fs from "node:fs";
import os from "node:os";
const BASE = process.env.BASE || "http://localhost:3100";
const OUT = new URL("./shots/p7", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const shown = (p) =>
  p.evaluate(() => {
    const vis = (e) => !!e && getComputedStyle(e).display !== "none" && (e.offsetParent !== null || getComputedStyle(e).position === "fixed") && e.getBoundingClientRect().width > 0;
    const pads = [...document.querySelectorAll(".touchpad")];
    const legends = [...document.querySelectorAll('[data-testid^="keys-legend"]')];
    return { mode: document.documentElement.dataset.input, pads: pads.filter(vis).length, padsAll: pads.length, legend: legends.filter(vis).length, legendAll: legends.length, padDisplay: pads.map((e) => getComputedStyle(e).display), legendDisplay: legends.map((e) => getComputedStyle(e).display) };
  });
const ONLY = process.env.ONLY;
const PAGES = [["1P", "/play?rival=kid"], ["2P", "/play?mode=2p"], ["online", "/online"]];
async function open(opts, url) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
  await p.evaluate((s) => localStorage.setItem("nf:fighter", JSON.stringify(s)), SET.find((d) => d.name === "clean").strokes);
  await p.goto(BASE + url, { waitUntil: "load", timeout: 90000 });
  if (!url.startsWith("/online")) await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  return { p, ctx, errs };
}
const slug = (s) => s.replace(/[^a-z0-9]+/gi, "_");

// ---- desktop (mouse + keyboard): only the legend, on every fight page
for (const [name, url] of ONLY ? [] : PAGES) {
  const { p, ctx, errs } = await open({ viewport: { width: 1366, height: 768 } }, url);
  const s = await shown(p);
  // online: the fight overlay is hidden in the lobby, so check the controls' own display
  const ok = name === "online" ? s.mode === "keys" && s.padDisplay.every((d) => d === "none") && s.legendDisplay.every((d) => d !== "none") && s.legendAll > 0 : s.mode === "keys" && s.pads === 0 && s.legend >= 1;
  check(ok && !errs.length, `desktop ${name}: mode "${s.mode}", touch pads shown ${s.pads}/${s.padsAll} (display ${JSON.stringify(s.padDisplay)}), keyboard legend shown ${s.legend}/${s.legendAll}`);
  if (name !== "online") await p.screenshot({ path: `${OUT}/controls_desktop_${name}.png` });
  await ctx.close();
}

// ---- phones and tablets: only the pads
for (const dev of ONLY ? [] : ["iPhone 13", "iPhone 13 landscape", "Pixel 7", "iPad Pro 11"]) {
  for (const [name, url] of PAGES) {
    const { p, ctx, errs } = await open({ ...devices[dev] }, url);
    const s = await shown(p);
    const ok = name === "online" ? s.mode === "touch" && s.padDisplay.every((d) => d !== "none") && s.legendDisplay.every((d) => d === "none") : s.mode === "touch" && s.pads >= 1 && s.legend === 0;
    check(ok && !errs.length, `${dev} ${name}: mode "${s.mode}", touch pads shown ${s.pads}/${s.padsAll}, keyboard legend shown ${s.legend}/${s.legendAll} (display ${JSON.stringify(s.legendDisplay)})`);
    if (name === "1P" || (name === "2P" && dev === "iPad Pro 11")) {
      await p.waitForTimeout(400);
      await p.screenshot({ path: `${OUT}/controls_${slug(dev)}_${name}.png` });
    }
    await ctx.close();
  }
}

// ---- hybrid touch laptop. Chromium can't emulate "touch screen + trackpad as the primary pointer" (turning touch
// emulation on makes the primary pointer coarse), so two halves:
// (a) a mouse/trackpad laptop (pointer: fine) starts with the legend; a touch pointer-event shows the pads, a key brings
//     the legend back, a mouse click changes nothing;
// (b) a touch-enabled context: real CDP touches and key presses switch back and forth.
{
  const { p, ctx } = await open({ viewport: { width: 1366, height: 768 } }, "/play?rival=kid");
  const s0 = await shown(p);
  await p.screenshot({ path: `${OUT}/controls_hybrid_start.png` });
  await p.evaluate(() => document.querySelector("canvas").dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true, isPrimary: true })));
  await p.waitForTimeout(150);
  const s1 = await shown(p);
  await p.screenshot({ path: `${OUT}/controls_hybrid_after_touch.png` });
  await p.keyboard.press("d");
  await p.waitForTimeout(150);
  const s2 = await shown(p);
  await p.mouse.click(700, 300);
  await p.waitForTimeout(100);
  const s3 = await shown(p);
  check(
    s0.mode === "keys" && s0.pads === 0 && s0.legend >= 1 && s1.mode === "touch" && s1.pads >= 1 && s1.legend === 0 && s2.mode === "keys" && s2.pads === 0 && s2.legend >= 1 && s3.mode === "keys",
    `hybrid (a) trackpad-primary: starts "${s0.mode}" (pads ${s0.pads}, legend ${s0.legend}) → touch → "${s1.mode}" (pads ${s1.pads}, legend ${s1.legend}) → key → "${s2.mode}" (pads ${s2.pads}, legend ${s2.legend}) → mouse click → "${s3.mode}"`,
  );
  await ctx.close();
}
{
  const { p, ctx } = await open({ viewport: { width: 1366, height: 768 }, hasTouch: true }, "/play?rival=kid");
  const cdp = await ctx.newCDPSession(p);
  const s0 = await shown(p);
  await p.keyboard.press("d");
  await p.waitForTimeout(150);
  const s1 = await shown(p);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 700, y: 300, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(150);
  const s2 = await shown(p);
  check(s1.mode === "keys" && s1.pads === 0 && s1.legend >= 1 && s2.mode === "touch" && s2.pads >= 1 && s2.legend === 0, `hybrid (b) touch laptop: starts "${s0.mode}" → key → "${s1.mode}" (pads ${s1.pads}, legend ${s1.legend}) → real touch → "${s2.mode}" (pads ${s2.pads}, legend ${s2.legend})`);
  await ctx.close();
}

// ---- a gamepad still drives P1 on the desktop (legend mode) and on a phone (touch mode)
for (const [label, opts] of [["desktop", { viewport: { width: 1366, height: 768 } }], ["iPhone 13", { ...devices["iPhone 13"] }]]) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => {
    const pad = { id: "Stub pad", index: 0, connected: true, mapping: "standard", timestamp: 0, axes: [1, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    navigator.getGamepads = () => [pad, null, null, null];
  });
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "load", timeout: 90000 });
  await p.evaluate((s) => localStorage.setItem("nf:fighter", JSON.stringify(s)), SET.find((d) => d.name === "clean").strokes);
  await p.goto(BASE + "/play?ai=off&rivalPower=none", { waitUntil: "load", timeout: 90000 });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  const x0 = await p.evaluate(() => window.__nf.sim.fighters[0].x);
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => ({ x: window.__nf.sim.fighters[0].x, pads: window.__nf.pads, mode: document.documentElement.dataset.input }));
  check(r.pads >= 1 && r.x - x0 > 0.1, `gamepad on ${label} (mode "${r.mode}"): ${r.pads} pad, stick right walked P1 ${(r.x - x0).toFixed(2)}`);
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} FAILED` : "CONTROLS OK");
process.exit(bad ? 1 : 0);
