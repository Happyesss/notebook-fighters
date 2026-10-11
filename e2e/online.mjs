// Phase 5 (online): two real browsers (separate Playwright contexts) play each other over the
// Colyseus server on :2567. 1) a full best-of-3 with no added latency, 2) a full best-of-3 with a
// simulated 100 ms round trip ±30 ms jitter on both clients, 3) real keyboard input crossing over,
// a pulled cable (socket closed → seat held → auto-reconnect) and a page reload (rebuild from the
// server's input log, fast-forward). Pass = same rounds/winners on both, every shared checksum
// identical, 0 desyncs (client and server), 0 page errors.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
const OUT = process.env.OUT || new URL("./shots/p5", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const B = "http://localhost:3100";
// extra query for every client page, e.g. Q="physics=rapier&renderer=pixi" (the host's physics is the room's)
const XQ = process.env.Q ? "&" + process.env.Q : "";
const OUTP = process.env.TAG ? `_${process.env.TAG}` : "";
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const errs = [];
async function player(name, drawing) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(`${name}: ${e}`));
  page.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|WebSocket/.test(m.text()) && errs.push(`${name}: ${m.text()}`));
  await page.goto(B + "/", { waitUntil: "networkidle" });
  await page.evaluate((s) => {
    localStorage.setItem("nf:fighter", JSON.stringify(s));
    localStorage.setItem("nf:mute", "1");
  }, SET.find((d) => d.name === drawing).strokes);
  return { ctx, page, name };
}
const state = (page) =>
  page.evaluate(() => {
    const s = window.__nf?.session;
    const l = s?.lock;
    if (!l) return null;
    return {
      frame: l.frame,
      matches: l.matches,
      results: l.results.map((r) => `R${r.round}:${r.winner === null ? "draw" : "P" + (r.winner + 1)}@${r.frame}`),
      sums: Object.fromEntries([...l.sums].slice(-400)),
      desyncs: l.desyncs.length,
      serverDesyncs: s.serverDesyncs.length,
      delay: l.delay,
      rtt: s.rtt,
      stalls: l.stalls,
      seat: s.seat,
      ff: s.fastForwarded,
      hud: document.querySelector('[data-testid="net-hud"]')?.textContent ?? "",
      peer: document.querySelector('[data-testid="peer-note"]')?.textContent ?? null,
      x0: window.__nf.sim.fighters[0].x,
      backend: window.__nf.view?.backend,
      physics: window.__nf.sim.koPhysics,
    };
  });
const compare = (label, a, b) => {
  const shared = Object.keys(a.sums).filter((f) => f in b.sums);
  const same = shared.every((f) => a.sums[f] === b.sums[f]);
  check(same && shared.length >= 10, `${label}: ${shared.length} shared checksums identical`);
  check(!a.desyncs && !b.desyncs && !a.serverDesyncs && !b.serverDesyncs, `${label}: 0 desyncs (A ${a.desyncs}/${a.serverDesyncs}, B ${b.desyncs}/${b.serverDesyncs})`);
};

