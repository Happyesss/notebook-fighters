// How to play: the desktop gets the keyboard guide, iPhone and iPad the touch guide; it opens by itself
// once on the first visit (and never again), pages with Next / Back, ← → keys and swipes, Esc closes,
// the "?" in a fight opens it on the controls page and pauses the fight, and its pictures come from
// the service worker's cache offline. Screenshots into OUT.
import { chromium, devices } from "playwright";
import fs from "node:fs";
const BASE = (process.env.BASE || "http://localhost:8797").replace(/\/$/, "");
const OUT = process.env.OUT || new URL("./shots/guide", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const errs = [];
const PAGES = ["draw", "ink", "cpu", "duo", "room", "nearby", "controls", "hud"];
async function ctxFor(opts) {
  const ctx = await b.newContext(opts);
  // opt in to the first-visit guide (automated browsers skip it otherwise)
  await ctx.addInitScript(() => localStorage.setItem("nf:guide-auto", "1"));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e)));
  return { ctx, p };
}
const state = (p) =>
  p.evaluate(() => {
    const g = document.querySelector('[data-testid="guide-page"]');
    const img = document.querySelector('[data-testid="guide-img"]');
    const dlg = document.querySelector('[data-testid="guide"]');
    return g ? { page: g.dataset.page, mode: g.dataset.mode, src: img?.getAttribute("src"), loaded: !!img && img.complete && img.naturalWidth > 0, overflow: dlg.scrollWidth > dlg.clientWidth + 1, docOverflow: document.documentElement.scrollWidth > innerWidth + 1, text: g.innerText } : null;
  });
const imgReady = (p) => p.waitForFunction(() => {
  const i = document.querySelector('[data-testid="guide-img"]');
  return i && i.complete && i.naturalWidth > 0;
}, null, { timeout: 15000 }).catch(() => null);

