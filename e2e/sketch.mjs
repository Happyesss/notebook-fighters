// The drawing boxes and the big drawing pad, on desktop, phones and tablets:
//  1) the two drawing boxes on the notebook page are the same size;
//  2) "expand" opens the big pad: draw a fighter in coloured pencils (finger on touch devices, mouse
//     on desktop), rub part of it out with the eraser (the stroke is really cut in two), undo/redo,
//     Escape cancels, Done brings the drawing back to the small box; the page never scrolls or zooms;
//  3) the fight starts with that drawing and the colours show in the arena;
//  4) the online lobby (needs the Worker: BASE_ONLINE, default BASE) has Copy beside the room code.
// Expects the site on BASE (default `pnpm worker:dev` on :8787). Screenshots into OUT.
import { chromium, devices } from "playwright";
import fs from "node:fs";
const BASE = (process.env.BASE || "http://localhost:8787").replace(/\/$/, "");
const BASE_ONLINE = (process.env.BASE_ONLINE || BASE).replace(/\/$/, "");
const OUT = process.env.OUT || new URL("./shots/sketch", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const DEVICES = (process.env.DEVICES || "Desktop 1280x800,iPhone 13,iPhone 13 landscape,iPad Pro 11,iPad Pro 11 landscape").split(",");
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const slug = (d) => d.replace(/ /g, "_");
const GREEN = [0x2f, 0x7d, 0x4a];
const RED = [0xc2, 0x3b, 0x32];

// the test fighter, in box coordinates: red head, green body, blue arms, pencil legs
const circle = (cx, cy, r, n = 24) => Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos((i / n) * 6.283) * r, y: cy + Math.sin((i / n) * 6.283) * r * 0.75 }));
const line = (a, z, n = 12) => Array.from({ length: n + 1 }, (_, i) => ({ x: a[0] + ((z[0] - a[0]) * i) / n, y: a[1] + ((z[1] - a[1]) * i) / n }));
const FIGHTER = [
  { color: "red", pts: circle(0.5, 0.17, 0.1) },
  { color: "green", pts: line([0.5, 0.26], [0.5, 0.6], 16) },
  { color: "blue", pts: line([0.5, 0.33], [0.26, 0.48]) },
  { color: "blue", pts: line([0.5, 0.33], [0.74, 0.48]) },
  { color: "pencil", pts: line([0.5, 0.6], [0.34, 0.9]) },
  { color: "pencil", pts: line([0.5, 0.6], [0.66, 0.9]) },
];

async function open(dev, url) {
  const opts = dev.startsWith("Desktop") ? DESKTOP : devices[dev];
  const ctx = await b.newContext({ ...opts });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|WebSocket|fonts\.g/.test(m.text()) && errs.push(m.text()));
  await p.goto(BASE + url, { waitUntil: "load", timeout: 90000 });
  const cdp = opts.hasTouch ? await ctx.newCDPSession(p) : null;
  return { ctx, p, errs, cdp, touch: !!opts.hasTouch };
}
const touchEv = (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
async function drag(t, pts) {
  if (t.touch) {
    await touchEv(t.cdp, "touchStart", [pts[0]]);
    for (const q of pts.slice(1)) await touchEv(t.cdp, "touchMove", [q]);
    await touchEv(t.cdp, "touchEnd", []);
  } else {
    await t.p.mouse.move(...pts[0]);
    await t.p.mouse.down();
    for (const q of pts.slice(1)) await t.p.mouse.move(...q);
    await t.p.mouse.up();
  }
}
const tap = (t, id) => (t.touch ? t.p.getByTestId(id).tap() : t.p.getByTestId(id).click());
/** (Chromium's touch emulation sometimes swallows the first tap after scripted drawing gestures, as
 * noted in mobile.mjs; a person would tap again, so tap until the expected state shows) */
async function tapUntil(t, id, done) {
  for (let i = 0; i < 4; i++) {
    await tap(t, id);
    await t.p.waitForTimeout(60);
    if (await done()) return i + 1;
  }
  return 0;
}
const pressed = (t, id) => async () => (await t.p.getByTestId(id).getAttribute("aria-pressed")) === "true";
const enabled = (t, id, want = true) => async () => (await t.p.getByTestId(id).isEnabled()) === want;
const scrollState = (p) => p.evaluate(() => ({ x: scrollX, y: scrollY, zoom: visualViewport?.scale ?? 1 }));
/** pixels close to a colour inside an element (screenshot of its box) */
async function countColour(p, locator, rgb, tol = 38) {
  const png = await locator.screenshot();
  return p.evaluate(
    async ({ b64, rgb, tol }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) + Math.abs(d[i + 1] - rgb[1]) + Math.abs(d[i + 2] - rgb[2]) < tol) n++;
      return n;
    },
    { b64: png.toString("base64"), rgb, tol },
  );
}