async function match(label, q, opts = {}) {
  const t0 = Date.now();
  const A = await player("A", opts.a ?? "power_fire");
  const Bp = await player("B", opts.b ?? "quadruped");
  await A.page.goto(`${B}/online?${q}&autoplay=7&name=Ana${XQ}`, { waitUntil: "networkidle" });
  await A.page.getByTestId("create-room").click();
  await A.page.getByTestId("room-code").waitFor({ timeout: 30000 });
  const code = await A.page.getByTestId("room-code").innerText();
  const share = await A.page.getByTestId("share-url").innerText();
  const redirect = await Bp.ctx.request.get(share, { maxRedirects: 0 });
  check(/^[A-Z2-9]{6}$/.test(code) && share.endsWith(`/r/${code}`) && redirect.status() === 307 && redirect.headers().location?.includes(`/online?join=${code}`), `${label}: room ${code}, link ${share} → ${redirect.status()} ${redirect.headers().location}`);
  await Bp.page.goto(`${B}/online?join=${code}&${q}&autoplay=99&name=Ben${XQ}`, { waitUntil: "networkidle" });
  await Promise.all([A, Bp].map((p) => p.page.waitForFunction(() => window.__nf?.session?.lock && window.__nf?.view, null, { timeout: 60000 })));
  let shot = false;
  let a, b;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    await A.page.waitForTimeout(1000);
    [a, b] = await Promise.all([state(A.page), state(Bp.page)]);
    if (!shot && opts.shot && a.frame > 420 && !a.results.length) {
      shot = true;
      await Promise.all([A.page.screenshot({ path: `${OUT}/online_A${OUTP}.png` }), Bp.page.screenshot({ path: `${OUT}/online_B${OUTP}.png` })]);
      // both name tags are drawn on both screens (the dog's included), inside the canvas
      const tags = await Promise.all([A.page, Bp.page].map((pg) => pg.evaluate(() => { const v = window.__nf.view; return { tags: v.tagPos, labels: v.labels, w: v.canvas.width, h: v.canvas.height }; })));
      const inside = (t, d) => t.tags.every((q) => q && q.x > 0 && q.x < t.w && q.y > 0 && q.y < t.h) && t.labels.every((l) => l && l.length);
      check(tags.every((t) => inside(t)), `${label}: name tags drawn on both screens — A ${JSON.stringify(tags[0].labels)} B ${JSON.stringify(tags[1].labels)}`);
    }
    if (a.matches >= 1 && b.matches >= 1) break;
  }
  check(a.matches >= 1 && b.matches >= 1, `${label}: full best-of-3 on both clients (A frame ${a.frame}, B frame ${b.frame}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const ra = a.results.slice(0, 3).join(" ");
  const rb = b.results.slice(0, 3).join(" ");
  check(ra === rb && a.results.length >= 2, `${label}: same rounds and winner on both — A: ${ra} | B: ${rb}`);
  compare(label, a, b);
  check(/ping \d+ ms/.test(a.hud) && /in sync/.test(a.hud), `${label}: HUD "${a.hud}"`);
  console.log(`     delay ${a.delay}f · rtt A ${a.rtt} ms B ${b.rtt} ms · stalled ticks A ${a.stalls} B ${b.stalls} · renderer ${a.backend} · KO physics ${a.physics}/${b.physics}`);
  await A.ctx.close();
  await Bp.ctx.close();
}

await match("1 no lag", "x=1", { shot: true });
if (process.env.ONLY !== "1") await match("2 lag 100±30", "lag=100&jitter=30", { a: "swordsman", b: "power_water" });

// ---- 3: keyboard input over the wire, a pulled cable, a page reload
if (process.env.ONLY !== "1") {
  const label = "3 keys/drop/reload";
  const A = await player("A", "clean");
  const Bp = await player("B", "power_lightning");
  await A.page.goto(`${B}/online?lag=40&jitter=10${XQ}`, { waitUntil: "networkidle" });
  await A.page.getByTestId("create-room").click();
  await A.page.getByTestId("room-code").waitFor({ timeout: 30000 });
  const code = await A.page.getByTestId("room-code").innerText();
  // B types the code in instead of using the link
  await Bp.page.goto(`${B}/online?lag=40&jitter=10${XQ}`, { waitUntil: "networkidle" });
  await Bp.page.getByTestId("join-code").fill(code);
  await Bp.page.getByTestId("join-room").click();
  await Promise.all([A, Bp].map((p) => p.page.waitForFunction(() => window.__nf?.session?.lock && window.__nf?.view, null, { timeout: 60000 })));
  // wait out 3-2-1
  await A.page.waitForFunction(() => window.__nf.sim.curr.countdown <= 0, null, { timeout: 20000 });
  const before = await state(Bp.page);
  await A.page.keyboard.down("d");
  await A.page.waitForTimeout(900);
  await A.page.keyboard.up("d");
  await A.page.waitForTimeout(500);
  const after = await state(Bp.page);
  check(after.x0 > before.x0 + 0.3, `${label}: A holds D → A's fighter walks on B's screen (x ${before.x0.toFixed(2)} → ${after.x0.toFixed(2)})`);
  // pull B's cable
  await Bp.page.evaluate(() => window.__nf.drop());
  await A.page.waitForTimeout(700);
  const mid = await state(A.page);
  await A.page.waitForFunction(() => window.__nf.session.peer.connected, null, { timeout: 20000 });
  await A.page.waitForTimeout(1500);
  const back = await state(Bp.page);
  check(/dropped|reconnect/i.test(mid.peer ?? "") && back.peer === null, `${label}: B's socket closed → A shows "${mid.peer}"; B reconnected by itself (reconnects ${await Bp.page.evaluate(() => window.__nf.net.reconnects)})`);
  // B reloads the page mid-match: same tab token → seat back, rebuild from the log, fast-forward
  await Bp.page.reload({ waitUntil: "networkidle" });
  await Bp.page.waitForFunction(() => window.__nf?.session?.lock && window.__nf.session.lock.frame > 200, null, { timeout: 60000 });
  await A.page.waitForTimeout(4000);
  const [a, b] = await Promise.all([state(A.page), state(Bp.page)]);
  check(b.ff > 200 && Math.abs(a.frame - b.frame) < 30, `${label}: B reloaded, rebuilt and fast-forwarded ${b.ff} frames, now frame ${b.frame} (A ${a.frame})`);
  compare(label, a, b);
  await A.page.screenshot({ path: `${OUT}/online_after_reload_A${OUTP}.png` });
  await A.ctx.close();
  await Bp.ctx.close();
}
const health = JSON.parse(execFileSync("curl", ["-s", "localhost:2567/health"]).toString());
check(health.desyncs === 0, `server: ${JSON.stringify(health)}`);
check(errs.length === 0, `page errors: ${errs.length ? errs.slice(0, 6).join(" | ") : 0}`);
// the side-by-side shot: two clients mid-match
try {
  execFileSync("python3", ["-c", `
from PIL import Image, ImageDraw
a=Image.open("${OUT}/online_A${OUTP}.png"); b=Image.open("${OUT}/online_B${OUTP}.png")
w=a.width+b.width+12; im=Image.new("RGB",(w,max(a.height,b.height)+34),(42,36,28))
im.paste(a,(0,34)); im.paste(b,(a.width+12,34))
d=ImageDraw.Draw(im); d.text((10,10),"Client A (host, seat P1)",fill=(255,250,241)); d.text((a.width+22,10),"Client B (joined by code, seat P2) - same frame range, lockstep",fill=(255,250,241))
im.save("${OUT}/online_side_by_side${OUTP}.png")`]);
  console.log(`side-by-side: ${OUT}/online_side_by_side${OUTP}.png`);
} catch (e) {
  console.log("side-by-side failed", String(e));
}
await browser.close();
console.log(bad ? `${bad} FAIL` : "ONLINE E2E OK");
process.exit(bad);
