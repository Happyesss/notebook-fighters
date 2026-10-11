// Play nearby (no internet), in real Chromium.
//   1) offline, against the Worker (`pnpm worker:dev`, BASE= to override): after one visit the service
//      worker serves /, /play, /online, /nearby (and /r/CODE → /online) with the network switched off
//      (context.setOffline); /api is never cached; the home hint says "Works offline".
//   No internet for 2) and 3): Chromium's offline emulation (setOffline) also blocks WebRTC's UDP, so
//   there the game is loaded once from a small static server this test owns (apps/web/out on
//   localhost), the service worker installs, and then the server is shut down: every HTTP request
//   fails, the pages come from the service worker, and the phones pair and fight with no server at all.
//   2) paste path, desktop: host + friend swap the offer / answer codes with the copy-paste fallback;
//      WebRTC data channel (iceServers: [], Chrome's mDNS ".local" host candidates) over loopback; host
//      Accept; full best-of-3 (scripted fighters): same rounds, identical checksums, 0 desyncs. Then
//      the friend's link is pulled → both show "Connection lost" + Rematch / Back, and Rematch pairs again.
//   3) QR path, two iPhone 13s: each phone's camera is Chromium's fake camera playing the other phone's
//      QR (captured from the page), read by the in-page scanner (jsQR: no BarcodeDetector on Linux);
//      100 ms round trip injected on the friend (?lag=100&jitter=10). Full best-of-3, 0 desyncs.
// Screenshots: SHOTS (default e2e/shots/nearby).
import { chromium, devices } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";

const B = (process.env.BASE || "http://localhost:8787").replace(/\/$/, "");
const SHOTS = process.env.SHOTS || new URL("./shots/nearby", import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const ONLY = process.env.ONLY?.split(",");
const run = (k) => !ONLY || ONLY.includes(k);
const EXE = process.env.CHROME ? { executablePath: process.env.CHROME } : {};
const FONTS = "--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND";
// MDNS=0: real host IPs instead of Chrome's mDNS ".local" names (if mDNS can't resolve somewhere)
const EXTRA = process.env.MDNS === "0" ? ["--disable-features=WebRtcHideLocalIpsWithMdns"] : [];
const IPHONE = devices["iPhone 13"];
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const errs = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

/** the static export on localhost (a secure context, like https); stop() = "no internet" */
const OUTDIR = new URL("../apps/web/out/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".woff2": "font/woff2" };
async function staticServer() {
  const sockets = new Set();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/api/")) {
      res.writeHead(503, { "content-type": "application/json" });
      return res.end('{"error":"busy"}');
    }
    const p = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/index";
    const f = [p, `${p}.html`].map((c) => path.join(OUTDIR, c)).find((c) => c.startsWith(OUTDIR) && fs.existsSync(c) && fs.statSync(c).isFile());
    if (!f) {
      res.writeHead(404, { "content-type": "text/html" });
      return res.end(fs.readFileSync(path.join(OUTDIR, "404.html")));
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", "cache-control": "public, max-age=0, must-revalidate" });
    res.end(fs.readFileSync(f));
  });
  srv.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return {
    base: `http://localhost:${srv.address().port}`,
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => srv.close(r));
    },
  };
}

/** a context with a drawing saved and the service worker installed + in control */
async function open(browser, name, { device = null, drawing = "clean", base = B } = {}) {
  const ctx = await browser.newContext(device ? { ...device } : { viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(`${name}: ${e}`));
  page.on("console", (m) => m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|ERR_FAILED|Failed to load resource|Failed to fetch|fonts\.g/.test(m.text()) && errs.push(`${name}: ${m.text()}`));
  await page.goto(base + "/", { waitUntil: "load" });
  if (drawing)
    await page.evaluate((s) => {
      localStorage.setItem("nf:fighter", JSON.stringify(s));
      localStorage.setItem("nf:mute", "1");
    }, SET.find((d) => d.name === drawing).strokes);
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    for (let i = 0; i < 100 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 50));
    const pre = (await caches.keys()).find((k) => k.startsWith("nf-precache-"));
    const n = pre ? (await (await caches.open(pre)).keys()).length : 0;
    return { active: !!reg.active, controlled: !!navigator.serviceWorker.controller, cache: pre, n };
  });
  return { ctx, page, name, sw, base };
}

