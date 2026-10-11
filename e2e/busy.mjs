// Online over the free plan's limits: when POST /api/rooms or the room WebSocket fails (429 / 503 /
// Cloudflare's 1027 "exceeded" page, an overloaded Durable Object, no network), the online page and the
// Create room flow say "Online is busy right now. Play the computer or a friend on this device." with
// Play with computer, Local 2-player, Play nearby and Try again, and that is NOT the "No room with that code" (4404)
// answer. Simulated with page.route / routeWebSocket against the Worker (pnpm worker:dev on :8787).
//   BASE=http://localhost:8787 OUT=shots node busy.mjs
import { chromium, devices } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:8787";
const OUT = process.env.OUT ?? new URL("./shots", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const MSG = "Online is busy right now. Play the computer or a friend on this device.";
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};

async function open(dev, drawn = true) {
  const opts = dev === "Desktop" ? { viewport: { width: 1280, height: 800 } } : devices[dev];
  const ctx = await b.newContext({ ...opts });
  await ctx.addInitScript(() => localStorage.setItem("nf:mute", "1"));
  if (drawn) {
    const clean = SET.find((d) => d.name === "clean").strokes;
    await ctx.addInitScript((s) => localStorage.getItem("nf:fighters") || localStorage.setItem("nf:fighters", JSON.stringify({ fighters: [{ id: "a", strokes: s }, { id: "b", strokes: [] }], p1: "a", p2: "b" })) || localStorage.setItem("nf:fighter", JSON.stringify(s)), clean);
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  return { ctx, p, errs };
}
const busyText = (p) => p.getByTestId("online-busy").innerText({ timeout: 15000 }).catch(() => "");

for (const dev of ["Desktop", "iPhone 13"]) {
  // 1) Create a room (from the notebook) while POST /api/rooms answers the Worker's JSON 503
  {
    const { ctx, p, errs } = await open(dev);
    let posts = 0;
    await p.route("**/api/rooms", (r) => (r.request().method() === "POST" ? (posts++, r.fulfill({ status: 503, contentType: "application/json", body: '{"error":"busy"}' })) : r.continue()));
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await p.waitForSelector('main[data-loaded="true"]');
    await p.getByTestId("home-room").click();
    const t = await busyText(p);
    const btns = await p.locator('[data-testid="online-busy"] a, [data-testid="online-busy"] button').allInnerTexts();
    const err = await p.getByTestId("lobby-error").isVisible().catch(() => false);
    await p.screenshot({ path: `${OUT}/online_busy_${dev.replace(/ /g, "_")}.png` });
    check(t.includes(MSG) && btns.join("|") === "Play with computer|Local 2-player|Play nearby|Try again" && !err && posts === 1, `${dev}: Create a room → 503 {error:"busy"} → "${t.split("\n")[0]}" [${btns.join(" | ")}]`);
    // Try again once the server is back → a real room
    await p.unroute("**/api/rooms");
    await p.getByTestId("busy-retry").click();
    const code = await p.getByTestId("room-code").innerText({ timeout: 20000 }).catch(() => "");
    check(/^[A-Z0-9]{6}$/.test(code) && !(await p.getByTestId("online-busy").isVisible()), `${dev}: Try again (server back) → room ${code}`);
    // Play with computer from the busy panel → the rival picker on the notebook
    await p.route("**/api/rooms", (r) => (r.request().method() === "POST" ? r.fulfill({ status: 429, contentType: "text/html", body: "<html><body>error code: 1027</body></html>" }) : r.continue()));
    await p.goto(BASE + "/online?create=1");
    const t2 = await busyText(p);
    check(t2.includes(MSG), `${dev}: 429 with Cloudflare's HTML "error code: 1027" page → the same busy message`);
    await p.getByTestId("busy-cpu").click();
    const picker = await p.getByTestId("rival-picker").waitFor({ timeout: 15000 }).then(() => true, () => false);
    await p.waitForTimeout(300);
    check(picker && new URL(p.url()).pathname === "/", `${dev}: busy → "Play with computer" → the rival picker opens on the notebook`);
    await p.goto(BASE + "/online?create=1");
    await busyText(p);
    await p.getByTestId("busy-2p").click();
    await p.waitForSelector('main[data-loaded="true"]');
    const df = await p.getByTestId("draw-first").innerText({ timeout: 10000 }).catch(() => "");
    check(/player 2/i.test(df), `${dev}: busy → "Local 2-player" → the notebook asks Player 2 to draw ("${df.split("\n")[0]}")`);
    check(!errs.length, `${dev}: no page errors ${errs.join(" | ")}`);
    await ctx.close();
  }
  // 2) network down for POST /api/rooms, and the room WebSocket refused (overloaded Durable Object)
  {
    const { ctx, p } = await open(dev);
    await p.route("**/api/rooms", (r) => (r.request().method() === "POST" ? r.abort("connectionfailed") : r.continue()));
    await p.goto(BASE + "/online?create=1");
    check((await busyText(p)).includes(MSG), `${dev}: network failure on POST /api/rooms → busy message`);
    await p.unroute("**/api/rooms");
    await p.routeWebSocket(/\/api\/rooms\/[A-Z0-9]{6}\/ws$/, (ws) => ws.close({ code: 1013, reason: "overloaded" }));
    await p.getByTestId("busy-retry").click();
    check((await busyText(p)).includes(MSG), `${dev}: room WebSocket closed 1013 before welcome → busy message (Try again)`);
    await ctx.close();
  }
  // 3) a code that doesn't exist is still "No room with that code" (4404), not busy
  {
    const { ctx, p } = await open(dev);
    await p.goto(BASE + "/online?join=ZZZZZZ");
    const e = await p.getByTestId("lobby-error").innerText({ timeout: 15000 }).catch(() => "");
    const busy = await p.getByTestId("online-busy").isVisible();
    check(/no room with that code/i.test(e) && !busy, `${dev}: unknown room ZZZZZZ → "${e}" (no busy panel)`);
    await ctx.close();
  }
}
// 4) the Worker itself: JSON, never an HTML error page, for the API's error answers
{
  const r = await fetch(BASE + "/api/rooms/ZZZZZZ");
  const j = await r.json();
  const ws = await fetch(BASE + "/api/rooms/ZZZZZZ/ws");
  check(r.ok && j.exists === false && ws.status === 426 && /json/.test(ws.headers.get("content-type") ?? ""), `Worker: unknown room → ${JSON.stringify(j)}; plain GET on /ws → ${ws.status} JSON`);
}
await b.close();
console.log(bad ? `${bad} FAIL` : "BUSY OK");
process.exit(bad ? 1 : 0);
