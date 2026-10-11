// Phase 5 (online): two real browsers (separate Playwright contexts) play each other through the
// Notebook Fighters Worker (site + Durable Object rooms), by default `pnpm worker:dev` on :8787
// (BASE=https://notebook-fighters.<you>.workers.dev to test a deploy). 1) a full best-of-3 with no added latency, 2) a full best-of-3 with a
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
const B = (process.env.BASE || "http://localhost:8787").replace(/\/$/, "");
// extra query for every client page, e.g. Q="physics=rapier&renderer=pixi" (the host's physics is the room's)
const XQ = process.env.Q ? "&" + process.env.Q : "";
const OUTP = process.env.TAG ? `_${process.env.TAG}` : "";
// screenshots of the accept step, the joiner's wait and the phone flow (default: OUT)
const SHOTS = process.env.SHOTS || OUT;
fs.mkdirSync(SHOTS, { recursive: true });
/** the host sees the friend's drawing and accepts; until then the friend waits and nothing starts */
async function acceptStep(label, host, friend, shot = false) {
  await host.page.getByTestId("accept-prompt").waitFor({ timeout: 30000 });
  await friend.page.getByTestId("waiting-accept").waitFor({ timeout: 30000 });
  const name = await host.page.getByTestId("ask-name").innerText();
  const thumb = await host.page.locator(".ask-thumb").count();
  const started = await Promise.all([host, friend].map((p) => p.page.evaluate(() => !!window.__nf?.session?.start)));
  if (shot) await Promise.all([host.page.screenshot({ path: `${SHOTS}/accept_prompt_host${OUTP}.png` }), friend.page.screenshot({ path: `${SHOTS}/joiner_waiting${OUTP}.png` })]);
  check(thumb === 1 && started.every((v) => !v), `${label}: host asked about "${name}" (with the drawing); friend sees "Waiting for host to accept…"; no fight yet`);
  await host.page.getByTestId("accept-join").click();
}
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const errs = [];
const roomInfo = async (code) => (await fetch(`${B}/api/rooms/${code}`)).json();
// the Worker serves the site, the sounds, the API and the share-link redirect
{
  const get = (p, o) => fetch(B + p, o);
  const [home, play, online, sfx, health, nope] = await Promise.all([get("/"), get("/play"), get("/online"), get("/sfx/punch_1.m4a"), get("/api/health"), get("/no-such-page")]);
  check(home.status === 200 && play.status === 200 && online.status === 200 && /text\/html/.test(play.headers.get("content-type")), `site: / ${home.status}, /play ${play.status}, /online ${online.status}`);
  const buf = await sfx.arrayBuffer();
  check(sfx.status === 200 && buf.byteLength > 1000, `sfx: /sfx/punch_1.m4a ${sfx.status} ${sfx.headers.get("content-type")} ${buf.byteLength} B`);
  check(health.status === 200 && (await health.json()).ok === true, `GET /api/health ${health.status}`);
  check(nope.status === 404, `unknown page → ${nope.status} (404.html)`);
}
async function player(name, drawing) {
  const [vw, vh] = (process.env.VIEW || "960x600").split("x").map(Number);
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
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
      sent: s.sentMsgs,
      inputMsgs: s.inputMsgs,
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
  check(/^[A-Z2-9]{6}$/.test(code) && share.endsWith(`/r/${code}`) && redirect.status() === 302 && redirect.headers().location?.includes(`/online?join=${code}`), `${label}: room ${code}, link ${share} → ${redirect.status()} ${redirect.headers().location}`);
  await Bp.page.goto(`${B}/online?join=${code}&${q}&autoplay=99&name=Ben${XQ}`, { waitUntil: "networkidle" });
  await acceptStep(label, A, Bp, !!opts.shot);
  await Promise.all([A, Bp].map((p) => p.page.waitForFunction(() => window.__nf?.session?.lock && window.__nf?.view, null, { timeout: 60000 })));
  let shot = false;
  let a, b;
  let t1 = 0, s1 = 0, f1 = 0;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    await A.page.waitForTimeout(1000);
    [a, b] = await Promise.all([state(A.page), state(Bp.page)]);
    if (!t1 && a.frame > 240) [t1, s1, f1] = [Date.now(), a.sent, a.frame];
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
  const secs = (Date.now() - t1) / 1000;
  console.log(`     delay ${a.delay}f · rtt A ${a.rtt} ms B ${b.rtt} ms · stalled ticks A ${a.stalls} B ${b.stalls} · renderer ${a.backend} · KO physics ${a.physics}/${b.physics}`);
  console.log(`     A sent ${a.sent} WS messages for ${a.frame} frames · in the fight ${((a.sent - s1) / secs).toFixed(1)} msg/s, ${((a.frame - f1) / Math.max(1, a.sent - s1)).toFixed(2)} frames/message`);
  const info = await roomInfo(code);
  check(info.exists && info.desyncs === 0 && info.phase === "fight", `${label}: room ${code} on the Worker — ${JSON.stringify(info)}`);
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
  // someone else gets the link first: the host declines, they're told so, and the seat is free again
  const C = await player("C", "sloppy");
  await C.page.goto(`${B}/r/${code}`, { waitUntil: "networkidle" });
  await A.page.getByTestId("accept-prompt").waitFor({ timeout: 30000 });
  await A.page.getByTestId("decline-join").click();
  await C.page.getByTestId("lobby-error").waitFor({ timeout: 15000 });
  const why = await C.page.getByTestId("lobby-error").innerText();
  await A.page.waitForFunction(() => !document.querySelector('[data-testid="accept-prompt"]') && document.querySelectorAll('.seats li[data-filled="true"]').length === 1, null, { timeout: 10000 });
  await C.page.screenshot({ path: `${SHOTS}/declined_joiner${OUTP}.png` });
  check(/declined/i.test(why), `${label}: host declined the first friend → "${why}"; seat 2 free again`);
  await C.ctx.close();
  // B types the code in instead of using the link
  await Bp.page.goto(`${B}/online?lag=40&jitter=10${XQ}`, { waitUntil: "networkidle" });
  await Bp.page.getByTestId("join-code").fill(code);
  await Bp.page.getByTestId("join-room").click();
  await acceptStep(label, A, Bp);
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
  const info = await roomInfo(code);
  check(info.exists && info.desyncs === 0 && info.reconnects >= 2, `${label}: room ${code} — ${JSON.stringify(info)}`);
  await A.page.screenshot({ path: `${OUT}/online_after_reload_A${OUTP}.png` });
  await A.ctx.close();
  await Bp.ctx.close();
}
// ---- 4: a friend on a phone opens the link with nothing drawn: draw first (big pad), wait for the host, fight, rotate
if (!process.env.ONLY || process.env.ONLY === "4") {
  const label = "4 phone joiner";
  const A = await player("A", "clean");
  await A.page.goto(`${B}/online${XQ ? "?" + XQ.slice(1) : ""}`, { waitUntil: "networkidle" });
  await A.page.getByTestId("create-room").click();
  await A.page.getByTestId("room-code").waitFor({ timeout: 30000 });
  const code = await A.page.getByTestId("room-code").innerText();
  const { devices } = await import("playwright");
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  // iOS Safari has no orientation lock: the Rotate button turns the view in CSS instead
  await ctx.addInitScript(() => { try { delete ScreenOrientation.prototype.lock; } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(`D: ${e}`));
  const D = { ctx, page, name: "D" };
  await page.goto(`${B}/r/${code}`, { waitUntil: "networkidle" });
  await page.getByTestId("draw-first").waitFor({ timeout: 15000 });
  const noSeat = (await roomInfo(code)).seats.filter(Boolean).length;
  await page.screenshot({ path: `${SHOTS}/joiner_draw_first_iPhone_13${OUTP}.png` });
  await page.getByTestId("online-draw").tap();
  await page.getByTestId("sketch-canvas").waitFor();
  const pad = await page.getByTestId("sketch-canvas").boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const tev = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
  for (const s of SET.find((d) => d.name === "clean").strokes) {
    const pts = s.points.map((q) => [pad.x + q.x * pad.width, pad.y + q.y * pad.height]);
    await tev("touchStart", [pts[0]]);
    for (const q of pts.slice(1)) await tev("touchMove", [q]);
    await tev("touchEnd", []);
  }
  for (let i = 0; i < 4 && (await page.getByTestId("sketch-modal").count()); i++) {
    await page.getByTestId("sketch-done").tap();
    await page.waitForTimeout(150);
  }
  await acceptStep(label, A, D, false);
  await page.screenshot({ path: `${SHOTS}/joiner_after_accept_iPhone_13${OUTP}.png` }).catch(() => {});
  await Promise.all([A, D].map((p) => p.page.waitForFunction(() => window.__nf?.session?.lock && window.__nf?.view, null, { timeout: 60000 })));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("nf:fighters") || "null"));
  check(noSeat === 1 && saved?.fighters?.some((f) => f.strokes.length >= 6), `${label}: /r/${code} with no drawing → "draw first" (no seat taken: ${noSeat} seated); the drawing from the pad is saved to the notebook and used to join`);
  // rotate the online fight on the upright iPhone
  await page.waitForTimeout(800);
  await page.getByTestId("rotate").tap();
  await page.waitForTimeout(500);
  const rot = await page.evaluate(() => ({ r: document.documentElement.dataset.rotated, fit: document.documentElement.dataset.fit, box: document.querySelector(".stage").getBoundingClientRect().toJSON(), w: document.querySelector(".canvas-host").clientWidth, h: document.querySelector(".canvas-host").clientHeight }));
  await page.screenshot({ path: `${SHOTS}/online_rotate_iPhone_13${OUTP}.png` });
  check(rot.r === "1" && rot.fit === "phone-landscape" && rot.w > rot.h && rot.box.height > rot.box.width, `${label}: Rotate in the online fight → sideways view (${rot.w}×${rot.h} arena on a ${Math.round(rot.box.width)}×${Math.round(rot.box.height)} upright screen)`);
  // let the rotated fight run long enough for both sides to post ≥10 checksums
  await page.waitForTimeout(12000);
  const [a, d] = await Promise.all([state(A.page), state(page)]);
  compare(label, a, d);
  await A.ctx.close();
  await ctx.close();
}
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