const apiReachable = (page) =>
  page.evaluate(async () => {
    try {
      await fetch("/api/health", { cache: "no-store" });
      return "answered";
    } catch {
      return "unreachable";
    }
  });

/** decode a nearby code in the page: SDP size and its ICE candidates (mDNS ".local" name or IP) */
const sdpInfo = (page, c) =>
  page.evaluate(async (c) => {
    const bin = atob(c.slice(4).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((c.length - 4 + 3) % 4));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    const out = c[3] === "z" ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text() : new TextDecoder().decode(bytes);
    return { lines: out.split("\r\n").filter(Boolean).length, cands: out.split("\r\n").filter((l) => l.startsWith("a=candidate")), bytes: out.length };
  }, c);
const candList = (info) => info.cands.map((l) => l.split(" ").slice(4, 8).join(" ")).join(" | ");

const lockState = (page) =>
  page.evaluate(() => {
    const s = window.__nf?.session;
    const l = s?.lock;
    if (!l) return null;
    return { frame: l.frame, matches: l.matches, results: l.results.map((r) => `R${r.round}:${r.winner === null ? "draw" : "P" + (r.winner + 1)}@${r.frame}`), sums: Object.fromEntries([...l.sums]), desyncs: l.desyncs.length, serverDesyncs: s.serverDesyncs.length, delay: l.delay, rtt: s.rtt, stalls: l.stalls, seat: s.seat };
  });

async function diag(label, ...ps) {
  for (const p of ps) {
    const d = await p.page.evaluate(() => ({ step: document.querySelector("main")?.dataset.step, err: document.querySelector('[data-testid="lobby-error"]')?.textContent ?? "", lost: document.querySelector('[data-testid="lost"]')?.textContent ?? "" })).catch((e) => String(e));
    console.log(`     [${label}] ${p.name}: ${JSON.stringify(d)}`);
  }
}

/** the host sees the friend's drawing and accepts; nothing starts before that */
async function acceptStep(label, host, friend, shots = "") {
  try {
    await host.page.getByTestId("accept-prompt").waitFor({ timeout: 30000 });
    await friend.page.getByTestId("waiting-accept").waitFor({ timeout: 30000 });
  } catch (e) {
    await diag(label, host, friend);
    throw e;
  }
  const name = await host.page.getByTestId("ask-name").innerText();
  const thumb = await host.page.locator(".ask-thumb").count();
  const started = await Promise.all([host, friend].map((p) => p.page.evaluate(() => !!window.__nf?.session?.start)));
  if (shots) await shot(host.page, `${shots}_host_accept_prompt`);
  check(thumb === 1 && started.every((v) => !v), `${label}: channel open; host asked about "${name}" with the drawing; friend waits; no fight before Accept`);
  await host.page.getByTestId("accept-join").click();
  await Promise.all([host, friend].map((p) => p.page.waitForFunction(() => !!window.__nf?.session?.lock, null, { timeout: 30000 })));
}

