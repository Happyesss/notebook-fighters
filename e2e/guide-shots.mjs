// Makes the How to play pictures from the real game: Playwright screenshots (an iPhone 13 for the
// touch guide, 1280x800 for the keyboard guide) with labelled callouts and arrows on every button,
// saved as small WebP files in apps/web/public/guide/ (the service worker precaches them).
// Needs a running build (BASE) and python3 with Pillow for the WebP step. Raw PNGs go to OUT.
//   BASE=http://localhost:8797 node guide-shots.mjs
import { chromium, devices } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const BASE = (process.env.BASE || "http://localhost:8797").replace(/\/$/, "");
const OUT = process.env.OUT || new URL("./shots/guide-raw", import.meta.url).pathname;
const DEST = new URL("../apps/web/public/guide/", import.meta.url).pathname;
const ONLY = process.env.ONLY?.split(",");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DEST, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const S = (n) => SET.find((d) => d.name === n).strokes;
const tint = (strokes, color) => strokes.map((s) => ({ ...s, color }));
const flame = S("power_fire").slice(S("clean").length);
const BOOK = {
  fighters: [
    { id: "g1", strokes: tint(S("clean"), "#1d4f89") },
    { id: "g2", strokes: [...S("darkRightArm"), ...flame] },
  ],
  p1: "g1",
  p2: "g2",
};
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND", "--use-fake-ui-for-media-stream"] });

const PHONE = { ...devices["iPhone 13"], deviceScaleFactor: 2 };
const PHONE_LAND = { ...devices["iPhone 13 landscape"], deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };

async function open(opts, book = BOOK) {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript((bk) => {
    if (sessionStorage.getItem("nf-guide-shots")) return;
    sessionStorage.setItem("nf-guide-shots", "1");
    localStorage.setItem("nf:guide-seen", "1");
    localStorage.setItem("nf:mute", "1");
    if (bk) {
      localStorage.setItem("nf:fighters", JSON.stringify(bk));
      localStorage.setItem("nf:fighter", JSON.stringify(bk.fighters[0].strokes));
      localStorage.setItem("nf:fighter2", JSON.stringify(bk.fighters[1].strokes));
    }
  }, book);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", String(e)));
  return p;
}

/**
 * Draw callouts on the page: each item points at an element (CSS selector, optional nth) with a label
 * placed at (dx, dy) css px from the element's centre; the element gets a dashed red outline.
 */
