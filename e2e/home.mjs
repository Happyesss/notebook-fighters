// The notebook page (home), on desktop, phones and tablets:
//  1) the three ways to play sit top right beside "Draw your fighter" (Play with computer, 2 players,
//     Create a room), no "2P: both players draw first" hint; three tiles: two drawing boxes and a "+";
//     expand + clear inside each box, top right;
//  2) "Create a room" with an empty fighter asks you to draw first (the box is highlighted, nothing
//     navigates); once drawn it goes on to the online lobby with the room code;
//  3) "+" adds a page; the drawings (with colours) and which one you play with survive a reload;
//     a fighter can be deleted;
//  4) "Play with computer": draw-first via the big pad, then the rival picker (drawings, stats, level)
//     → the fight is against that rival on that level;
//  5) the rivals at the bottom open a character card with the fight's real numbers; Esc closes it;
//     "Fight this rival" goes through the picker with that rival chosen, and the fight has the same HP;
//  6) phones held upright: a Rotate button in the fight turns it sideways (iOS: CSS, no lock) and the
//     joystick follows the turn.
// Expects the site + Worker on BASE (default `pnpm worker:dev` on :8787). Screenshots into OUT.
import { chromium, devices } from "playwright";
import fs from "node:fs";
const BASE = (process.env.BASE || "http://localhost:8787").replace(/\/$/, "");
const OUT = process.env.OUT || new URL("./shots/home", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const DEVICES = (process.env.DEVICES || "Desktop 1280x800,iPhone 13,iPhone 13 landscape,iPad Pro 11,iPad Pro 11 landscape").split(",");
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const slug = (d) => d.replace(/ /g, "_");

async function open(dev) {
  const opts = dev.startsWith("Desktop") ? DESKTOP : devices[dev];
  const ctx = await b.newContext({ ...opts });
  // iPhones: Safari has no screen.orientation.lock (the Rotate button falls back to turning the view)
  if (/iPhone/.test(dev)) await ctx.addInitScript(() => { try { delete ScreenOrientation.prototype.lock; } catch {} });
  await ctx.addInitScript(() => localStorage.setItem("nf:mute", "1"));
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|WebSocket|fonts\.g/.test(m.text()) && errs.push(m.text()));
  await p.goto(BASE + "/", { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForSelector('main[data-loaded="true"]');
  const cdp = opts.hasTouch ? await ctx.newCDPSession(p) : null;
  return { ctx, p, errs, cdp, touch: !!opts.hasTouch, dev };
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
const PENCIL = { "#2a241c": "Pencil", "#c23b32": "Red", "#1d4f89": "Blue", "#2f7d4a": "Green", "#6d4ca8": "Purple", "#c4962c": "Gold", "#e07a2f": "Orange", "#d45d8c": "Pink" };
/** the box's position once any (smooth) scrolling has stopped */
async function settled(loc) {
  let a = await loc.boundingBox();
  for (let i = 0; i < 30; i++) {
    await loc.page().waitForTimeout(60);
    const b = await loc.boundingBox();
    if (Math.abs(b.y - a.y) < 0.5 && Math.abs(b.x - a.x) < 0.5) return b;
    a = b;
  }
  return a;
}
/** draws a test drawing into a box, picking each stroke's coloured pencil first */
async function drawIn(t, testid, name) {
  const loc = t.p.getByTestId(testid);
  await loc.scrollIntoViewIfNeeded();
  await t.p.waitForTimeout(150);
  let pen = "";
  for (const s of SET.find((d) => d.name === name).strokes) {
    const want = PENCIL[s.color] ?? "Pencil";
    if (want !== pen) {
      const btn = t.p.locator(`.pencils button[aria-label="${want}"]`);
      for (let i = 0; i < 3 && (await btn.getAttribute("aria-pressed")) !== "true"; i++) await (t.touch ? btn.tap() : btn.click());
      pen = want;
      // (tapping a pencil can scroll the page up to the colour row: bring the box back before drawing)
      await loc.scrollIntoViewIfNeeded();
    }
    const r = await settled(loc);
    await drag(t, s.points.map((q) => [r.x + q.x * r.width, r.y + q.y * r.height]));
  }
  await t.p.waitForTimeout(150);
}
const tap = (t, id) => (t.touch ? t.p.getByTestId(id).tap() : t.p.getByTestId(id).click());
/** (Chromium's touch emulation sometimes swallows the first tap after scripted drawing gestures; tap again) */
async function tapUntil(t, id, done, n = 4) {
  for (let i = 0; i < n; i++) {
    await t.p.getByTestId(id).scrollIntoViewIfNeeded().catch(() => {});
    await tap(t, id);
    // (a slow network delays client-side navigation: wait while the tapped control is gone or the page is changing)
    for (let k = 0; k < 100; k++) {
      await t.p.waitForTimeout(120);
      if (await done()) return i + 1;
      if (k >= 8 && (await t.p.getByTestId(id).count().catch(() => 0)) > 0) break;
    }
  }
  return 0;
}
const sel = (p) => p.evaluate(() => { const e = document.querySelector('[data-testid="sel"]'); return { n: Number(e.dataset.n), p1: Number(e.dataset.p1), p2: Number(e.dataset.p2) }; });
const box = (p, id) => p.getByTestId(id).boundingBox();
/** the drawing box's frame (the canvas sits inside its border), comparable with the "+" tile */
const frame = (p, i) => p.locator(`[data-testid="tile-${i}"] .slot`).boundingBox();
const scrollY = (p) => p.evaluate(() => window.scrollY);

for (const dev of DEVICES) {
  const t = await open(dev);
  const { p, errs } = t;
  const phonePortrait = dev === "iPhone 13";
  const vp = p.viewportSize();
  // 1) layout
  const [h1, nav, cpu, two, room, s0, s1, add] = await Promise.all([p.locator("h1").boundingBox(), p.locator(".home-nav").boundingBox(), box(p, "fight-cpu"), box(p, "duel-2p"), box(p, "home-room"), box(p, "slot-0"), box(p, "slot-1"), box(p, "add-fighter")]);
  const labels = await Promise.all(["fight-cpu", "duel-2p", "home-room"].map((id) => p.getByTestId(id).innerText()));
  const btnsAbove = [cpu, two, room].every((r) => r.y + r.height <= s0.y);
  const rightSide = phonePortrait ? nav.x + nav.width >= vp.width * 0.9 : nav.x + nav.width >= vp.width * 0.7 && nav.x >= h1.x + h1.width * 0.5;
  const hint = await p.evaluate(() => /both players draw first/i.test(document.body.innerText));
  check(btnsAbove && rightSide && !hint && labels.join("|") === "Play with computer|2 players|Create a room", `${dev}: top-right buttons [${labels.join(" | ")}] beside the heading (nav right edge ${Math.round(nav.x + nav.width)}/${vp.width}); no "both players draw first" hint`);
  const same = (a, c) => Math.abs(a.width - c.width) <= 2 && Math.abs(a.height - c.height) <= 2;
  const [f0, f1] = [await frame(p, 0), await frame(p, 1)];
  check(same(s0, s1) && same(f0, add) && same(f1, add) && Math.abs(f0.y - add.y) <= 2 === !phonePortrait, `${dev}: three tiles the same size: two boxes + "+" (${Math.round(f0.width)}×${Math.round(f0.height)}, + ${Math.round(add.width)}×${Math.round(add.height)}${phonePortrait ? ", + on the next row" : ", one row"})`);
  const inside = await p.evaluate(() => [0, 1].every((i) => {
    const bx = document.querySelector(`[data-testid="slot-${i}"]`).getBoundingClientRect();
    return [`expand-${i}`, `clear-${i}`].every((id) => {
      const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
      return r.left >= bx.left + bx.width * 0.5 && r.right <= bx.right + 0.5 && r.top >= bx.top - 0.5 && r.bottom <= bx.top + bx.height * 0.16;
    });
  }));
  check(inside, `${dev}: expand + clear inside each box, top right`);
  await p.screenshot({ path: `${OUT}/home_${slug(dev)}.png` });

  // 2) Create a room with nothing drawn → draw first
  await tap(t, "home-room");
  await p.getByTestId("draw-first").waitFor({ timeout: 5000 });
  const hi = await p.evaluate(() => document.querySelector('[data-testid="tile-0"]').classList.contains("needs-ink"));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/draw_first_${slug(dev)}.png` });
  check(hi && new URL(p.url()).pathname === "/", `${dev}: "Create a room" with an empty fighter → "${(await p.getByTestId("draw-first").innerText()).split("\n")[0]}", box 1 highlighted, still on the notebook`);
  // the tools inside the box catch no strokes: a stroke started on "clear" doesn't draw or scroll
  const y0 = await scrollY(p);
  const cb = await box(p, "clear-0");
  await drag(t, [[cb.x + cb.width / 2, cb.y + cb.height / 2], [cb.x + cb.width / 2, cb.y + cb.height / 2 + 40], [cb.x, cb.y + 90]]);
  const after = await p.evaluate(() => JSON.parse(localStorage.getItem("nf:fighters") || "null"));
  check((await scrollY(p)) === y0 && !(after?.fighters?.[0]?.strokes?.length), `${dev}: a drag that starts on the box's "clear" draws nothing and doesn't scroll`);
  await drawIn(t, "slot-0", "clean");
  const y1 = await scrollY(p);
  await tapUntil(t, "draw-first-go", async () => /\/online/.test(p.url()));
  await p.waitForURL(/\/online/, { timeout: 15000 });
  await p.getByTestId("room-code").waitFor({ timeout: 30000 });
  const code = await p.getByTestId("room-code").innerText();
  check(/^[A-Z2-9]{6}$/.test(code) && (await p.getByTestId("copy-code").count()) === 1, `${dev}: drawn → "Create the room" → online lobby, room ${code} with Copy`);
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.waitForSelector('main[data-loaded="true"]');

  // 3) + adds a page; the book survives a reload
  await tapUntil(t, "add-fighter", async () => (await sel(p)).n === 3);
  await p.waitForTimeout(500);
  const s3 = await sel(p);
  const b2 = await frame(p, 2);
  check(s3.n === 3 && s3.p1 === 2 && same(b2, f0), `${dev}: "+" adds box 3 (same size) and selects it to play with`);
  await p.screenshot({ path: `${OUT}/plus_added_${slug(dev)}.png` });
  await p.locator('[data-testid="tile-2"]').scrollIntoViewIfNeeded();
  await drawIn(t, "slot-2", "power_fire");
  await tapUntil(t, "pick-p2-0", async () => (await sel(p)).p2 === 0);
  await p.reload({ waitUntil: "networkidle" });
  await p.waitForSelector('main[data-loaded="true"]');
  const s4 = await sel(p);
  const stored = await p.evaluate(() => ({ book: JSON.parse(localStorage.getItem("nf:fighters")), mine: JSON.parse(localStorage.getItem("nf:fighter") || "[]") }));
  const fire = SET.find((d) => d.name === "power_fire").strokes;
  const colours = [...new Set(stored.book.fighters[2].strokes.map((s) => s.color))];
  const stats2 = await p.getByTestId("slot-stats-2").innerText().catch(() => "");
  check(s4.n === 3 && s4.p1 === 2 && s4.p2 === 0 && stored.book.fighters[2].strokes.length === fire.length && stored.mine.length === fire.length && colours.length >= 2 && /HP/.test(stats2),
    `${dev}: after a reload: 3 fighters, playing box 3 (${stored.book.fighters[2].strokes.length} strokes, colours ${colours.join(" ")}), P2 box 1; box 3 read "${stats2.split("\n")[0]}"`);
  // delete box 2 (two taps: "delete?" then delete)
  await tapUntil(t, "delete-1", async () => (await p.getByTestId("delete-1").getAttribute("data-sure")) === "true");
  await tapUntil(t, "delete-1", async () => (await sel(p)).n === 2);
  const s5 = await sel(p);
  check(s5.n === 2 && s5.p1 === 1 && s5.p2 === 0, `${dev}: deleted box 2 → 2 fighters left, still playing the fire drawing (now box 2)`);

  // 4) Play with computer: select the empty-again… no: select box 1 (drawn), open the picker, choose, fight
  if (!dev.startsWith("Desktop")) {
    await tapUntil(t, "fight-cpu", async () => (await p.getByTestId("rival-picker").count()) > 0);
  } else {
    // desktop: an empty fighter selected → draw first with the big pad → the picker opens by itself
    await tapUntil(t, "add-fighter", async () => (await sel(p)).n === 3);
    await tap(t, "fight-cpu");
    await p.getByTestId("draw-first").waitFor();
    const noPicker = (await p.getByTestId("rival-picker").count()) === 0;
    await tap(t, "draw-first-big");
    await p.getByTestId("sketch-canvas").waitFor();
    const pad = await box(p, "sketch-canvas");
    for (const s of SET.find((d) => d.name === "swordsman").strokes) await drag(t, s.points.map((q) => [pad.x + q.x * pad.width, pad.y + q.y * pad.height]));
    await tap(t, "sketch-done");
    await p.getByTestId("rival-picker").waitFor({ timeout: 5000 });
    check(noPicker, `${dev}: "Play with computer" with an empty fighter → draw first; drawn on the big pad → Done → the rival picker opens`);
  }
  const pickN = await p.locator('[data-testid="rival-picker"] .pick-card').count();
  const thumbs = await p.locator('[data-testid="rival-picker"] canvas.rival-thumb').count();
  await tapUntil(t, "pick-level-hard", async () => (await p.getByTestId("pick-level-hard").getAttribute("aria-pressed")) === "true");
  await tapUntil(t, "pick-ninja", async () => (await p.getByTestId("pick-ninja").getAttribute("aria-checked")) === "true");
  const ninjaStats = await p.getByTestId("pick-ninja").innerText();
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/rival_picker_${slug(dev)}.png` });
  const fightLabel = await p.getByTestId("pick-fight").innerText();
  await tap(t, "pick-fight");
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 60000 });
  const fight = await p.evaluate(() => ({ rival: window.__nf.sim.rivalEntry?.id, level: window.__nf.sim.difficulty, hp: window.__nf.sim.fighters[1].stats.hp }));
  const shownHp = Number(/HP (\d+)/.exec(ninjaStats)?.[1]);
  check(pickN === 9 && thumbs === 8 && fight.rival === "ninja" && fight.level === "hard" && shownHp === fight.hp, `${dev}: picker (${pickN} choices, ${thumbs} drawings) → "${fightLabel}" → fighting ${fight.rival} on ${fight.level}; HP on the card ${shownHp} = in the fight ${fight.hp}`);

  // 6) Rotate on an upright phone
  const rotVisible = await p.getByTestId("rotate").isVisible();
  if (phonePortrait) {
    await p.waitForFunction(() => window.__nf.sim.curr.countdown <= 0, null, { timeout: 20000 });
    await tap(t, "rotate");
    await p.waitForTimeout(600);
    const rot = await p.evaluate(() => ({ r: document.documentElement.dataset.rotated, fit: document.documentElement.dataset.fit, mode: document.querySelector('[data-testid="rotate"]').dataset.mode, box: document.querySelector(".stage").getBoundingClientRect().toJSON(), w: document.querySelector(".canvas-host").clientWidth, h: document.querySelector(".canvas-host").clientHeight, cw: window.__nf.view?.canvas?.width, ch: window.__nf.view?.canvas?.height }));
    const hint = await p.getByTestId("rotate-hint").innerText().catch(() => "");
    await p.screenshot({ path: `${OUT}/rotate_${slug(dev)}.png` });
    // the joystick in the turned view: dragging toward the screen's bottom is "right" in the game
    const st = await box(p, "tp-stick");
    const cx = st.x + st.width / 2, cy = st.y + st.height / 2;
    const x0 = await p.evaluate(() => window.__nf.sim.fighters[0].x);
    await touchEv(t.cdp, "touchStart", [[cx, cy]]);
    await touchEv(t.cdp, "touchMove", [[cx, cy + st.height * 0.45]]);
    await p.waitForTimeout(150);
    const held = await p.evaluate(() => [...(window.__nf.keys?.current ?? window.__nf.keys ?? [])]);
    // (a hard rival may hit you back mid-walk, so read the walking speed while held, not just the distance)
    let vx = 0;
    for (let i = 0; i < 6; i++) { vx = Math.max(vx, await p.evaluate(() => window.__nf.sim.fighters[0].vx)); await p.waitForTimeout(110); }
    await touchEv(t.cdp, "touchEnd", []);
    const x1 = await p.evaluate(() => window.__nf.sim.fighters[0].x);
    check(rotVisible && rot.r === "1" && rot.mode === "css" && rot.fit === "phone-landscape" && rot.w > rot.h && rot.box.height > rot.box.width && rot.cw > rot.ch && /sideways/i.test(hint),
      `${dev}: Rotate (no lock on iOS) → the fight turns sideways: arena ${rot.w}×${rot.h} (canvas ${rot.cw}×${rot.ch}) on the ${Math.round(rot.box.width)}×${Math.round(rot.box.height)} upright screen, hint "${hint}"`);
    check(held.includes("d") && !held.includes("a") && vx > 0.5, `${dev}: rotated joystick: a drag toward the screen's bottom walks right (keys ${JSON.stringify(held)}, walking speed ${vx.toFixed(2)}, x ${x0.toFixed(2)} → ${x1.toFixed(2)})`);
    await tap(t, "rotate");
    await p.waitForTimeout(300);
    check((await p.evaluate(() => document.documentElement.dataset.rotated)) === undefined, `${dev}: "Portrait" turns it back`);
  } else {
    check(!rotVisible, `${dev}: no Rotate button (${t.touch ? "landscape or tablet" : "desktop"})`);
  }

  // 5) character card from the rivals at the bottom
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.waitForSelector('main[data-loaded="true"]');
  await p.getByTestId("rival-bodybuilder").scrollIntoViewIfNeeded();
  await tapUntil(t, "rival-bodybuilder", async () => (await p.getByTestId("char-card").count()) > 0);
  const cc = await p.evaluate(() => ({
    name: document.querySelector('[data-testid="char-name"]').textContent,
    hp: Number(document.querySelector('[data-testid="cc-hp"] .stat-num').textContent),
    special: document.querySelector('[data-testid="cc-special"]').textContent,
    moves: document.querySelectorAll('[data-testid="cc-moves"] li').length,
    rows: document.querySelectorAll(".cc-stats .stat-row").length,
    focus: document.activeElement?.getAttribute("data-testid"),
  }));
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT}/character_card_${slug(dev)}.png` });
  check(cc.name === "Bodybuilder" && cc.hp > 50 && cc.rows >= 7 && cc.moves >= 3 && /special|none|★/i.test(cc.special), `${dev}: Bodybuilder's card: HP ${cc.hp}, ${cc.rows} stat rows, ${cc.moves} moves, special "${cc.special.trim().slice(0, 50)}"`);
  if (!t.touch) {
    await p.keyboard.press("Escape");
    await p.waitForTimeout(150);
    const gone = (await p.getByTestId("char-card").count()) === 0;
    const back = await p.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    check(gone && back === "rival-bodybuilder" && cc.focus === "card-fight", `${dev}: keyboard: the card opens with focus on "Fight this rival", Esc closes it, focus back on the rival (${back})`);
    await p.getByTestId("rival-bodybuilder").focus();
    await p.keyboard.press("Enter");
    await p.getByTestId("char-card").waitFor();
  }
  await tap(t, "card-fight");
  await p.getByTestId("rival-picker").waitFor({ timeout: 5000 });
  const pre = await p.getByTestId("pick-bodybuilder").getAttribute("aria-checked");
  await tap(t, "pick-fight");
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 60000 });
  const f2 = await p.evaluate(() => ({ rival: window.__nf.sim.rivalEntry?.id, hp: window.__nf.sim.fighters[1].stats.hp, level: window.__nf.sim.difficulty }));
  check(pre === "true" && f2.rival === "bodybuilder" && f2.hp === cc.hp, `${dev}: "Fight this rival" → picker with the Bodybuilder chosen → the fight's Bodybuilder has HP ${f2.hp} on ${f2.level} (card said ${cc.hp})`);
  check(errs.length === 0, `${dev}: no page errors ${errs.slice(0, 2).join(" | ")}`);
  await t.ctx.close();
}
await b.close();
console.log(bad ? `${bad} FAIL` : "HOME OK");
process.exit(bad ? 1 : 0);