for (const dev of DEVICES) {
  const t = await open(dev, "/");
  const { p, errs } = t;
  await p.waitForSelector('[data-testid="slot-1"]');
  // 1) equal boxes
  const [r0, r1] = [await p.getByTestId("slot-0").boundingBox(), await p.getByTestId("slot-1").boundingBox()];
  check(Math.abs(r0.width - r1.width) <= 1 && Math.abs(r0.height - r1.height) <= 1 && Math.abs(r0.y - r1.y) <= 1,
    `${dev}: drawing boxes the same size, side by side (${Math.round(r0.width)}×${Math.round(r0.height)} vs ${Math.round(r1.width)}×${Math.round(r1.height)})`);
  const tools = await p.evaluate(() => [0, 1].map((i) => {
    const e = document.querySelector(`[data-testid="expand-${i}"]`), c = document.querySelector(`[data-testid="clear-${i}"]`);
    const re = e?.getBoundingClientRect(), rc = c?.getBoundingClientRect();
    return !!(re && rc && re.width > 20 && Math.abs(re.top - rc.top) < 4 && rc.left >= re.right - 1);
  }));
  check(tools.every(Boolean), `${dev}: "expand" sits beside "clear" on both boxes`);
  await p.getByTestId("slot-1").scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/boxes_${slug(dev)}.png` });

  // 2) the big pad
  await p.getByTestId("slot-0").scrollIntoViewIfNeeded();
  const before = await scrollState(p);
  await tap(t, "expand-0");
  await p.waitForSelector('[data-testid="sketch-canvas"]');
  await p.waitForTimeout(200);
  const pad = await p.getByTestId("sketch-canvas").boundingBox();
  const vp = p.viewportSize();
  check(pad.width >= r0.width * 1.3 && pad.x >= 0 && pad.y >= 0 && pad.x + pad.width <= vp.width + 1 && pad.y + pad.height <= vp.height + 1 && Math.abs(pad.width / pad.height - 0.75) < 0.02,
    `${dev}: big pad ${Math.round(pad.width)}×${Math.round(pad.height)} (box ${Math.round(r0.width)}×${Math.round(r0.height)}), 3:4, fully on screen`);
  const at = (q) => [pad.x + q.x * pad.width, pad.y + q.y * pad.height];
  for (const s of FIGHTER) {
    await tapUntil(t, `sketch-color-${s.color}`, pressed(t, `sketch-color-${s.color}`));
    await drag(t, s.pts.map(at));
  }
  // a stray scribble: undo, redo, undo
  await tapUntil(t, "sketch-color-orange", pressed(t, "sketch-color-orange"));
  await drag(t, line([0.1, 0.1], [0.2, 0.05], 6).map(at));
  await tapUntil(t, "sketch-undo", enabled(t, "sketch-redo"));
  await tapUntil(t, "sketch-redo", enabled(t, "sketch-redo", false));
  await tapUntil(t, "sketch-undo", enabled(t, "sketch-redo"));
  const redoOn = await p.getByTestId("sketch-redo").isEnabled();
  // rub a gap across the right shin: that pencil stroke is cut into two pieces (the foot becomes a prop);
  // the fighter still reads as a person with two legs
  await tapUntil(t, "sketch-eraser", pressed(t, "sketch-eraser"));
  await drag(t, line([0.57, 0.835], [0.67, 0.815], 8).map(at));
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${OUT}/modal_${slug(dev)}.png` });
  const during = await scrollState(p);
  check(during.y === before.y && during.x === before.x && during.zoom === 1 && redoOn, `${dev}: drawing on the pad never scrolls or zooms the page; redo available after undo`);
  await tapUntil(t, "sketch-done", async () => (await p.getByTestId("sketch-modal").count()) === 0);
  await p.waitForSelector('[data-testid="sketch-modal"]', { state: "detached" });
  const greenSmall = await countColour(p, p.getByTestId("slot-0"), GREEN);
  const stats = await p.getByTestId("slot-stats-0").innerText().catch(() => "");
  check(greenSmall > 15 && /HP/.test(stats) && !/no legs/.test(stats), `${dev}: Done → the coloured drawing is in box 1 (${greenSmall} green px) and read: "${stats.replace(/\n/g, " | ").slice(0, 60)}…"`);

  // Escape cancels: open, scribble, Esc → unchanged
  if (!t.touch) {
    await tap(t, "expand-0");
    await p.waitForSelector('[data-testid="sketch-canvas"]');
    await drag(t, line([0.1, 0.8], [0.3, 0.95], 6).map(at));
    await p.keyboard.press("Control+z");
    await p.keyboard.press("Control+Shift+z");
    await p.keyboard.press("Escape");
    await p.waitForSelector('[data-testid="sketch-modal"]', { state: "detached" });
    const focused = await p.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    const stats2 = await p.getByTestId("slot-stats-0").innerText().catch(() => "");
    check(stats2 === stats && focused === "expand-0", `${dev}: Escape closes the pad without changing the drawing; focus back on "expand" (${focused})`);
  }

  // 3) fight with it
  await p.getByTestId("rival-ninja").scrollIntoViewIfNeeded();
  await tapUntil(t, "rival-ninja", pressed(t, "rival-ninja"));
  await p.getByTestId("fight-cpu").scrollIntoViewIfNeeded();
  await tap(t, "fight-cpu");
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 60000 });
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("nf:fighter") || "[]"));
  const colours = [...new Set(saved.map((s) => s.color))];
  const leads = saved.filter((s) => s.color === "#2a241c").length;
  const oranges = saved.filter((s) => s.color === "#e07a2f").length;
  check(saved.length === 7 && leads === 3 && oranges === 0 && colours.length === 4,
    `${dev}: the fighter keeps its colours per stroke (${colours.join(" ")}); the eraser cut a leg in two (${leads} pencil pieces, ${saved.length} strokes); undone scribble gone`);
  await p.waitForTimeout(1500);
  const host = p.locator(".canvas-host");
  const g = await countColour(p, host, GREEN);
  const r = await countColour(p, host, RED, 30);
  const kind = await p.evaluate(() => window.__nf.sim.curr?.fighters?.[0]?.rig?.kind ?? window.__nf.sim.fighters?.[0]?.rig?.kind ?? "?");
  await p.screenshot({ path: `${OUT}/arena_${slug(dev)}.png` });
  check(g > 30 && r > 10 && kind === "fighter", `${dev}: the coloured fighter in the arena (${g} green px, ${r} red px), read as "${kind}"`);
  check(errs.length === 0, `${dev}: no page errors ${errs.slice(0, 2).join(" | ")}`);
  await t.ctx.close();
}

