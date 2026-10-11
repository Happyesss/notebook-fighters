// Phones: the notebook's buttons, chips, colour dots and text are compact (not chunky) yet still tappable,
// the drawing boxes get the space, and the in-fight touch controls stay small. 360 and 390 px wide.
// Screenshots into OUT (home, rival card, fight) per width.
import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.env.OUT || new URL("./shots/compact", import.meta.url).pathname;
const BASE = process.env.BASE || "http://localhost:3100";
const TAG = process.env.TAG || "";
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) bad++; };
const SIZES = [[360, 740], [390, 844]];
for (const [w, h] of SIZES) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.addInitScript((strokes) => { if (!localStorage.getItem("nf:fighters") && !localStorage.getItem("nf:fighter")) localStorage.setItem("nf:fighter", JSON.stringify(strokes)); localStorage.setItem("nf:guide-seen", "1"); }, SET[0].strokes);
  await p.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${w}_home${TAG}.png` });
  const m = await p.evaluate(() => {
    const r = (s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { s, w: b.width, h: b.height, x: b.x, y: b.y, top: b.top, fs: parseFloat(cs.fontSize), text: e.innerText.trim() }; });
    const minFont = Math.min(...[...document.querySelectorAll(".notebook *")].filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize)));
    return { main: r(".home-actions .play-link"), links: r(".home-links .join-link"), guide: r(".kicker-row .guide-btn"), dots: r(".pencils .pencil"), chips: r(".slot-foot button"), h1: r("h1")[0], pitch: r(".pitch")[0], slot: r('[data-testid="slot-0"]')[0], minFont };
  });
  const rnd = (n) => Math.round(n);
  const oneRow = m.main.length === 3 && new Set(m.main.map((e) => rnd(e.y))).size === 1;
  check(oneRow && m.main.every((e) => e.h >= 34 && e.h <= 42 && e.fs <= 16 && e.fs >= 13), `${w}px: the three ways to play in one row, ${m.main.map((e) => `"${e.text}" ${rnd(e.w)}×${rnd(e.h)} ${e.fs}px`).join(", ")}`);
  check(m.links.length === 2 && rnd(m.links[0].y) === rnd(m.links[1].y) && m.links.every((e) => e.text.length > 3 && e.h >= 30 && e.h <= 36 && e.fs <= 15), `${w}px: join / nearby slim, one row: ${m.links.map((e) => `"${e.text}" ${rnd(e.w)}×${rnd(e.h)} ${e.fs}px`).join(", ")}`);
  check(m.guide.every((e) => e.h >= 30 && e.h <= 36), `${w}px: "How to play" pill ${m.guide.map((e) => `${rnd(e.w)}×${rnd(e.h)}`).join(" ")}`);
  check(m.dots.length === 8 && m.dots.every((e) => e.w >= 25 && e.w <= 31), `${w}px: colour dots ${rnd(m.dots[0]?.w)} px`);
  check(m.chips.length > 0 && m.chips.every((e) => e.h >= 28 && e.h <= 33 && e.fs >= 12 && e.fs <= 13.5), `${w}px: chips under the boxes ${[...new Set(m.chips.map((e) => `${rnd(e.h)}px tall ${e.fs}px`))].join(", ")}`);
  check(m.h1.fs >= 32 && m.h1.fs <= 39 && m.pitch.fs >= 13.5 && m.pitch.fs <= 15.5 && m.minFont >= 12, `${w}px: heading ${m.h1.fs}px, intro ${m.pitch.fs}px, smallest text ${m.minFont}px (≥12)`);
  check(m.slot.top < h * 0.62 && m.slot.w >= (w - 60) / 2, `${w}px: drawing box 1 starts at ${rnd(m.slot.top)} px (of ${h}), ${rnd(m.slot.w)}×${rnd(m.slot.h)}`);
  // a rival card
  await p.getByTestId("rival-halloween").scrollIntoViewIfNeeded();
  await p.getByTestId("rival-halloween").click();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/${w}_card${TAG}.png` });
  const cardMin = await p.evaluate(() => Math.min(...[...document.querySelectorAll(".dlg *")].filter((e) => e.offsetParent && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize))));
  check(cardMin >= 12, `${w}px: rival card text ≥12 px (smallest ${cardMin})`);
  // a fight: touch controls
  await p.goto(BASE + "/play?countdown=0&rival=ninja&level=easy", { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/${w}_fight${TAG}.png` });
  const tp = await p.evaluate(() => { const bs = [...document.querySelectorAll(".tp-btn")].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect()); return { n: bs.length, max: Math.max(...bs.map((r) => r.height)), min: Math.min(...bs.map((r) => r.height)) }; });
  check(tp.n >= 4 && tp.max <= 56 && tp.min >= 40, `${w}px: fight touch buttons ${tp.n}, ${Math.round(tp.min)}–${Math.round(tp.max)} px`);
  check(errs.length === 0, `${w}px: no page errors ${errs.slice(0, 2).join(" | ")}`);
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} FAIL` : "COMPACT OK");
process.exit(bad ? 1 : 0);
