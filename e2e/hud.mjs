// Phones: the fight HUD (both health bars, power meters, "Round 1 · 0–0 · best of 3") never touches the
// Easy / Normal / Hard chips, the "Fighter card" button, ☰ or ⟳ Rotate. Landscape 667×375, 844×390, 740×360,
// the upright phones (360×740, 390×844) and the CSS-rotated iPhone view (Rotate on iOS). Screenshots into OUT.
import { chromium } from "playwright";
import fs from "node:fs";
const OUT = process.env.OUT || new URL("./shots/hud", import.meta.url).pathname;
const BASE = process.env.BASE || "http://localhost:3100";
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => { console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) bad++; };
// [name, w, h, rotate?]
const VIEWS = [["667x375", 667, 375], ["844x390", 844, 390], ["740x360", 740, 360], ["360x740", 360, 740], ["390x844", 390, 844], ["390x844-rotated", 390, 844, true], ["375x667-rotated", 375, 667, true]];
const RIVALS = (process.env.RIVALS || "hulk,halloween").split(",");
for (const [name, w, h, rot] of VIEWS) for (const rival of RIVALS) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.addInitScript((strokes) => { localStorage.setItem("nf:fighter", JSON.stringify(strokes)); localStorage.setItem("nf:guide-seen", "1"); }, SET[0].strokes);
  await p.goto(`${BASE}/play?countdown=0&rival=${rival}&level=normal`, { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  if (rot) {
    // no orientation lock in this browser: Rotate falls back to the CSS-turned view, as on iOS
    await p.evaluate(() => { try { delete screen.orientation.lock; Object.defineProperty(screen.orientation, "lock", { value: undefined, configurable: true }); } catch {} });
    await p.getByTestId("rotate").click();
    await p.waitForTimeout(2600); // the "turn sideways" hint fades
  }
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => {
    const vis = (e) => { if (!e) return false; const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
    const box = (e, label) => { const b = e.getBoundingClientRect(); return { label, l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const all = (s, label) => [...document.querySelectorAll(s)].filter(vis).map((e, i) => box(e, `${label}${i ? i : ""}`));
    // the round text: measure the text itself (the span may stretch)
    const rs = document.querySelector('[data-testid="round"]');
    let round = [];
    if (vis(rs)) { const rg = document.createRange(); rg.selectNodeContents(rs); const b = rg.getBoundingClientRect(); round = [{ label: "round text", l: b.left, t: b.top, r: b.right, b: b.bottom }]; }
    const hud = [...all(".bars > div:not(.round-row) .bar-label", "bar label"), ...all(".bars > div:not(.round-row) .track", "health bar"), ...all(".bars > div:not(.round-row) .meter", "meter"), ...round];
    const ctl = [...all(".round-row .levels button", "level chip"), ...all(".card-toggle", "Fighter card"), ...all(".menu-toggle", "☰"), ...all(".rotate-btn", "Rotate"), ...all(".guide-btn, .fight-guide", "?")];
    return { hud, ctl, fit: document.documentElement.dataset.fit, rotated: document.documentElement.dataset.rotated || "" };
  });
  const hit = (a, c) => Math.min(a.r, c.r) - Math.max(a.l, c.l) > 0.5 && Math.min(a.b, c.b) - Math.max(a.t, c.t) > 0.5;
  const overl = [];
  for (const a of r.hud) for (const c of r.ctl) if (hit(a, c)) overl.push(`${c.label} × ${a.label}`);
  for (let i = 0; i < r.ctl.length; i++) for (let j = i + 1; j < r.ctl.length; j++) if (hit(r.ctl[i], r.ctl[j])) overl.push(`${r.ctl[i].label} × ${r.ctl[j].label}`);
  const has = (re) => r.ctl.some((c) => re.test(c.label));
  await p.screenshot({ path: `${OUT}/${name}_${rival}.png` });
  check(r.hud.length >= 5 && has(/level chip/) && has(/Fighter card/), `${name} vs ${rival} (${r.fit}${r.rotated ? ", rotated" : ""}): HUD ${r.hud.length} boxes, controls ${r.ctl.map((c) => c.label).join(", ")}`);
  check(overl.length === 0, `${name} vs ${rival}: HUD and buttons don't overlap${overl.length ? ": " + overl.join("; ") : ""}`);
  check(errs.length === 0, `${name} vs ${rival}: no page errors ${errs.slice(0, 2).join(" | ")}`);
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} FAIL` : "HUD OK");
process.exit(bad ? 1 : 0);
