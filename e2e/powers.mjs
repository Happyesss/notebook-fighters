// Phase 2 check in the browser: for each power drawing, /play shows the special on the card and a
// cooldown meter; the special fires from the E key (real keyboard) and from the Special button,
// lands on the rival, and the meter goes into cooldown. Mid-flight screenshots into OUT.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
const OUT = process.env.OUT || new URL("./shots/p2", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const KINDS = (process.env.KINDS || "fire,water,lightning,ice,wings,shield,spikes").split(",");
const SHOT_AT = { fire: 26, water: 32, ice: 26, lightning: 9, wings: 30, shield: 10, spikes: 8 };
const GAP = { fire: 1.7, water: 1.7, ice: 1.7, lightning: 1.3, wings: 1.6, shield: 1.0, spikes: 0.8 };
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT/.test(m.text()) && errs.push(m.text()));
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
await p.goto("http://localhost:3100/", { waitUntil: "networkidle" });
for (const kind of KINDS) {
  const d = SET.find((x) => x.name === "power_" + kind);
  await p.evaluate((s) => localStorage.setItem("nf:fighter", JSON.stringify(s)), d.strokes);
  // the CPU stands still (ai=off) without a power of its own, so the special is the only thing hitting
  await p.goto("http://localhost:3100/play?ai=off&rivalPower=none" + (process.env.Q ? "&" + process.env.Q : ""), { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  const card = await p.getByTestId("card-power").innerText();
  const reading = await p.getByTestId("reading").innerText();
  check(/★/.test(card) && reading.includes("special"), `${kind}: card "${card}"`);
  // wait for the round-start cooldown; meter says ready
  await p.waitForFunction(() => document.querySelector('[data-testid="meter-0"]').dataset.state === "ready", null, { timeout: 5000 });
  const meter0 = await p.getByTestId("meter-0").innerText();
  // real key press: E
  const hp0 = await p.evaluate(() => window.__nf.sim.curr.bagHp);
  await p.keyboard.press("e");
  await p.waitForTimeout(250);
  const st1 = await p.evaluate(() => document.querySelector('[data-testid="meter-0"]').dataset.state);
  await p.waitForTimeout(1800);
  const hpKey = await p.evaluate(() => window.__nf.sim.curr.bagHp);
  check(st1 === "cooling", `${kind}: "${meter0}" → E pressed → meter ${st1}; rival HP ${hp0.toFixed(0)} → ${hpKey.toFixed(0)}`);
  // scripted: put them at a known gap, fire, stop mid-flight for the screenshot
  await p.evaluate((g) => {
    const n = window.__nf;
    n.paused = true;
    n.sim.reset();
    n.sim.fighters[0].x = -g / 2;
    n.sim.fighters[1].x = g / 2;
    n.sim.fighters[0].cool = 0;
    n.advance(2);
  }, GAP[kind]);
  const before = await p.evaluate(() => window.__nf.sim.curr.bagHp);
  await p.evaluate(() => window.__nf.advance(1, { special: true }));
  await p.evaluate((n) => window.__nf.advance(n), SHOT_AT[kind] - 1);
  await p.screenshot({ path: `${OUT}/special_${kind}.png` });
  await p.evaluate(() => window.__nf.advance(90));
  const after = await p.evaluate(() => window.__nf.sim.curr.bagHp);
  check(after < before - 3, `${kind}: scripted special hits for ${(before - after).toFixed(1)}`);
  // the on-screen Special button works too
  await p.evaluate(() => {
    window.__nf.sim.fighters[0].cool = 0;
    window.__nf.paused = false;
  });
  // the pads show after a touch (a mouse + keyboard desktop shows only the legend)
  await p.evaluate(() => document.querySelector("canvas").dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true })));
  await p.getByTestId("tp-special").click();
  await p.waitForTimeout(150);
  const cool = await p.evaluate(() => window.__nf.sim.fighters[0].cool);
  check(cool > 0, `${kind}: Special button fires (cooldown ${cool.toFixed(1)}s)`);
}
// counters: fire vs a water rival, both throw: water douses the fireball
{
  const d = SET.find((x) => x.name === "power_fire");
  await p.evaluate((s) => localStorage.setItem("nf:fighter", JSON.stringify(s)), d.strokes);
  await p.goto("http://localhost:3100/play?ai=off&rivalPower=water" + (process.env.Q ? "&" + process.env.Q : ""), { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  const words = await p.evaluate(() => {
    const n = window.__nf;
    n.paused = true;
    n.sim.reset();
    n.sim.fighters[0].x = -1.3;
    n.sim.fighters[1].x = 1.3;
    n.sim.fighters[0].cool = n.sim.fighters[1].cool = 0;
    n.advance(1, { special: true });
    n.sim.startSpecial(n.sim.fighters[1], n.sim.fighters[0]);
    const seen = [];
    let both = false;
    for (let i = 0; i < 90; i++) {
      n.advance(1);
      const k = n.sim.projectiles.map((q) => q.kind).join();
      if (k === "fire,water" || k === "water,fire") both = true;
      if (both && k === "water" && !seen.length) seen.push("one-left");
    }
    return seen;
  });
  // re-run and stop right at the clash for a picture
  await p.evaluate(() => {
    const n = window.__nf;
    n.sim.reset();
    n.sim.fighters[0].x = -1.3;
    n.sim.fighters[1].x = 1.3;
    n.sim.fighters[0].cool = n.sim.fighters[1].cool = 0;
    n.advance(1, { special: true });
    n.sim.startSpecial(n.sim.fighters[1], n.sim.fighters[0]);
    let both = false;
    for (let i = 0; i < 90; i++) {
      n.advance(1);
      if (n.sim.projectiles.length === 2) both = true;
      if (both && n.sim.projectiles.length === 1) break;
    }
  });
  await p.screenshot({ path: `${OUT}/counter_water_douses_fire.png` });
  const left = await p.evaluate(() => window.__nf.sim.projectiles.map((q) => q.kind));
  check(words.includes("one-left") && left.join() === "water", `water wave douses the fireball (left in flight: ${left.join() || "none"})`);
}
// the CPU gets a power by itself on Hard (the counter to yours) and uses it in a real fight
{
  await p.goto("http://localhost:3100/play?level=hard&countdown=0" + (process.env.Q ? "&" + process.env.Q : ""), { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  const rival = await p.evaluate(() => window.__nf.sim.fighters[1].special);
  const cardRival = await p.locator(".card-rival").innerText();
  let used = false;
  for (let i = 0; i < 40 && !used; i++) {
    await p.waitForTimeout(250);
    used = await p.evaluate(() => window.__nf.sim.fighters[1].cool > 0.3 && window.__nf.sim.curr.sinceStart > 1.6);
  }
  await p.screenshot({ path: `${OUT}/hard_rival_power.png` });
  check(rival === "water" && cardRival.includes("Water wave") && used, `Hard rival vs fire: draws ${rival} (card: ${cardRival.slice(0, 90)}…), uses it: ${used}`);
}
check(errs.length === 0, `no page errors ${errs.slice(0, 2)}`);
console.log(bad ? `${bad} FAILURES` : "POWERS UI OK");
await b.close();
process.exit(bad ? 1 : 0);