async function callouts(p, items, legend = null) {
  await p.evaluate(([items, legend]) => {
    document.getElementById("nf-callouts")?.remove();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const root = document.createElement("div");
    root.id = "nf-callouts";
    root.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none;font-family:var(--font-hand),'Patrick Hand',cursive";
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.style.cssText = "position:absolute;inset:0";
    svg.innerHTML = '<defs><marker id="nfa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c23b32"/></marker></defs>';
    root.appendChild(svg);
    document.body.appendChild(root);
    const fs = items[0]?.font ?? 15;
    for (const it of items) {
      const els = document.querySelectorAll(it.sel);
      const el = els[it.nth ?? 0];
      if (!el) {
        console.log("callout: no element", it.sel);
        continue;
      }
      const r0 = el.getBoundingClientRect();
      // pt: point at a spot inside the element (fractions of its box) instead of the whole element
      const r = it.pt ? new DOMRect(r0.left + it.pt[0] * r0.width - 4, r0.top + it.pt[1] * r0.height - 4, 8, 8) : r0;
      if (it.pt) it.noBox = true;
      const pad = it.pad ?? 3;
      const box = document.createElementNS(ns, "rect");
      Object.entries({ x: r.left - pad, y: r.top - pad, width: r.width + 2 * pad, height: r.height + 2 * pad, rx: 6, fill: "none", stroke: "#c23b32", "stroke-width": 2.2, "stroke-dasharray": "5 3" }).forEach(([k, v]) => box.setAttribute(k, v));
      if (!it.noBox) svg.appendChild(box);
      const cx = r.left + r.width / 2;
      const cy = it.anchor === "top" ? r.top + 30 : r.top + r.height / 2;
      const lab = document.createElement("div");
      lab.textContent = legend ? String(items.indexOf(it) + 1) : it.label;
      lab.style.cssText = legend
        ? `position:absolute;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#c23b32;color:#fff;font-size:15px;font-weight:bold;box-shadow:1px 1px 0 rgba(42,36,28,.3)`
        : `position:absolute;white-space:nowrap;background:#fff7d6;border:2px solid #c23b32;border-radius:8px;color:#a3241c;font-size:${it.font ?? fs}px;line-height:1.1;padding:2px 7px;box-shadow:2px 2px 0 rgba(42,36,28,.18)`;
      root.appendChild(lab);
      const lw = lab.offsetWidth;
      const lh = lab.offsetHeight;
      let lx = Math.max(3, Math.min(W - lw - 3, cx + it.dx - lw / 2));
      let ly = Math.max(3, Math.min(H - lh - 3, cy + it.dy - lh / 2));
      lab.style.left = lx + "px";
      lab.style.top = ly + "px";
      // arrow from the label's nearest edge to the element's nearest edge
      const lcx = lx + lw / 2;
      const lcy = ly + lh / 2;
      const ax = Math.max(lx, Math.min(lx + lw, cx));
      const ay = Math.max(ly, Math.min(ly + lh, cy));
      const sx = Math.abs(cx - lcx) > Math.abs(cy - lcy) * (lw / lh) ? (cx > lcx ? lx + lw : lx) : ax;
      const sy = Math.abs(cx - lcx) > Math.abs(cy - lcy) * (lw / lh) ? ay : cy > lcy ? ly + lh : ly;
      const tx = Math.max(r.left - pad, Math.min(r.right + pad, sx));
      const ty = Math.max(r.top - pad, Math.min(r.bottom + pad, sy));
      const ex = tx === sx && ty === sy ? cx : tx;
      const ey = tx === sx && ty === sy ? cy : ty;
      if (Math.hypot(ex - sx, ey - sy) > 6) {
        const path = document.createElementNS(ns, "path");
        const mx = (sx + ex) / 2 + (ey - sy) * 0.12;
        const my = (sy + ey) / 2 - (ex - sx) * 0.12;
        path.setAttribute("d", `M${sx},${sy} Q${mx},${my} ${ex},${ey}`);
        Object.entries({ fill: "none", stroke: "#c23b32", "stroke-width": 2.2, "marker-end": "url(#nfa)" }).forEach(([k, v]) => path.setAttribute(k, v));
        svg.appendChild(path);
      }
    }
    if (legend) {
      // numbered badges by the elements, and the words in one list
      const box = document.createElement("div");
      box.style.cssText = `position:absolute;left:${legend.x}px;top:${legend.y}px;width:${legend.w}px;background:#fff7d6;border:2px solid #c23b32;border-radius:10px;padding:6px 10px;color:#a3241c;font-size:${legend.font ?? 15}px;line-height:1.35;box-shadow:2px 2px 0 rgba(42,36,28,.18)`;
      box.innerHTML = items.map((it, k) => `<div><b style="display:inline-grid;place-items:center;width:1.35em;height:1.35em;border-radius:50%;background:#c23b32;color:#fff;margin-right:6px;font-size:.85em">${k + 1}</b>${it.label}</div>`).join("");
      root.appendChild(box);
    }
  }, [items, legend]);
  await p.waitForTimeout(80);
}

/** screenshot, then a small WebP (max width) into public/guide */
async function save(p, name, clip, maxW) {
  const png = `${OUT}/${name}.png`;
  await p.screenshot({ path: png, ...(clip ? { clip } : {}) });
  const webp = `${DEST}${name}.webp`;
  execFileSync("python3", ["-c", `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w = int(sys.argv[3])
if im.width > w:
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
im.save(sys.argv[2], "WEBP", quality=72, method=6)
`, png, webp, String(maxW)]);
  console.log(`${name}.webp ${(fs.statSync(webp).size / 1024).toFixed(0)} KB`);
}
const want = (n) => !ONLY || ONLY.includes(n);
const boxOf = async (p, sel, pad = 8) => {
  const r = await p.locator(sel).first().boundingBox();
  return r;
};
const unionClip = async (p, sels, pad = 10) => {
  const vp = p.viewportSize();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sels)
    for (const l of await p.locator(s).all()) {
      const r = await l.boundingBox();
      if (!r) continue;
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.width); y1 = Math.max(y1, r.y + r.height);
    }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(vp.width, x1 + pad); y1 = Math.min(vp.height, y1 + pad);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