for (const [tag, opts, mode] of [
  ["desktop", { viewport: { width: 1280, height: 800 } }, "keys"],
  ["iphone13", devices["iPhone 13"], "touch"],
  ["ipad", devices["iPad Pro 11"], "touch"],
  ["phone360", { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "touch"],
]) {
  const { ctx, p } = await ctxFor(opts);
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.getByTestId("guide").waitFor({ timeout: 10000 }).catch(() => null);
  await imgReady(p);
  let s = await state(p);
  check(s?.page === "draw" && s.mode === mode && s.loaded && s.src === `/guide/${mode}-draw.webp`, `${tag}: first visit opens the ${mode === "keys" ? "keyboard" : "touch"} guide by itself (${JSON.stringify(s && { page: s.page, mode: s.mode, src: s.src, loaded: s.loaded })})`);
  await p.screenshot({ path: `${OUT}/${tag}_1_draw.png` });
  // every page, forward (Next on touch, → on desktop), each picture loads, nothing scrolls sideways
  const seen = [];
  let allOk = true;
  for (let k = 0; k < PAGES.length; k++) {
    s = await state(p);
    seen.push(s.page);
    if (!s.loaded || s.overflow || s.docOverflow) allOk = false;
    if (s.page === "controls") {
      const want = mode === "keys" ? ["F punch", "G kick", "Space", "H block", "S crouch", "E special", "R restarts", "Gamepad"] : ["Joystick", "Punch", "Kick", "Jump", "Block", "Crouch", "★", "Rotate"];
      const miss = want.filter((w) => !s.text.replace(/\s+/g, " ").includes(w));
      check(miss.length === 0, `${tag}: controls page lists ${want.join(", ")}${miss.length ? " — missing " + miss.join(", ") : ""}`);
      await p.screenshot({ path: `${OUT}/${tag}_7_controls.png` });
    }
    if (s.page === "ink") check(/Fireball/.test(s.text) && /Lightning dash/.test(s.text) && /Spike burst/.test(s.text), `${tag}: the powers list comes from the sim`);
    if (s.page === "room" || s.page === "nearby") await p.screenshot({ path: `${OUT}/${tag}_${k + 1}_${s.page}.png` });
    if (k === PAGES.length - 1) break;
    if (mode === "keys") await p.keyboard.press("ArrowRight");
    else if (k % 2) {
      // swipe left on the page
      const box = await p.getByTestId("guide-page").boundingBox();
      await p.getByTestId("guide-page").evaluate((el, [x0, x1, y]) => {
        const ev = (type, x) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: y, isPrimary: true }));
        ev("pointerdown", x0);
        ev("pointermove", (x0 + x1) / 2);
        ev("pointerup", x1);
      }, [box.x + box.width * 0.8, box.x + box.width * 0.2, box.y + 60]);
    } else await p.getByTestId("guide-next").click();
    await p.waitForTimeout(120);
    await imgReady(p);
  }
  check(seen.join(",") === PAGES.join(",") && allOk, `${tag}: ${mode === "keys" ? "→ key" : "Next + swipe"} walks all ${PAGES.length} pages, pictures load, no sideways scroll (${seen.join(" ")})`);
  await p.screenshot({ path: `${OUT}/${tag}_8_hud.png` });
  // back
  if (mode === "keys") await p.keyboard.press("ArrowLeft");
  else await p.getByTestId("guide-back").click();
  s = await state(p);
  check(s.page === "controls", `${tag}: back → ${s.page}`);
  // the nav stays on screen
  const nav = await p.getByTestId("guide-back").boundingBox();
  const vp = p.viewportSize();
  check(nav && nav.y + nav.height <= vp.height && nav.height >= 40, `${tag}: Back / Next stay on screen (${Math.round(nav?.y + nav?.height)} ≤ ${vp.height}, ${Math.round(nav?.height)} px tall)`);
  // Esc closes; a reload doesn't open it again; the ? button does
  await p.keyboard.press("Escape");
  await p.waitForTimeout(150);
  check((await p.getByTestId("guide").count()) === 0, `${tag}: Esc closes it`);
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  check((await p.getByTestId("guide").count()) === 0, `${tag}: second visit: no auto-open`);
  await p.getByTestId("guide-open").click();
  await p.getByTestId("guide").waitFor();
  s = await state(p);
  check(s.page === "draw" && s.mode === mode, `${tag}: "?" on the notebook opens it (${s.page}, ${s.mode})`);
  await p.getByTestId("guide-close").click();
  await p.screenshot({ path: `${OUT}/${tag}_home_button.png` });

  // in a fight: "?" opens on the controls page and pauses it
  await p.goto(`${BASE}/play?rival=kid&countdown=0${mode === "keys" ? "" : ""}`, { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  await p.waitForTimeout(400);
  await p.getByTestId("guide-open").click();
  await p.getByTestId("guide").waitFor();
  await imgReady(p);
  const f0 = await p.evaluate(() => window.__nf.sim.frame);
  await p.waitForTimeout(600);
  const f1 = await p.evaluate(() => ({ frame: window.__nf.sim.frame, paused: window.__nf.paused }));
  s = await state(p);
  check(s.page === "controls" && f1.paused && f1.frame === f0, `${tag}: "?" in a fight opens the controls page and pauses it (frame ${f0} → ${f1.frame})`);
  await p.screenshot({ path: `${OUT}/${tag}_fight_guide.png` });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  const f2 = await p.evaluate(() => ({ frame: window.__nf.sim.frame, paused: window.__nf.paused }));
  check(!f2.paused && f2.frame > f1.frame, `${tag}: closing it resumes the fight (frame ${f1.frame} → ${f2.frame})`);
  await ctx.close();
}

// offline: the pictures are precached by the service worker
{
  const { ctx, p } = await ctxFor(devices["iPhone 13"]);
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForFunction(async () => {
    const keys = await caches.keys();
    for (const k of keys) if (await (await caches.open(k)).match("/guide/touch-hud.webp")) return true;
    return false;
  }, null, { timeout: 30000, polling: 500 }).catch(() => null);
  const cached = await p.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      for (const r of await c.keys()) if (r.url.includes("/guide/")) out.push(new URL(r.url).pathname);
    }
    return out;
  });
  check(cached.length === 16, `the service worker precached ${cached.length} guide pictures`);
  await ctx.setOffline(true);
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.getByTestId("guide-open").click();
  await p.getByTestId("guide").waitFor();
  await p.getByTestId("guide-next").click();
  await imgReady(p);
  const s = await state(p);
  check(s.loaded && s.page === "ink", `offline: the guide opens and its pictures load (${s.src})`);
  await ctx.close();
}
check(errs.length === 0, `no page errors ${errs.slice(0, 3).join(" | ")}`);
await b.close();
console.log(bad ? `${bad} FAIL` : "GUIDE OK");
process.exit(bad ? 1 : 0);