// 4) online: Copy beside the room code (clipboard API and the fallback)
for (const [dev, noApi] of [["Desktop 1280x800", false], ["iPhone 13", true], ["iPad Pro 11", false]]) {
  const opts = dev.startsWith("Desktop") ? DESKTOP : devices[dev];
  const ctx = await b.newContext({ ...opts });
  if (!noApi) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_ONLINE });
  else await ctx.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  const p = await ctx.newPage();
  await p.goto(BASE_ONLINE + "/online?create", { waitUntil: "load", timeout: 90000 });
  await p.waitForSelector('[data-testid="room-code"]', { timeout: 30000 });
  const code = await p.getByTestId("room-code").innerText();
  const [rc, rb] = [await p.getByTestId("room-code").boundingBox(), await p.getByTestId("copy-code").boundingBox()];
  const beside = Math.abs(rc.y + rc.height / 2 - (rb.y + rb.height / 2)) < 12 && rb.x > rc.x + rc.width - 1 && rb.x - (rc.x + rc.width) < 40;
  await (opts.hasTouch ? p.getByTestId("copy-code").tap() : p.getByTestId("copy-code").click());
  await p.waitForTimeout(200);
  const label = await p.getByTestId("copy-code").innerText();
  const clip = noApi ? "(fallback)" : await p.evaluate(() => navigator.clipboard.readText());
  await p.screenshot({ path: `${OUT}/room_${slug(dev)}.png` });
  check(beside && label === "Copied!" && (noApi || clip === code), `${dev}: Copy beside room code ${code} → "${label}"${noApi ? " via the execCommand fallback (no Clipboard API)" : `, clipboard "${clip}"`}`);
  await p.waitForTimeout(2100);
  check((await p.getByTestId("copy-code").innerText()) === "Copy", `${dev}: the button goes back to "Copy"`);
  if (!noApi) {
    await p.getByTestId("copy-link").click();
    const link = await p.evaluate(() => navigator.clipboard.readText());
    check(link.endsWith(`/r/${code}`), `${dev}: Copy link → ${link}`);
  }
  await ctx.close();
}

await b.close();
console.log(bad ? `${bad} FAILED` : "all ok");
process.exit(bad ? 1 : 0);
