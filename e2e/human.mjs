// A scripted "human-like" player: draws a fighter on /, clicks "duel →", then plays /play with the
// real keyboard on Normal. It sees the fight ~0.22–0.35 s late (reaction time), walks in, punches and
// kicks at a human cadence, blocks sometimes when it notices an attack, jumps now and then.
// Records: damage during the countdowns (must be 0), each round's winner and length, screenshots.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";

const ROUNDS = Number(process.env.ROUNDS || 5);
const OUT = process.env.OUT || new URL("./shots/human", import.meta.url).pathname;
const DRAW = process.env.DRAW || "clean";
const SEED = Number(process.env.SEED || 7);
fs.mkdirSync(OUT, { recursive: true });
let rs = SEED;
const rand = () => ((rs = (rs * 48271) % 2147483647) - 1) / 2147483646;
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));

const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
// (the Google Fonts stylesheet can't always be fetched from the box; that network error isn't ours)
p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT/.test(m.text()) && errs.push(m.text()));
const notFound = [];
p.on("response", (r) => r.status() === 404 && notFound.push(r.url()));

// draw on the notebook page like a player, then click "duel →"
await p.goto("http://localhost:3100/", { waitUntil: "networkidle" });
const slot = p.getByTestId("slot-0");
const r0 = await slot.boundingBox();
const pencil = { "#2a241c": "Pencil", "#c23b32": "Red", "#1d4f89": "Blue", "#2f7d4a": "Green", "#6d4ca8": "Purple", "#c4962c": "Gold" };
for (const s of SET.find((d) => d.name === DRAW).strokes) {
  await p.getByRole("button", { name: pencil[s.color] ?? "Pencil", exact: true }).click();
  const pts = s.points.map((q) => [r0.x + q.x * r0.width, r0.y + q.y * r0.height]);
  await p.mouse.move(...pts[0]);
  await p.mouse.down();
  for (const q of pts.slice(1)) await p.mouse.move(...q, { steps: 2 });
  await p.mouse.up();
}
await p.getByRole("button", { name: "Duel with fighter 1" }).click();
await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
await p.waitForTimeout(300);

const state = () =>
  p.evaluate(() => {
    const s = window.__nf.sim;
    const [me, foe] = s.fighters;
    const c = s.curr;
    return {
      t: performance.now() / 1000,
      countdown: c.countdown,
      since: c.sinceStart,
      over: c.over,
      winner: c.winner,
      round: c.round,
      wins: c.wins,
      my: c.playerHp,
      rival: c.bagHp,
      myMax: c.playerMax,
      rivalMax: c.bagMax,
      gap: Math.abs(foe.x - me.x) - me.rig.extent.front - foe.rig.extent.front,
      toward: Math.sign(foe.x - me.x),
      rivalAttacking: foe.anim.busy && !["hit", "hitLow", "blockHit", "idle", "walk", "land", "jumpCrouch"].includes(foe.anim.move),
      banner: document.querySelector("[data-testid=banner]")?.textContent ?? "",
    };
  });

const held = new Set();
async function hold(k, on) {
  if (on && !held.has(k)) { held.add(k); await p.keyboard.down(k); }
  if (!on && held.has(k)) { held.delete(k); await p.keyboard.up(k); }
}
async function releaseAll() { for (const k of [...held]) await hold(k, false); }

const results = [];
let countdownDamage = 0;
let shotCountdown = false;
let shotMid = false;
for (let round = 0; round < ROUNDS; round++) {
  // countdown: nothing may happen; check both HP stay full throughout
  let st = await state();
  while (st.countdown > 0) {
    if (st.myMax - st.my > 0 || st.rivalMax - st.rival > 0) countdownDamage++;
    if (!shotCountdown && st.countdown < 2.3 && st.countdown > 1.2) {
      shotCountdown = true;
      await p.screenshot({ path: `${OUT}/countdown.png` });
    }
    // a human mashes during the countdown too: those inputs must do nothing
    if (rand() < 0.3) await p.keyboard.press("f");
    await p.waitForTimeout(60);
    st = await state();
  }
  const hist = [];
  let next = 0;
  let holdUntil = 0;
  const lag = 0.22 + rand() * 0.13;
  let startT = st.t;
  while (!st.over) {
    hist.push(st);
    const seen = hist.filter((h) => h.t <= st.t - lag).pop() ?? hist[0];
    if (st.t >= holdUntil) await releaseAll();
    if (st.t >= next) {
      next = st.t + 0.22 + rand() * 0.35;
      const r = rand();
      const fwd = seen.toward > 0 ? "d" : "a";
      const back = seen.toward > 0 ? "a" : "d";
      if (seen.rivalAttacking && seen.gap < 0.5 && r < 0.3) { await releaseAll(); await hold("h", true); holdUntil = st.t + 0.35; }
      else if (seen.gap > 0.3) { await hold("h", false); await hold(back, false); await hold(fwd, true); holdUntil = st.t + 0.25 + rand() * 0.3; }
      else if (r < 0.5) await p.keyboard.press("f");
      else if (r < 0.75) await p.keyboard.press("g");
      else if (r < 0.82) await p.keyboard.press(" ");
      else if (r < 0.9) { await hold(fwd, false); await hold(back, true); holdUntil = st.t + 0.2; }
    }
    if (!shotMid && st.my < 0.75 * st.myMax && st.rival < 0.75 * st.rivalMax && st.my > 0.25 * st.myMax && st.rival > 0.25 * st.rivalMax) {
      shotMid = true;
      await p.screenshot({ path: `${OUT}/midfight.png` });
    }
    await p.waitForTimeout(16);
    st = await state();
    if (st.t - startT > 150) break;
  }
  await releaseAll();
  await p.waitForTimeout(1200);
  const end = await state();
  if (round === 0) await p.screenshot({ path: `${OUT}/ko_banner.png` });
  results.push({ round: end.round, winner: end.winner, secs: +end.since.toFixed(1), my: Math.round(end.my), rival: Math.round(end.rival), wins: end.wins.join("-"), banner: end.banner });
  console.log(JSON.stringify(results.at(-1)));
  // next round: R on the keyboard, or a tap on the K.O. banner (both paths get used)
  if (round % 2 === 0) await p.keyboard.press("r");
  else await p.getByTestId("banner").click();
  await p.waitForTimeout(200);
}
const won = results.filter((r) => r.winner === 0).length;
if (errs.length) console.log("ERR", errs.slice(0, 3));
console.log(JSON.stringify({ draw: DRAW, rounds: results.length, won, avgSecs: +(results.reduce((t, r) => t + r.secs, 0) / results.length).toFixed(1), countdownDamage, errors: errs.length, notFound }));
await b.close();