// ---------------------------------------------------------------- 1 draw
for (const [mode, opts] of [["touch", PHONE], ["keys", DESK]]) {
  if (!want("draw")) break;
  const p = await open(opts);
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.locator(".pencils").evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 8));
  await p.waitForTimeout(200);
  const touch = mode === "touch";
  await callouts(p, [
    { sel: ".pencils .pencil", nth: 4, label: "pick a colour", dx: touch ? 50 : 200, dy: touch ? 92 : 0, pad: 2 },
    { sel: '[data-testid="slot-0"]', label: touch ? "draw here with your finger" : "draw here", dx: 0, dy: touch ? 30 : 40, noBox: true },
    { sel: '[data-testid="expand-0"]', label: "⤢ big pad", dx: touch ? -70 : -90, dy: touch ? 28 : 30 },
    { sel: '[data-testid="clear-0"]', label: "clear", dx: touch ? 10 : 30, dy: touch ? 50 : 50 },
    { sel: '[data-testid="pick-p1-0"]', label: "play this", dx: touch ? 10 : -10, dy: touch ? 42 : 40 },
    { sel: '[data-testid="pick-p2-1"]', label: "P2's fighter", dx: touch ? -40 : 0, dy: touch ? 42 : 40 },
    { sel: '[data-testid="delete-1"]', label: "🗑 delete", dx: touch ? 0 : 40, dy: touch ? 80 : 40 },
    { sel: '[data-testid="add-fighter"]', label: "+ new fighter", dx: touch ? 0 : 0, dy: touch ? 20 : -60, anchor: touch ? "top" : undefined },
  ]);
  const clip = await unionClip(p, [".pencils", '[data-testid="tile-0"]', '[data-testid="tile-1"]', '[data-testid="add-fighter"]', "#nf-callouts div"], 6);
  await save(p, `${mode}-draw`, { ...clip, height: Math.min(clip.height, touch ? 580 : 640) }, touch ? 640 : 900);
  await p.context().close();
}

// ---------------------------------------------------------------- 2 what drawing does
for (const [mode, opts] of [["touch", PHONE], ["keys", DESK]]) {
  if (!want("ink")) break;
  const p = await open(opts);
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.locator('[data-testid="tile-0"]').evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - (innerWidth < 600 ? 20 : 30)));
  await p.waitForTimeout(200);
  const touch = mode === "touch";
  await callouts(p, [
    { sel: '[data-testid="slot-1"]', pt: [0.6, 0.42], label: "dark, scribbled arm = harder hits", dx: touch ? -60 : -120, dy: touch ? -150 : -150 },
    { sel: '[data-testid="slot-1"]', pt: [0.8, 0.46], label: "a flame doodle = Fireball", dx: touch ? -40 : 0, dy: touch ? 110 : 110 },
    { sel: '[data-testid="slot-stats-0"]', label: "a plain drawing's numbers", dx: 0, dy: touch ? 60 : 50 },
    { sel: '[data-testid="slot-stats-1"]', label: "go over a part: they go up", dx: touch ? -30 : 0, dy: touch ? 105 : 50 },
  ]);
  const clip = await unionClip(p, ['[data-testid="tile-0"]', '[data-testid="tile-1"]', "#nf-callouts div"], 6);
  await save(p, `${mode}-ink`, clip, touch ? 640 : 900);
  await p.context().close();
}

// ---------------------------------------------------------------- 3 computer (picker)
for (const [mode, opts] of [["touch", PHONE], ["keys", DESK]]) {
  if (!want("cpu")) break;
  const p = await open(opts);
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.getByTestId("fight-cpu").click();
  await p.getByTestId("rival-picker").waitFor();
  await p.getByTestId("pick-boxer").click();
  await p.waitForTimeout(200);
  const touch = mode === "touch";
  await callouts(p, [
    { sel: '[data-testid="pick-auto"]', label: "let the computer pick", dx: touch ? 40 : 60, dy: touch ? 80 : 90 },
    { sel: '[data-testid="pick-boxer"]', label: "or pick a rival", dx: touch ? -20 : 0, dy: touch ? 95 : 110 },
    { sel: '[data-testid="pick-info-boxer"]', label: "ⓘ its card", dx: touch ? 30 : 60, dy: touch ? -30 : -36 },
    { sel: '[data-testid="rival-picker"] .lvl-pick', label: "Easy / Normal / Hard", dx: touch ? 0 : 230, dy: touch ? 40 : 0 },
    { sel: '[data-testid="pick-fight"]', label: "start the fight", dx: touch ? 40 : 0, dy: touch ? -58 : -48 },
    { sel: '[data-testid="rival-picker-close"]', label: "✕ close", dx: touch ? -95 : -100, dy: touch ? 0 : 0 },
  ]);
  await save(p, `${mode}-cpu`, null, touch ? 600 : 960);
  await p.context().close();
}

