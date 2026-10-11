// Phase 3 check: two players draw on the notebook page (P1 box 1, P2 box 2), start a 2P duel,
// and both are driven at the same time from one keyboard (P1: A/D/W/S + F/G/H/E, P2: arrows + J/K/L/;)
// and from the split touch pads; best of 3 with the countdown. Screenshots into OUT.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
const OUT = process.env.OUT || new URL("./shots/p3", import.meta.url).pathname;
const P1 = process.env.P1 || "power_fire";
const P2 = process.env.P2 || "power_ice";
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
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
const pencil = { "#2a241c": "Pencil", "#c23b32": "Red", "#1d4f89": "Blue", "#2f7d4a": "Green", "#6d4ca8": "Purple", "#c4962c": "Gold", "#e07a2f": "Orange", "#d45d8c": "Pink" };
async function draw(slotIx, name) {
  const r0 = await p.getByTestId(`slot-${slotIx}`).boundingBox();
  for (const s of SET.find((d) => d.name === name).strokes) {
    await p.getByRole("button", { name: pencil[s.color] ?? "Pencil", exact: true }).click();
    const pts = s.points.map((q) => [r0.x + q.x * r0.width, r0.y + q.y * r0.height]);
    await p.mouse.move(...pts[0]);
    await p.mouse.down();
    for (const q of pts.slice(1)) await p.mouse.move(...q, { steps: 2 });
    await p.mouse.up();
  }
}
const btn0 = await p.getByTestId("duel-2p").innerText();
await draw(0, P1);
await draw(1, P2);
const btn = await p.getByTestId("duel-2p").innerText();
check(btn0.includes("draw first") && btn.includes("2P duel"), `home: 2P button "${btn0}" → "${btn}"`);
await p.screenshot({ path: `${OUT}/home_2p.png` });
await p.getByTestId("duel-2p").click();
await p.waitForURL(/mode=2p/);
await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
const info = await p.evaluate(() => ({ ai: window.__nf.sim.ai, a: window.__nf.sim.fighters[0].special, b: window.__nf.sim.fighters[1].special, cd: window.__nf.sim.curr.countdown }));
const legend1 = await p.getByTestId("legend-p1").innerText();
const legend2 = await p.getByTestId("legend-p2").innerText();
const levels = await p.getByRole("group", { name: "Difficulty" }).count();
check(info.ai === "versus" && info.a === "fire" && info.b === "ice" && info.cd > 0, `2P duel: ${JSON.stringify(info)}`);
check(/P1.*A.*D.*walk.*W.*jump.*F.*G.*H.*block.*E.*special/s.test(legend1) && /P2.*←.*→.*walk.*↑.*jump.*J.*K.*L.*block.*;.*special/s.test(legend2) && levels === 0, `both legends shown ("${legend1.split("\n")[0]}" | "${legend2.split("\n")[0]}"), no difficulty`);
const pads = await p.locator(".player-side .tp-btn").count();
const sticks = await p.locator(".player-side .tp-stick").count();
const sides = await p.evaluate(() => [...document.querySelectorAll(".player-side")].map((e) => Math.round(e.getBoundingClientRect().x)));
// desktop (mouse + keyboard): the pads are in the page but hidden; only the legends show (see controls.mjs)
const padsShown = await p.evaluate(() => [...document.querySelectorAll(".touchpad")].filter((e) => getComputedStyle(e).display !== "none").length);
check(pads === 10 && sticks === 2 && padsShown === 0 && sides[0] < 200 && sides[1] > 600, `split controls: 2 joysticks + ${pads} buttons in the page, ${padsShown} pads shown on a desktop; P1 at x=${sides[0]}, P2 at x=${sides[1]}`);
await p.screenshot({ path: `${OUT}/duel_countdown.png` });
await p.waitForFunction(() => window.__nf.sim.curr.countdown <= 0, null, { timeout: 8000 });
// both players at once on one keyboard: walk in together
const x0 = await p.evaluate(() => window.__nf.sim.fighters.map((f) => f.x));
await p.keyboard.down("d");
await p.keyboard.down("ArrowLeft");
await p.waitForTimeout(700);
const x1 = await p.evaluate(() => window.__nf.sim.fighters.map((f) => f.x));
check(x1[0] > x0[0] + 0.2 && x1[1] < x0[1] - 0.2, `both walk in at once: P1 ${x0[0].toFixed(2)}→${x1[0].toFixed(2)}, P2 ${x0[1].toFixed(2)}→${x1[1].toFixed(2)}`);
// specials together: E and ;
await p.keyboard.up("d");
await p.keyboard.up("ArrowLeft");
await p.keyboard.down("e");
await p.keyboard.down(";");
await p.waitForTimeout(80);
await p.keyboard.up("e");
await p.keyboard.up(";");
const cools = await p.evaluate(() => window.__nf.sim.fighters.map((f) => f.cool));
await p.waitForTimeout(260);
await p.screenshot({ path: `${OUT}/duel_specials.png` });
check(cools[0] > 1 && cools[1] > 1, `E and ; fire both specials together (cooldowns ${cools.map((c) => c.toFixed(1)).join(", ")})`);
// close in and trade blows: F/G vs J/K at the same time
let hp = await p.evaluate(() => window.__nf.sim.fighters.map((f) => f.hp));
for (let i = 0; i < 14; i++) {
  const gap = await p.evaluate(() => { const [a, b] = window.__nf.sim.fighters; return b.x - a.x - a.rig.extent.front - b.rig.extent.front; });
  if (gap > 0.3) {
    await p.keyboard.down("d");
    await p.keyboard.down("ArrowLeft");
    await p.waitForTimeout(160);
    await p.keyboard.up("d");
    await p.keyboard.up("ArrowLeft");
  }
  await p.keyboard.down(i % 2 ? "g" : "f");
  await p.keyboard.down(i % 2 ? "k" : "j");
  await p.waitForTimeout(60);
  await p.keyboard.up(i % 2 ? "g" : "f");
  await p.keyboard.up(i % 2 ? "k" : "j");
  await p.waitForTimeout(380);
  if (i === 6) await p.screenshot({ path: `${OUT}/duel_trade.png` });
}
const hp2 = await p.evaluate(() => window.__nf.sim.fighters.map((f) => f.hp));
check(hp2[0] < hp[0] && hp2[1] < hp[1], `both land hits from the keyboard: P1 ${hp[0].toFixed(0)}→${hp2[0].toFixed(0)}, P2 ${hp[1].toFixed(0)}→${hp2[1].toFixed(0)}`);
// touch: P2's pad punch, P1's pad block
// (at the slower pace a hit reaction from the trade above can still be playing: wait for P2 to recover)
await p.waitForFunction(() => ["idle", "walk"].includes(window.__nf.sim.fighters[1].anim.move), null, { timeout: 5000 }).catch(() => {});
// a touch (as on a hybrid touch laptop) brings the pads up; then the mouse drives them
await p.evaluate(() => document.querySelector("canvas").dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true })));
await p.waitForTimeout(100);
const m0 = await p.evaluate(() => window.__nf.sim.fighters[1].anim.move);
await p.getByTestId("tp-p2-punch").click();
await p.waitForTimeout(80);
const m1 = await p.evaluate(() => window.__nf.sim.fighters[1].anim.move);
await p.getByTestId("tp-p1-block").hover();
await p.mouse.down();
let blocking = false;
for (let i = 0; i < 12 && !blocking; i++) {
  await p.waitForTimeout(50);
  blocking = await p.evaluate(() => window.__nf.sim.fighters[0].blocking);
}
await p.mouse.up();
check(m1 !== m0 && m1 !== "idle" && m1 !== "walk" && blocking, `touch pads: P2 punch pad → ${m1}; P1 block pad held → blocking ${blocking}`);
// finish the match fast (scripted, both pressing) and check best of 3 + banners
const result = await p.evaluate(() => {
  const n = window.__nf;
  n.paused = true;
  const banners = [];
  for (let r = 0; r < 4 && n.sim.curr.matchWinner === null; r++) {
    for (let i = 0; i < 6000 && !n.sim.curr.over; i++) {
      const [a, b] = n.sim.fighters;
      const gap = b.x - a.x - a.rig.extent.front - b.rig.extent.front;
      n.advance(1, { x: gap > 0.25 ? 1 : 0, punch: i % 17 === 0, kick: i % 29 === 0 }, { x: gap > 0.25 ? -1 : 0, punch: i % 23 === 0, special: i % 200 === 0 });
    }
    n.advance(100);
    banners.push(document.querySelector('[data-testid="banner"]').innerText.replace(/\n/g, " | "));
    if (n.sim.curr.matchWinner === null) n.sim.rematch();
  }
  return { wins: n.sim.curr.wins, winner: n.sim.curr.matchWinner, banners };
});
await p.screenshot({ path: `${OUT}/duel_match.png` });
check(result.winner !== null && Math.max(...result.wins) === 2 && result.banners.some((t) => /P[12] wins/.test(t)), `best of 3: ${JSON.stringify(result)}`);
// R starts a rematch with the countdown
await p.evaluate(() => (window.__nf.paused = false));
await p.keyboard.press("r");
await p.waitForTimeout(200);
const re = await p.evaluate(() => ({ cd: window.__nf.sim.curr.countdown, wins: window.__nf.sim.curr.wins, round: window.__nf.sim.curr.round }));
check(re.cd > 2 && re.wins.join() === "0,0" && re.round === 1, `R → rematch with countdown ${JSON.stringify(re)}`);
check(errs.length === 0, `no page errors ${errs.slice(0, 2)}`);
console.log(bad ? `${bad} FAILURES` : "TWO PLAYER OK");
await b.close();
process.exit(bad ? 1 : 0);
