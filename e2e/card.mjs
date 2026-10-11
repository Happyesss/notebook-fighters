// Phase 1 check: draw a fighter (optionally scribbled darker) on /, read the live stats under the slot,
// duel it, and check the Fighter Card on /play explains the stats. Screenshots into OUT.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
const DRAW = process.env.DRAW || "darkRightArm";
const OUT = process.env.OUT || new URL("./shots/p1", import.meta.url).pathname;
const EXPECT = process.env.EXPECT || "";
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT/.test(m.text()) && errs.push(m.text()));
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
await draw(0, "clean");
await draw(1, DRAW);
const plain = await p.getByTestId("slot-stats-0").innerText();
const dark = await p.getByTestId("slot-stats-1").innerText();
console.log("slot 1 (clean):", plain.replace(/\n/g, " | "));
console.log(`slot 2 (${DRAW}):`, dark.replace(/\n/g, " | "));
await p.screenshot({ path: `${OUT}/home_stats.png` });
await p.getByRole("button", { name: "Duel with fighter 2" }).click();
await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
await p.waitForTimeout(500);
const card = await p.getByTestId("fighter-card").innerText();
console.log("card:", card.replace(/\n/g, " | "));
await p.screenshot({ path: `${OUT}/card_${DRAW}.png` });
const hp = await p.evaluate(() => [window.__nf.sim.curr.playerHp, window.__nf.sim.curr.playerMax, window.__nf.sim.curr.bagMax]);
console.log("hp/max/rivalMax", hp);
// during the fight the card folds away by itself
await p.waitForFunction(() => window.__nf.sim.curr.countdown <= 0 && window.__nf.sim.curr.sinceStart > 0.5, null, { timeout: 10000 });
const folded = await p.evaluate(() => getComputedStyle(document.querySelector(".card-body")).display);
console.log("card while fighting:", folded);
const ok = (!EXPECT || card.includes(EXPECT)) && folded === "none" && errs.length === 0;
console.log(ok ? "CARD OK" : `CARD BAD ${errs.slice(0, 2)}`);
await b.close();
process.exit(ok ? 0 : 1);