// ---------------------------------------------------------------- 4 two players (fight)
for (const [mode, opts] of [["touch", PHONE_LAND], ["keys", DESK]]) {
  if (!want("duo")) break;
  const p = await open(opts);
  await p.goto(`${BASE}/play?mode=2p&countdown=0`, { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim && window.__nf.view, null, { timeout: 30000 });
  await p.evaluate(() => {
    window.__nf.paused = true;
    window.__nf.advance(40, { x: 1 }, { x: -1 });
  });
  await p.waitForTimeout(250);
  const touch = mode === "touch";
  if (touch)
    await callouts(p, [
      { sel: '[data-testid="tp-p1-stick"]', label: "P1 walks / jumps", dx: 60, dy: -70, font: 13 },
      { sel: '[data-testid="tp-p1-punch"]', label: "P1 hit · kick · jump · block · ★", dx: 40, dy: -75, font: 13 },
      { sel: '[data-testid="tp-p2-stick"]', label: "P2 walks / jumps", dx: -40, dy: -110, font: 13 },
      { sel: '[data-testid="tp-p2-punch"]', label: "P2's buttons", dx: -20, dy: -60, font: 13 },
    ]);
  else
    await callouts(p, [
      { sel: '[data-testid="keys-legend-p1"]', label: "P1: A D W S · F G H E", dx: 0, dy: -60 },
      { sel: '[data-testid="keys-legend-p2"]', label: "P2: arrows · J K L ;", dx: 0, dy: -60 },
      { sel: ".bars > div", nth: 0, label: "P1's HP", dx: -170, dy: 0 },
      { sel: ".bars > div", nth: 1, label: "P2's HP", dx: -170, dy: 0 },
    ]);
  await save(p, `${mode}-duo`, null, touch ? 760 : 960);
  await p.context().close();
}

// ---------------------------------------------------------------- 5 room: code, Copy, Copy link, then Accept / Decline
for (const [mode, opts] of [["touch", PHONE], ["keys", DESK]]) {
  if (!want("room")) break;
  const touch = mode === "touch";
  const host = await open(opts);
  await host.goto(`${BASE}/online`, { waitUntil: "networkidle" });
  await host.getByTestId("create-room").click();
  await host.getByTestId("room-code").waitFor({ timeout: 30000 });
  await host.waitForTimeout(300);
  const code = (await host.getByTestId("room-code").innerText()).trim();
  const copyBtns = await host.$$eval("button", (bs) => bs.map((x, i) => [i, x.textContent.trim()]).filter(([, t]) => /^Copy/.test(t)));
  console.log("copy buttons", JSON.stringify(copyBtns), "code", code);
  // the friend joins with the link; the host is asked
  const friend = await open(DESK, { ...BOOK, fighters: [BOOK.fighters[1], BOOK.fighters[0]], p1: "g2", p2: "g1" });
  const url = await host.getByTestId("share-url").evaluate((e) => e.value ?? e.textContent);
  await friend.goto(url.startsWith("http") ? url : `${BASE}/online?room=${code}`, { waitUntil: "networkidle" });
  const join = friend.getByTestId("join-room");
  if (await join.isVisible().catch(() => false)) await join.click();
  await host.getByTestId("accept-prompt").waitFor({ timeout: 30000 });
  await host.waitForTimeout(300);
  const items = [
    { sel: '[data-testid="room-code"]', label: "the room code", dx: touch ? -20 : -180, dy: touch ? 52 : 0 },
    { sel: '[data-testid="accept-join"]', label: "Accept: fight!", dx: touch ? -60 : -150, dy: touch ? 45 : 50 },
    { sel: '[data-testid="decline-join"]', label: "Decline", dx: touch ? 50 : 120, dy: touch ? 45 : 50 },
    { sel: ".ask-thumb", label: "your friend's drawing", dx: touch ? 140 : 190, dy: touch ? -80 : -60 },
  ];
  const copyIdx = await host.$$eval("button", (bs) => bs.filter((x) => x.offsetParent).map((x) => x.textContent.trim()));
  const ci = copyIdx.findIndex((t) => t === "Copy" || t === "Copy code");
  const li = copyIdx.findIndex((t) => /Copy link/.test(t));
  if (ci >= 0) items.push({ sel: "button:not([disabled])", nth: ci, label: "Copy (the code)", dx: touch ? -60 : -110, dy: touch ? -45 : -45 });
  if (li >= 0) items.push({ sel: "button:not([disabled])", nth: li, label: "Copy link", dx: touch ? 60 : 110, dy: touch ? -45 : -45 });
  // nth is counted over visible buttons: map to all buttons
  for (const it of items) {
    if (it.sel !== "button:not([disabled])") continue;
    const want = copyIdx[it.nth];
    it.nth = await host.$$eval("button:not([disabled])", (bs, w) => bs.findIndex((x) => x.offsetParent && x.textContent.trim() === w), want);
  }
  await host.getByTestId("accept-prompt").scrollIntoViewIfNeeded();
  await callouts(host, items);
  await save(host, `${mode}-room`, touch ? null : await unionClip(host, [".lobby", "#nf-callouts div"], 10), touch ? 600 : 900);
  await host.context().close();
  await friend.context().close();
}

// ---------------------------------------------------------------- 6 nearby (QR)
for (const [mode, opts] of [["touch", PHONE], ["keys", DESK]]) {
  if (!want("nearby")) break;
  const touch = mode === "touch";
  const p = await open(opts);
  await p.goto(`${BASE}/nearby`, { waitUntil: "networkidle" });
  await p.getByTestId("nearby-create").click();
  await p.getByTestId("offer-qr").waitFor({ timeout: 30000 });
  await p.waitForTimeout(500);
  await p.getByTestId("offer-qr").evaluate((e) => e.scrollIntoView({ block: innerWidth < 600 ? "start" : "center" }));
  await p.waitForTimeout(200);
  const copyCode = await p.$$eval("button", (bs) => bs.findIndex((x) => x.offsetParent && /^Copy code/.test(x.textContent.trim())));
  const items = [
    { sel: '[data-testid="offer-qr"]', label: "your friend scans this", dx: touch ? 0 : 260, dy: touch ? -150 : -60 },
    { sel: '[data-testid="scan-answer"]', label: "then scan their QR back", dx: touch ? 40 : 240, dy: touch ? 48 : 0 },
    { sel: '[data-testid="offer-code"]', label: "no camera? send this code", dx: touch ? -10 : -260, dy: touch ? -60 : 0 },
  ];
  if (copyCode >= 0) items.push({ sel: "button", nth: copyCode, label: "Copy code", dx: touch ? 120 : 140, dy: touch ? 0 : 0 });
  items.push({ sel: '[data-testid="paste-go"]', label: "or paste theirs + Connect", dx: touch ? -70 : 230, dy: touch ? 48 : 0 });
  await callouts(p, items);
  await save(p, `${mode}-nearby`, touch ? null : await unionClip(p, ['[data-testid="offer-qr"]', '[data-testid="scan-answer"]', "#nf-callouts div"], 14), touch ? 600 : 900);
  await p.context().close();
}

// ---------------------------------------------------------------- 7 controls
{
  if (want("controls")) {
    // touch: iPhone in landscape, every button
    const p = await open(PHONE_LAND);
    await p.goto(`${BASE}/play?rival=boxer&countdown=0&ai=off`, { waitUntil: "networkidle" });
    await p.waitForFunction(() => window.__nf?.sim && window.__nf.view, null, { timeout: 30000 });
    await p.evaluate(() => {
      window.__nf.paused = true;
      window.__nf.advance(30, { x: 1 });
    });
    await p.waitForTimeout(250);
    await callouts(p, [
      { sel: '[data-testid="tp-stick"]', label: "joystick: walk · up = jump · down = crouch", dx: 120, dy: -95, font: 13 },
      { sel: '[data-testid="tp-punch"]', label: "punch", dx: -10, dy: -80, font: 13 },
      { sel: '[data-testid="tp-kick"]', label: "kick", dx: -10, dy: -115, font: 13 },
      { sel: '[data-testid="tp-jump"]', label: "jump", dx: 0, dy: -80, font: 13 },
      { sel: '[data-testid="tp-block"]', label: "block", dx: 0, dy: -115, font: 13 },
      { sel: '[data-testid="tp-crouch"]', label: "crouch", dx: 0, dy: -80, font: 13 },
      { sel: '[data-testid="tp-special"]', label: "★ special", dx: -20, dy: -115, font: 13 },
      { sel: '[data-testid="guide-open"]', label: "? this guide", dx: 70, dy: 45, font: 13 },
      { sel: '[data-testid="menu"]', label: "☰ sound, clip…", dx: 20, dy: 80, font: 13 },
    ]);
    await save(p, "touch-controls", null, 760);
    await p.context().close();
    // keyboard: every key on the legend
    const d = await open(DESK);
    await d.goto(`${BASE}/play?rival=boxer&countdown=0&ai=off`, { waitUntil: "networkidle" });
    await d.waitForFunction(() => window.__nf?.sim && window.__nf.view, null, { timeout: 30000 });
    await d.evaluate(() => {
      window.__nf.paused = true;
      window.__nf.advance(30, { x: 1 });
    });
    await d.waitForTimeout(250);
    const L = '[data-testid="keys-legend"] kbd';
    const names = ["walk left", "walk right", "punch", "kick", "jump", "block", "crouch", "special", "restart"];
    const items = names.map((label, i) => ({ sel: L, nth: i, label, dx: i % 2 ? 10 : -10, dy: i % 2 ? -105 : -55, pad: 2, font: 17 }));
    await callouts(d, items);
    await save(d, "keys-controls", { x: 0, y: 420, width: 820, height: 380 }, 820);
    await d.context().close();
  }
}

// ---------------------------------------------------------------- 8 HUD (+ rotate on a phone held upright)
for (const [mode, opts] of [["touch", PHONE], ["keys", DESK]]) {
  if (!want("hud")) break;
  const touch = mode === "touch";
  const p = await open(opts, { ...BOOK, fighters: [{ id: "g1", strokes: [...S("clean"), ...flame] }, BOOK.fighters[1]] });
  await p.goto(`${BASE}/play?rival=karate&countdown=0&ai=off`, { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim && window.__nf.view, null, { timeout: 30000 });
  await p.evaluate(() => {
    const nf = window.__nf;
    nf.paused = true;
    nf.sim.fighters[1].hp *= 0.55;
    nf.sim.fighters[0].hp *= 0.8;
    nf.advance(60, { x: 1 });
    nf.advance(1, { special: true });
    nf.advance(12);
  });
  await p.waitForTimeout(300);
  const items = touch
    ? [
        { sel: ".bars > div", nth: 0, label: "your HP", dx: 60, dy: -3, pad: 2 },
        { sel: '[data-testid="meter-0"]', label: "special bar: ★ when it's full", dx: 120, dy: 0, pad: 1 },
        { sel: ".bars > div", nth: 1, label: "the rival's HP", dx: -20, dy: -8, pad: 2 },
        { sel: ".round-row .levels", label: "level", dx: -60, dy: 26 },
        { sel: ".card-toggle", label: "Fighter card: why your numbers", dx: 70, dy: 26 },
        { sel: '[data-testid="rotate"]', label: "⟳ play sideways", dx: 76, dy: 0 },
        { sel: '[data-testid="guide-open"]', label: "? this guide (pauses)", dx: 0, dy: 42 },
        { sel: '[data-testid="menu"]', label: "☰ sound, clip, tuners", dx: 0, dy: 44 },
      ]
    : [
        { sel: ".bars > div", nth: 0, label: "your HP", dx: -230, dy: -5 },
        { sel: '[data-testid="meter-0"]', label: "special bar: E when it says ready", dx: -290, dy: 25 },
        { sel: ".bars > div", nth: 1, label: "rival's HP and special", dx: -260, dy: 10 },
        { sel: '[data-testid="round"]', label: "round · score · best of 3", dx: -250, dy: 40 },
        { sel: ".round-row .levels", label: "level", dx: 0, dy: 50 },
        { sel: ".card-toggle", label: "Fighter card: why your numbers", dx: 40, dy: 75 },
        { sel: '[data-testid="guide-open"]', label: "? this guide (pauses)", dx: 90, dy: 55 },
        { sel: ".fx-buttons", label: "sound · renderer · K.O. physics · save a clip", dx: 60, dy: 100 },
        { sel: ".tune-toggle", label: "Tuners: game feel", dx: -20, dy: 100 },
      ];
  await callouts(p, items, touch ? { x: 40, y: 135, w: 300, font: 15 } : null);
  await save(p, `${mode}-hud`, touch ? { x: 0, y: 0, width: 390, height: 318 } : { x: 0, y: 0, width: 1280, height: 330 }, touch ? 560 : 960);
  await p.context().close();
}
await b.close();
