// Phase 6 check: phones and tablets (Playwright device emulation with touch).
// For each device: draw a fighter with the finger on the home page, pick the pre-drawn Bodybuilder,
// fight the computer, walk with the virtual joystick while punching (two fingers at once), and check
// the page never scrolls or zooms. Then: a game controller (stubbed Gamepad API) drives the fighter,
// and the 2P and online fight pages carry touch controls too. Screenshots into OUT.
import { chromium, devices } from "playwright";
import fs from "node:fs";
import os from "node:os";
const OUT = process.env.OUT || new URL("./shots/p6", import.meta.url).pathname;
const BASE = process.env.BASE || "http://localhost:3100";
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const DEVICES = (process.env.DEVICES || "iPhone 13,iPhone 13 landscape,Pixel 7,iPad Pro 11,iPad Pro 11 landscape").split(",");
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const slug = (d) => d.replace(/ /g, "_");

async function open(dev, url) {
  const ctx = await b.newContext({ ...devices[dev] });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|WebSocket/.test(m.text()) && errs.push(m.text()));
  for (let i = 0; ; i++) {
    try {
      await p.goto(BASE + url, { waitUntil: "networkidle", timeout: 90000 });
      break;
    } catch (e) {
      if (i >= 2) throw e;
    }
  }
  const cdp = await ctx.newCDPSession(p);
  return { ctx, p, errs, cdp };
}
const touch = (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
const centre = async (p, id) => {
  const r = await p.getByTestId(id).boundingBox();
  return [r.x + r.width / 2, r.y + r.height / 2, r];
};
const noScroll = (p) => p.evaluate(() => ({ x: scrollX, y: scrollY, zoom: visualViewport?.scale ?? 1, overflowX: document.documentElement.scrollWidth - innerWidth }));

for (const dev of DEVICES) {
  const { ctx, p, errs, cdp } = await open(dev, "/");
  const home = await noScroll(p);
  check(home.overflowX <= 1, `${dev}: home fits the width (overflow ${home.overflowX}px)`);
  // draw the fighter with a finger (touch events, one stroke per finger drag)
  await p.getByTestId("slot-0").scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  const before = await noScroll(p);
  const r0 = await p.getByTestId("slot-0").boundingBox();
  for (const s of SET.find((d) => d.name === "clean").strokes) {
    const pts = s.points.map((q) => [r0.x + q.x * r0.width, r0.y + q.y * r0.height]);
    await touch(cdp, "touchStart", [pts[0]]);
    for (const q of pts.slice(1)) await touch(cdp, "touchMove", [q]);
    await touch(cdp, "touchEnd", []);
  }
  await p.waitForTimeout(300);
  const stats = await p.getByTestId("slot-stats-0").innerText().catch(() => "");
  const afterDraw = await noScroll(p);
  check(/HP/.test(stats) && afterDraw.y === before.y, `${dev}: drew with touch → "${stats.replace(/\n/g, " | ").slice(0, 70)}…"; page did not scroll while drawing`);
  await p.getByTestId("rival-bodybuilder").scrollIntoViewIfNeeded();
  await p.waitForTimeout(300);
  // (Chromium's touch emulation sometimes swallows the click of the first tap after the scripted
  // drawing gestures; a second tap is what a person would do)
  let taps = 0;
  while (taps < 3 && (await p.getByTestId("rival-bodybuilder").getAttribute("aria-pressed")) !== "true") {
    await p.getByTestId("rival-bodybuilder").tap();
    taps++;
    await p.waitForTimeout(250);
  }
  if (taps > 1) console.log(`     (${dev}: the rival card needed ${taps} taps)`);
  await p.screenshot({ path: `${OUT}/home_${slug(dev)}.png`, fullPage: true });
  await p.getByTestId("fight-cpu").tap();
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 60000 });
  const rival = await p.evaluate(() => window.__nf.sim.rivalEntry?.id);
  const [sx, sy, sr] = await centre(p, "tp-stick");
  const [px, py] = await centre(p, "tp-punch");
  // compact controls: every button and the stick stay comfortably tappable (≥44 px) but never take over the screen
  const vis = await p.evaluate(() => [...document.querySelectorAll(".tp-btn")].filter((e) => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }).length);
  const tallest = await p.evaluate(() => Math.max(...[...document.querySelectorAll(".tp-btn")].map((e) => e.getBoundingClientRect().height)));
  check(rival === "bodybuilder" && vis >= 5 && sr.width >= 60 && sr.width <= 110 && tallest <= 56, `${dev}: /play vs ${rival}; joystick ${Math.round(sr.width)}px, ${vis} buttons ≥44 px, tallest ${Math.round(tallest)}px`);
  // touch devices show only the touch pads: no keyboard legend or key hints
  const ctl = await p.evaluate(() => ({
    mode: document.documentElement.dataset.input,
    pads: [...document.querySelectorAll(".touchpad")].filter((e) => getComputedStyle(e).display !== "none").length,
    legend: [...document.querySelectorAll('[data-testid^="keys-legend"], .bottombar .hint kbd')].filter((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0).length,
  }));
  check(ctl.mode === "touch" && ctl.pads >= 1 && ctl.legend === 0, `${dev}: touch controls only (mode "${ctl.mode}", ${ctl.pads} pad shown, ${ctl.legend} keyboard hints shown)`);
  // phones: the chips, the reading line and the tuners wait in the ☰ menu; the arena takes most of the height
  const phone = await p.evaluate(() => document.documentElement.dataset.fit);
  if (phone?.startsWith("phone")) {
    const shown = () => p.evaluate(() => ["fx-buttons", "reading", "tune"].map((c) => { const e = document.querySelector("." + c); return e ? getComputedStyle(e).display !== "none" : false; }));
    const closed = await shown();
    await p.getByTestId("menu").tap();
    await p.waitForTimeout(200);
    const open = await shown();
    await p.screenshot({ path: `${OUT}/menu_${slug(dev)}.png` });
    await p.getByTestId("menu").tap();
    const host = await p.evaluate(() => document.querySelector(".canvas-host").getBoundingClientRect().height / innerHeight);
    check(closed.every((v) => !v) && open[0] && open[2] && host >= 0.5, `${dev} (${phone}): chips/reading/tuners hidden while fighting ${JSON.stringify(closed)}, shown in the ☰ menu ${JSON.stringify(open)}; arena ${Math.round(host * 100)}% of the height`);
  }
  // the header: ☰, "← notebook", the two bars and the round row never overlap, ☰ / back keep ≥16 px gaps,
  // and (in landscape, where the header is one row) the notebook margin line runs through no header text
  if (phone?.startsWith("phone")) {
    const hdr = await p.evaluate(() => {
      const vis = (e) => e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0;
      const items = [["☰", document.querySelector(".menu-toggle")], ["back", document.querySelector(".topbar .back")], ...[...document.querySelectorAll(".bars > div:not(.round-row)")].map((e, i) => [i ? "rival bar" : "you bar", e]), ["round row", document.querySelector(".round-row")]]
        .filter(([, e]) => vis(e)).map(([n, e]) => { const r = e.getBoundingClientRect(); return { n, l: r.left, r: r.right, t: r.top, b: r.bottom }; });
      const m = /(\d+)px,\s*rgba\(212/.exec(getComputedStyle(document.body).backgroundImage);
      const texts = [...document.querySelectorAll(".topbar .back, .bar-label span, .round-row, .menu-toggle")].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
      return { items, margin: m ? Number(m[1]) + 1 : null, texts };
    });
    const bad = [];
    let minGap = Infinity;
    for (let i = 0; i < hdr.items.length; i++) for (let j = i + 1; j < hdr.items.length; j++) {
      const a = hdr.items[i], b = hdr.items[j];
      if (Math.min(a.b, b.b) - Math.max(a.t, b.t) <= 0) continue; // different rows
      const gap = Math.max(b.l - a.r, a.l - b.r);
      if (gap < 0) bad.push(`${a.n} overlaps ${b.n}`);
      else if ((a.n === "☰" || a.n === "back" || b.n === "☰" || b.n === "back") && gap < 16) bad.push(`${a.n}–${b.n} gap ${Math.round(gap)}px`);
      if (a.n === "☰" || b.n === "☰") minGap = Math.min(minGap, gap);
    }
    const crossed = phone === "phone-landscape" && hdr.margin != null && hdr.texts.some((t) => t.l < hdr.margin && t.r > hdr.margin);
    if (crossed) bad.push(`margin line x=${hdr.margin} runs through header text`);
    check(!bad.length, `${dev}: header clear: ${hdr.items.map((x) => `${x.n} ${Math.round(x.l)}–${Math.round(x.r)}`).join(", ")}; nearest to ☰ ${Math.round(minGap)}px; margin line x=${hdr.margin}${bad.length ? " ✗ " + bad.join("; ") : ""}`);
    if (phone === "phone-landscape") {
      await p.getByTestId("menu").tap();
      await p.waitForTimeout(200);
      const back = await p.evaluate(() => { const e = document.querySelector('[data-testid="menu-back"]'); return !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0; });
      await p.getByTestId("menu").tap();
      check(back, `${dev}: "← notebook" is in the ☰ menu`);
    }
  }
  // the fighters stand above the thumb controls: the ground line is above the buttons' top edge
  const ground = await p.evaluate(() => { const h = document.querySelector(".canvas-host").getBoundingClientRect(); return h.top + h.height * window.__nf.view.layout.ground; });
  const btnTop = await p.evaluate(() => Math.min(...[...document.querySelectorAll(".tp-btn")].map((e) => e.getBoundingClientRect().top)));
  check(ground <= btnTop + 2, `${dev}: ground line at y=${Math.round(ground)} is above the attack buttons (top y=${Math.round(btnTop)})`);
  await p.waitForFunction(() => window.__nf.sim.curr.countdown <= 0, null, { timeout: 15000 });
  // two fingers: the stick pushed toward the rival while the other thumb holds punch
  const x0 = await p.evaluate(() => window.__nf.sim.curr.fighters[0].x);
  await touch(cdp, "touchStart", [[sx, sy], [px, py]]);
  for (let i = 1; i <= 6; i++) await touch(cdp, "touchMove", [[sx + (sr.width * 0.42 * i) / 6, sy], [px, py]]);
  await p.waitForTimeout(120);
  const held = await p.evaluate(() => [...(window.__nf.keys.current ?? window.__nf.keys)]);
  await p.waitForTimeout(600);
  await touch(cdp, "touchMove", [[sx + sr.width * 0.42, sy]]);
  await p.waitForTimeout(500);
  const x1 = await p.evaluate(() => window.__nf.sim.curr.fighters[0].x);
  await touch(cdp, "touchEnd", []);
  await p.waitForTimeout(150);
  const released = await p.evaluate(() => [...(window.__nf.keys.current ?? window.__nf.keys)]);
  const punched = await p.evaluate(() => window.__nf.hist?.length ?? 0);
  check(held.includes("d") && held.includes("f") && x1 > x0 + 0.05 && !released.includes("d"), `${dev}: multi-touch stick + punch held ${JSON.stringify(held)} · walked ${(x1 - x0).toFixed(2)} · released ${JSON.stringify(released)}`);
  // a swipe on the arena must not scroll or zoom the page
  await touch(cdp, "touchStart", [[sx + 120, sy - 200]]);
  for (let i = 1; i <= 8; i++) await touch(cdp, "touchMove", [[sx + 120, sy - 200 + i * 30]]);
  await touch(cdp, "touchEnd", []);
  const fight = await noScroll(p);
  check(fight.y === 0 && fight.x === 0 && fight.zoom === 1 && fight.overflowX <= 1, `${dev}: fight page never scrolls or zooms (scroll ${fight.x},${fight.y}, zoom ${fight.zoom})`);
  // let the computer fight a bit, poke at it, and take the picture
  for (let i = 0; i < 6; i++) {
    await touch(cdp, "touchStart", [[sx + sr.width * 0.4, sy], [px, py]]);
    await p.waitForTimeout(260);
    await touch(cdp, "touchEnd", []);
    await p.waitForTimeout(140);
  }
  await p.screenshot({ path: `${OUT}/fight_bodybuilder_${slug(dev)}.png` });
  const hp = await p.evaluate(() => [window.__nf.sim.curr.playerHp, window.__nf.sim.curr.bagHp].map(Math.round));
  check(errs.length === 0, `${dev}: HP after ~4 s ${hp.join(" / ")} · page errors ${errs.length}${errs.length ? " " + errs.slice(0, 2).join(" | ") : ""}`);
  await ctx.close();
}

// a game controller (Gamepad API stub, standard mapping): stick right walks, X punches
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    const btn = () => ({ pressed: false, touched: false, value: 0 });
    window.__pad = { id: "Stub pad (STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard", timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, btn) };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  });
  const p = await ctx.newPage();
  await p.goto(BASE + "/play?rival=bodybuilder&ai=off", { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForFunction(() => window.__nf?.sim && window.__nf.pads === 1, null, { timeout: 60000 });
  const x0 = await p.evaluate(() => window.__nf.sim.curr.fighters[0].x);
  await p.evaluate(() => {
    window.__pad.axes[0] = 1;
    window.__pad.buttons[2] = { pressed: true, touched: true, value: 1 };
  });
  await p.waitForTimeout(150);
  const held = await p.evaluate(() => [...(window.__nf.keys.current ?? window.__nf.keys)]);
  await p.waitForTimeout(700);
  await p.evaluate(() => {
    window.__pad.axes[0] = 0;
    window.__pad.buttons[2] = { pressed: false, touched: false, value: 0 };
  });
  await p.waitForTimeout(150);
  const x1 = await p.evaluate(() => window.__nf.sim.curr.fighters[0].x);
  const after = await p.evaluate(() => [...(window.__nf.keys.current ?? window.__nf.keys)]);
  check(held.includes("d") && held.includes("f") && x1 > x0 + 0.05 && after.length === 0, `gamepad: 1 pad seen; stick right + X held ${JSON.stringify(held)} · walked ${(x1 - x0).toFixed(2)} · released ${JSON.stringify(after)}`);
  await ctx.close();
}

// 2P duel and online duel: touch controls on phones too
{
  const { ctx, p } = await open("iPhone 13 landscape", "/play?mode=2p");
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 60000 });
  const ids = await p.evaluate(() => [...document.querySelectorAll("[data-testid^=tp-]")].map((e) => e.dataset.testid));
  check(ids.includes("tp-p1-stick") && ids.includes("tp-p2-stick") && ids.includes("tp-p1-punch") && ids.includes("tp-p2-punch"), `2P on a phone: ${ids.length} touch controls (${ids.filter((i) => /stick/.test(i)).join(", ")})`);
  const [ax, ay] = await centre(p, "tp-p1-stick");
  const [bx, by] = await centre(p, "tp-p2-punch");
  await p.waitForFunction(() => window.__nf.sim.curr.countdown <= 0, null, { timeout: 15000 });
  const cdp = await ctx.newCDPSession(p);
  await touch(cdp, "touchStart", [[ax, ay], [bx, by]]);
  await touch(cdp, "touchMove", [[ax + 50, ay], [bx, by]]);
  await p.waitForTimeout(120);
  const held = await p.evaluate(() => [...(window.__nf.keys.current ?? window.__nf.keys)]);
  await touch(cdp, "touchEnd", []);
  check(held.includes("d") && held.includes("j"), `2P: P1 walks while P2 punches at the same time ${JSON.stringify(held)}`);
  await p.screenshot({ path: `${OUT}/twop_iPhone_13_landscape.png` });
  await ctx.close();
}
{
  const { ctx, p } = await open("Pixel 7", "/online");
  const ids = await p.evaluate(() => [...document.querySelectorAll("[data-testid^=tp-]")].map((e) => e.dataset.testid));
  check(ids.includes("tp-stick") && ids.includes("tp-punch"), `online on a phone: touch controls present (${ids.length})`);
  await p.screenshot({ path: `${OUT}/online_Pixel_7.png` });
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} FAIL` : "MOBILE OK");
process.exit(bad ? 1 : 0);