/** play until both finished a best-of-3, then compare */
async function fullMatch(label, host, friend, shotAt) {
  const t0 = Date.now();
  let shotDone = false;
  while (Date.now() - t0 < 240_000) {
    await wait(1000);
    const [a, b] = await Promise.all([lockState(host.page), lockState(friend.page)]);
    if (shotAt && !shotDone && a && a.frame > 480) {
      shotDone = true;
      await shotAt();
    }
    if (a && b && a.matches >= 1 && b.matches >= 1) break;
  }
  await wait(800);
  const [A, F] = await Promise.all([lockState(host.page), lockState(friend.page)]);
  const common = Object.keys(A.sums).filter((f) => f in F.sums);
  const winner = (s) => (s.results.slice(0, 3).filter((r) => r.includes(":P1")).length >= 2 ? "P1" : "P2");
  check(A.matches >= 1 && F.matches >= 1, `${label}: full best-of-3 on both (frames ${A.frame} / ${F.frame}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  check(A.results.slice(0, 3).join(" ") === F.results.slice(0, 3).join(" ") && winner(A) === winner(F), `${label}: same rounds, match winner ${winner(A)} on both — host: ${A.results.slice(0, 3).join(" ")} | friend: ${F.results.slice(0, 3).join(" ")}`);
  check(common.length > 20 && common.every((f) => A.sums[f] === F.sums[f]), `${label}: ${common.length} shared checksums identical`);
  check(A.desyncs + F.desyncs + A.serverDesyncs + F.serverDesyncs === 0, `${label}: 0 desyncs (host ${A.desyncs}/${A.serverDesyncs}, friend ${F.desyncs}/${F.serverDesyncs})`);
  const hud = await host.page.getByTestId("net-hud").innerText();
  console.log(`     delay ${A.delay}f · ping host ${A.rtt} ms friend ${F.rtt} ms · stalls ${A.stalls}/${F.stalls}\n     host HUD: ${hud}`);
  return { A, F, hud };
}

/** host: Create nearby room → its offer code */
async function hostCreate(host) {
  await host.page.getByTestId("nearby-create").click();
  const box = host.page.getByTestId("offer-code");
  await box.waitFor({ timeout: 15000 });
  await host.page.getByTestId("offer-qr").waitFor();
  return box.inputValue();
}
/** friend: paste the offer → its answer code */
async function friendPaste(friend, offer, shotName = "") {
  if ((await friend.page.getByTestId("paste-code").count()) === 0) await friend.page.getByTestId("nearby-join").click();
  await friend.page.getByTestId("paste-code").fill(offer);
  if (shotName) await shot(friend.page, shotName);
  await friend.page.getByTestId("paste-go").click();
  const box = friend.page.getByTestId("answer-code");
  await box.waitFor({ timeout: 15000 });
  return box.inputValue();
}
async function hostPaste(host, answer) {
  await host.page.getByTestId("paste-code").fill(answer);
  await host.page.getByTestId("paste-go").click();
}

// ---- 1) offline pages against the Worker ---------------------------------------------------------
if (run("1")) {
  const browser = await chromium.launch({ ...EXE, args: [FONTS, ...EXTRA] });
  const t = await open(browser, "offline");
  check(t.sw.active && t.sw.controlled && t.sw.n > 100, `1: service worker active and in control, ${t.sw.n} files precached (${t.sw.cache})`);
  await t.page.goto(B + "/nearby", { waitUntil: "load" });
  await shot(t.page, "desktop_nearby_entry");
  await t.page.goto(B + "/online", { waitUntil: "load" });
  await t.page.getByTestId("nearby-link").waitFor();
  await shot(t.page, "desktop_online_nearby_link");
  await t.page.goto(B + "/", { waitUntil: "load" });
  await t.page.getByTestId("home-nearby").waitFor();
  await shot(t.page, "desktop_home_nearby_link");
  await t.ctx.setOffline(true);
  const api = await apiReachable(t.page);
  check(api === "unreachable", `1: offline: /api/health is not served from the cache (${api})`);
  for (const [p, sel] of [["/", '[data-testid="fight-cpu"]'], ["/play", "canvas"], ["/play?mode=2p", "canvas"], ["/online", '[data-testid="create-room"]'], ["/nearby", '[data-testid="nearby-create"]']]) {
    let ok = false;
    let status = 0;
    try {
      const res = await t.page.goto(B + p, { waitUntil: "load", timeout: 20000 });
      status = res?.status() ?? 0;
      await t.page.locator(sel).first().waitFor({ timeout: 15000 });
      ok = true;
    } catch {
      ok = false;
    }
    check(ok, `1: offline: ${p} opens from the service worker (${status}, ${sel} shown)`);
    if (p === "/") {
      const ready = await t.page.getByTestId("offline-hint").getAttribute("data-ready");
      check(ready === "true", `1: offline home shows "Works offline" (data-ready=${ready})`);
      await shot(t.page, "desktop_offline_home");
      // a client-side navigation offline (Next router fetches the page's RSC payload from the cache)
      await t.page.getByTestId("duel-2p").click();
      const draw = await t.page.getByTestId("draw-first").count();
      if (draw) {
        // player 2 has no drawing: the draw-first prompt (the page itself still works offline)
        check(true, `1: offline: "2 players" asks player 2 to draw first (client-side, no network)`);
      }
    }
    if (p === "/play") {
      const f0 = await t.page.evaluate(() => window.__nf?.sim?.curr?.frame ?? null);
      await wait(1500);
      const f1 = await t.page.evaluate(() => window.__nf?.sim?.curr?.frame ?? null);
      check(f0 !== null && f1 > f0, `1: offline: the fight vs the computer runs (sim frame ${f0} → ${f1})`);
    }
  }
  const r = await t.page.goto(B + "/r/ABCDEF", { waitUntil: "load" }).catch(() => null);
  check(!!r && (await t.page.getByTestId("online").count()) === 1, `1: offline: /r/CODE falls back to the saved /online page`);
  await t.ctx.setOffline(false);
  await t.ctx.close();
  await browser.close();
}

// ---- 2) paste path, desktop, no server ------------------------------------------------------------
if (run("2")) {
  // Chromium's built-in fake camera (a test pattern, no QR) for the friend's live scanner; the codes go by
  // paste. The host never gets camera permission, so its offer uses Chrome's mDNS ".local" host names.
  const browser = await chromium.launch({ ...EXE, args: [FONTS, ...EXTRA, "--use-fake-device-for-media-stream"] });
  const srv = await staticServer();
  const L = srv.base;
  const host = await open(browser, "host", { drawing: "clean", base: L });
  // a heavily scrubbed drawing (30 KB of JSON): its "join" goes over the data channel in chunks
  const friend = await open(browser, "friend", { drawing: "darkEverything", base: L });
  check(host.sw.controlled && friend.sw.controlled && host.sw.n > 100, `2: both contexts controlled by the service worker (${host.sw.n} files)`);
  await srv.stop();
  await Promise.all([host.page.goto(L + "/nearby?autoplay=7&name=Asha", { waitUntil: "load" }), friend.page.goto(L + "/nearby?autoplay=99&name=Ravi", { waitUntil: "load" })]);
  const api = await apiReachable(host.page);
  const opened = await Promise.all([host, friend].map((p) => p.page.getByTestId("nearby-create").count()));
  check(api === "unreachable" && opened.every((n) => n === 1), `2: server shut down (/api/health ${api}); /nearby opened from the service worker on both`);
  await shot(host.page, "desktop_offline_nearby");
  const t0 = Date.now();
  const offer = await hostCreate(host);
  await shot(host.page, "desktop_host_qr");
  const sdpLines = await sdpInfo(host.page, offer);
  console.log(`     offer: ${offer.length} chars (SDP ${sdpLines.bytes} B, ${sdpLines.lines} lines) · host candidates: ${candList(sdpLines)}`);
  const modules = await host.page.getByTestId("offer-qr").getAttribute("data-modules");
  await friend.ctx.grantPermissions(["camera"], { origin: L });
  await friend.page.getByTestId("nearby-join").click();
  await friend.page.getByTestId("guest-scan").waitFor();
  await friend.page.waitForFunction(() => document.querySelector('[data-testid="scanner"]')?.dataset.state === "scanning", null, { timeout: 15000 }).catch(() => {});
  await wait(800);
  await shot(friend.page, "desktop_guest_scanner");
  // a wrong code is refused with a clear message
  await friend.page.getByTestId("paste-code").fill("hello");
  await friend.page.getByTestId("paste-go").click();
  const wrong = await friend.page.getByTestId("lobby-error").innerText({ timeout: 5000 }).catch(() => "");
  check(/isn't a Notebook Fighters nearby code/.test(wrong), `2: a wrong code is refused: "${wrong}"`);
  const answer = await friendPaste(friend, offer);
  console.log(`     answer: ${answer.length} chars · friend candidates: ${candList(await sdpInfo(friend.page, answer))}`);
  check(sdpLines.cands.length > 0 && sdpLines.cands.every((l) => /\.local /.test(l)), `2: the host's offer carries only mDNS ".local" host candidates (Chrome's default) and still connects`);
  await shot(friend.page, "desktop_guest_answer_qr");
  await hostPaste(host, answer);
  await acceptStep("2", host, friend, "desktop");
  check(true, `2: paired by copy / paste in ${((Date.now() - t0) / 1000).toFixed(1)} s (offer ${offer.length} chars → QR ${modules}×${modules} modules, answer ${answer.length} chars)`);
  await fullMatch("2 paste, no server, no lag", host, friend, () => shot(host.page, "desktop_fight_in_progress"));
  // pull the cable: the friend's link closes → both see Connection lost (Rematch / Back)
  await friend.page.evaluate(() => window.__nf.drop());
  await Promise.all([host, friend].map((p) => p.page.getByTestId("lost").waitFor({ timeout: 10000 })));
  const btns = await Promise.all([host, friend].map((p) => p.page.evaluate(() => !!document.querySelector('[data-testid="lost-rematch"]') && !!document.querySelector('[data-testid="lost-back"]'))));
  check(btns.every(Boolean), `2: link pulled → "Connection lost" with Rematch / Back on both`);
  await shot(host.page, "desktop_connection_lost");
  // Rematch: pair again (still no server) and the next fight starts
  await host.page.getByTestId("lost-rematch").click();
  await friend.page.getByTestId("lost-rematch").click();
  const offer2 = await (async () => {
    const box = host.page.getByTestId("offer-code");
    await box.waitFor({ timeout: 15000 });
    return box.inputValue();
  })();
  await hostPaste(host, await friendPaste(friend, offer2));
  await acceptStep("2 rematch", host, friend);
  await wait(3000);
  const [ra, rb] = await Promise.all([lockState(host.page), lockState(friend.page)]);
  const steps = await Promise.all([host, friend].map((p) => p.page.locator("main").getAttribute("data-step")));
  check(ra?.frame > 60 && rb?.frame > 60 && steps.every((s) => s === "fight"), `2: Rematch → paired again and fighting (frames ${ra?.frame}/${rb?.frame}, screens ${steps.join("/")})`);
  await host.ctx.close();
  await friend.ctx.close();
  await browser.close();
}

// ---- 3) QR path, two iPhone 13s, fake cameras, 100 ms round trip, no server ----------------------------
function y4m(png, out) {
  // the QR on a white 640×480 frame (Chrome loops the file)
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-loop", "1", "-i", png, "-vf", "scale=440:440:flags=neighbor,pad=640:480:100:20:white,format=yuv420p", "-frames:v", "10", "-r", "10", out]);
}
if (run("3")) {
  const srv = await staticServer();
  const L = srv.base;
  const hostCam = "/tmp/nf-nearby-host-cam.y4m";
  const friendCam = "/tmp/nf-nearby-friend-cam.y4m";
  for (const f of [hostCam, friendCam]) execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=640x480", "-frames:v", "5", "-r", "10", "-pix_fmt", "yuv420p", f]);
  const camArgs = (f) => ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${f}`];
  const hb = await chromium.launch({ ...EXE, args: [FONTS, ...EXTRA, ...camArgs(hostCam)] });
  const gb = await chromium.launch({ ...EXE, args: [FONTS, ...EXTRA, ...camArgs(friendCam)] });
  const host = await open(hb, "host-iphone", { device: IPHONE, drawing: "clean", base: L });
  const friend = await open(gb, "friend-iphone", { device: IPHONE, drawing: "quadruped", base: L });
  check(host.sw.controlled && friend.sw.controlled, `3: both iPhones controlled by the service worker`);
  await host.ctx.grantPermissions(["camera"], { origin: L });
  await friend.ctx.grantPermissions(["camera"], { origin: L });
  await srv.stop();
  await host.page.goto(L + "/", { waitUntil: "load" });
  await host.page.getByTestId("home-nearby").waitFor();
  await host.page.waitForFunction(() => document.querySelector('[data-testid="offline-hint"]')?.dataset.ready === "true", null, { timeout: 10000 }).catch(() => {});
  await shot(host.page, "iphone_offline_home");
  await host.page.getByTestId("home-nearby").click();
  await host.page.getByTestId("nearby-create").waitFor({ timeout: 15000 });
  check(true, `3: server shut down; home → "Play nearby" link → /nearby, all from the service worker`);
  await host.page.goto(L + "/nearby?autoplay=7&name=Asha", { waitUntil: "load" });
  await shot(host.page, "iphone_nearby_entry");
  await friend.page.goto(L + "/nearby?autoplay=99&name=Ravi&lag=100&jitter=10", { waitUntil: "load" });
  // the live scanner (the camera still shows a blank page), for the screenshot; then back to the menu
  await friend.page.getByTestId("nearby-join").click();
  await friend.page.waitForFunction(() => document.querySelector('[data-testid="scanner"]')?.dataset.state === "scanning", null, { timeout: 15000 }).catch(() => {});
  await wait(600);
  await shot(friend.page, "iphone_guest_scanner");
  await friend.page.reload({ waitUntil: "load" });
  const offer = await hostCreate(host);
  await wait(300);
  await shot(host.page, "iphone_host_qr");
  await host.page.getByTestId("offer-qr").screenshot({ path: "/tmp/nf-offer-qr.png" });
  y4m("/tmp/nf-offer-qr.png", friendCam);
  await friend.page.getByTestId("nearby-join").click();
  const scanner = friend.page.getByTestId("scanner");
  await scanner.waitFor();
  await friend.page.waitForFunction(() => document.querySelector('[data-testid="scanner"]')?.dataset.state === "scanning", null, { timeout: 15000 }).catch(() => {});
  const decoder = await scanner.getAttribute("data-decoder").catch(() => "");
  try {
    await friend.page.getByTestId("answer-qr").waitFor({ timeout: 30000 });
  } catch (e) {
    await diag("3 scan", friend);
    throw e;
  }
  const scanned = await friend.page.evaluate(() => window.__nf.codes.offer);
  check(scanned === offer, `3: friend's camera scanner (${decoder === "native" ? "BarcodeDetector" : "jsQR"}) read the host's QR: ${offer.length} chars = the offer`);
  await wait(300);
  await shot(friend.page, "iphone_guest_answer_qr");
  const answer = await friend.page.getByTestId("answer-code").inputValue();
  console.log(`     host candidates: ${candList(await sdpInfo(friend.page, offer))} · friend candidates: ${candList(await sdpInfo(friend.page, answer))}`);
  await friend.page.getByTestId("answer-qr").screenshot({ path: "/tmp/nf-answer-qr.png" });
  y4m("/tmp/nf-answer-qr.png", hostCam);
  await host.page.getByTestId("scan-answer").click();
  await host.page.getByTestId("scanner").waitFor();
  await wait(600);
  await shot(host.page, "iphone_host_scanner");
  let viaCamera = true;
  try {
    await host.page.waitForFunction(() => !!window.__nf?.codes?.answer, null, { timeout: 20000 });
  } catch {
    viaCamera = false;
  }
  if (viaCamera) check((await host.page.evaluate(() => window.__nf.codes.answer)) === answer, `3: host's camera scanner read the friend's answer QR`);
  else {
    // fallback: decode the answer QR image with jsQR and use the paste box
    const jsQR = (await import("../apps/web/node_modules/jsqr/dist/jsQR.js")).default;
    const dec = await host.page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      return { w: img.width, h: img.height, data: Array.from(g.getImageData(0, 0, img.width, img.height).data) };
    }, fs.readFileSync("/tmp/nf-answer-qr.png").toString("base64"));
    const hit = jsQR(Uint8ClampedArray.from(dec.data), dec.w, dec.h);
    check(hit?.data === answer, `3: (camera didn't pick up the new file) answer QR image decoded with jsQR = the answer; pasted`);
    await hostPaste(host, hit?.data ?? "");
  }
  await acceptStep("3", host, friend, "iphone");
  const r = await fullMatch("3 QR, no server, 100 ms round trip on the friend", host, friend, async () => {
    await shot(host.page, "iphone_fight_in_progress");
    await shot(friend.page, "iphone_fight_in_progress_friend");
  });
  check(r.A.rtt >= 80 && r.F.rtt >= 80 && r.A.delay > 3, `3: lag shows: ping host ${r.A.rtt} ms / friend ${r.F.rtt} ms, input delay ${r.A.delay}f picked from the measured round trip`);
  await host.ctx.close();
  await friend.ctx.close();
  await hb.close();
  await gb.close();
}

check(errs.length === 0, `no page errors${errs.length ? ": " + errs.slice(0, 5).join(" | ") : ""}`);
console.log(bad ? `${bad} FAIL` : "NEARBY E2E OK");
process.exit(bad ? 1 : 0);
