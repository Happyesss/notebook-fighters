// Phase 4 check (game feel): audio starts only after a gesture and the mute toggle is saved; hit-stop
// freezes the fight for longer on bigger blows; the receiver squashes; a K.O. punches the camera in,
// plays in slow-mo and then auto-replays; "Save clip" downloads a valid WebM; 2P tags never stack.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
const OUT = process.env.OUT || new URL("./shots/p4", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT/.test(m.text()) && errs.push(m.text()));
p.on("console", (m) => /AudioContext was not allowed/.test(m.text()) && errs.push("autoplay: " + m.text()));
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
await p.goto("http://localhost:3100/", { waitUntil: "networkidle" });
await p.evaluate((s) => { localStorage.setItem("nf:fighter", JSON.stringify(s)); localStorage.removeItem("nf:mute"); }, SET.find((d) => d.name === "clean").strokes);

// ---- sound: nothing before a gesture; running after one; ticks during the countdown; mute is saved
await p.goto("http://localhost:3100/play?countdown=3" + (process.env.Q ? "&" + process.env.Q : ""), { waitUntil: "networkidle" });
await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
const before = await p.evaluate(() => window.__nf.sfx.state);
await p.keyboard.press("a");
await p.waitForFunction(() => window.__nf.sfx.state === "running", null, { timeout: 5000 }).catch(() => {});
const after = await p.evaluate(() => window.__nf.sfx.state);
await p.waitForTimeout(3300);
const snd = await p.evaluate(() => ({ played: window.__nf.sfx.played, errors: window.__nf.sfx.errors }));
check(before === "none" && after === "running" && snd.played >= 2 && snd.errors.length === 0, `audio: before gesture "${before}", after a key "${after}"; ${snd.played} sounds by FIGHT! (ticks + bell), errors ${JSON.stringify(snd.errors)}`);
await p.getByTestId("mute").click();
const saved = await p.evaluate(() => localStorage.getItem("nf:mute"));
await p.reload({ waitUntil: "networkidle" });
await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
const label = await p.getByTestId("mute").innerText();
const mutedObj = await p.evaluate(() => window.__nf.sfx.muted);
await p.getByTestId("mute").click();
const unsaved = await p.evaluate(() => localStorage.getItem("nf:mute"));
check(saved === "1" && /off/.test(label) && mutedObj && unsaved === "0", `mute: saved "${saved}", after reload "${label}" (muted ${mutedObj}); unmute saves "${unsaved}"`);

// ---- hit-stop: count frozen frames after a jab and after a kick
await p.goto("http://localhost:3100/play?ai=off&rivalPower=none" + (process.env.Q ? "&" + process.env.Q : ""), { waitUntil: "networkidle" });
await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
await p.keyboard.press("Shift"); // a gesture: sound on
const stop = async (move) =>
  p.evaluate((move) => {
    const n = window.__nf;
    n.paused = true;
    n.sim.reset();
    n.sim.fighters[0].x = -0.3;
    n.sim.fighters[1].x = 0.3;
    n.advance(5);
    n.advance(1, { [move]: true });
    let hitAt = -1;
    let frozen = 0;
    let maxStop = 0;
    let prev = JSON.stringify(n.sim.curr.fighters.map((f) => f.joints));
    for (let i = 0; i < 60; i++) {
      const hp = n.sim.fighters[1].hp;
      n.advance(1);
      const now = JSON.stringify(n.sim.curr.fighters.map((f) => f.joints));
      if (hitAt < 0 && n.sim.fighters[1].hp < hp) {
        hitAt = i;
        maxStop = n.sim.hitstop;
      }
      if (hitAt >= 0 && i > hitAt && now === prev) frozen++;
      if (hitAt >= 0 && i > hitAt + 14) break;
      prev = now;
    }
    return { hitAt, frozen, maxStop, squash: n.view.squash[1].amp, dmg: n.sim.fighters[1].stats.hp - n.sim.fighters[1].hp };
  }, move);
const jab = await stop("punch");
const kick = await stop("kick");
check(jab.hitAt >= 0 && jab.frozen >= 2 && kick.frozen > jab.frozen && jab.squash > 0.3, `hit-stop: jab ${jab.dmg.toFixed(1)} dmg → ${jab.frozen} frozen frames; kick ${kick.dmg.toFixed(1)} dmg → ${kick.frozen} frozen frames; receiver squash ${jab.squash.toFixed(2)}`);
// a picture of a hit-stop frame: a kick, frozen right after contact
await p.evaluate(() => {
  const n = window.__nf;
  n.sim.reset();
  n.sim.fighters[0].x = -0.3;
  n.sim.fighters[1].x = 0.3;
  n.advance(5);
  n.advance(1, { kick: true });
  for (let i = 0; i < 60; i++) {
    const hp = n.sim.fighters[1].hp;
    n.advance(1);
    if (n.sim.fighters[1].hp < hp) break;
  }
  n.view.caption = `HIT-STOP: frozen ${n.sim.hitstop + 1} frames`;
  n.advance(1);
  n.view.caption = null;
});
await p.screenshot({ path: `${OUT}/hitstop.png` });

// ---- K.O.: slow-mo, camera punch-in, auto replay
await p.evaluate(() => {
  const n = window.__nf;
  n.sim.reset();
  n.sim.fighters[0].x = -0.3;
  n.sim.fighters[1].x = 0.3;
  n.sim.fighters[1].hp = 4;
  n.advance(30);
  n.paused = false;
});
let zoom = 0;
for (let i = 0; i < 20; i++) {
  const over = await p.evaluate(() => window.__nf.sim.curr.over);
  if (over) break;
  await p.keyboard.press(i % 2 ? "g" : "f");
  await p.waitForTimeout(350);
}
for (let i = 0; i < 10; i++) {
  zoom = Math.max(zoom, await p.evaluate(() => window.__nf.view.lastZoom));
  await p.waitForTimeout(60);
}
const slow = await p.evaluate(() => ({ over: window.__nf.sim.curr.over, slowmo: window.__nf.stats.slowmoSteps, ko: window.__nf.sim.fighters[1].ko }));
await p.waitForFunction(() => document.querySelector(".stage").dataset.replay === "on", null, { timeout: 6000 }).catch(() => {});
const rep1 = await p.evaluate(() => ({ attr: document.querySelector(".stage").dataset.replay, caption: window.__nf.view.caption }));
await p.waitForTimeout(2200);
await p.screenshot({ path: `${OUT}/ko_replay.png` });
await p.waitForFunction(() => document.querySelector(".stage").dataset.replay === "off", null, { timeout: 15000 }).catch(() => {});
const rep2 = await p.evaluate(() => ({ replays: window.__nf.stats.replays, banner: document.querySelector('[data-testid="banner"]').innerText.replace(/\n/g, " ") }));
check(slow.ko && slow.slowmo > 10 && zoom > 0.15, `K.O.: slow-mo for ${slow.slowmo} frames, camera punch-in ${zoom.toFixed(2)}`);
check(rep1.attr === "on" && /REPLAY/.test(rep1.caption ?? "") && rep2.replays === 1 && /K\.O\./.test(rep2.banner), `auto replay: ${rep1.caption} → done (${rep2.replays}), back to "${rep2.banner.slice(0, 40)}"`);

// ---- Save clip → a WebM download
const dl = p.waitForEvent("download", { timeout: 60000 });
await p.getByTestId("save-clip").click();
const recording = await p.getByTestId("save-clip").innerText();
const download = await dl;
const file = `${OUT}/${download.suggestedFilename()}`;
await download.saveAs(file);
const buf = fs.readFileSync(file);
const ebml = buf.subarray(0, 4).toString("hex");
let probe = "";
try {
  probe = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames", "-of", "default=nw=1", file]).toString().replace(/\n/g, " ");
} catch (e) {
  probe = "ffprobe failed: " + String(e).slice(0, 120);
}
const frames = Number(/nb_read_frames=(\d+)/.exec(probe)?.[1] ?? 0);
check(/recording/.test(recording) && buf.length > 20000 && ebml === "1a45dfa3" && buf.includes(Buffer.from("webm")) && frames > 60, `clip: ${file} (${buf.length} bytes, EBML ${ebml}, ${probe.trim()})`);
fs.writeFileSync(`${OUT}/clip_path.txt`, file + "\n");
// a frame from the middle of the clip, to look at
try {
  execFileSync("ffmpeg", ["-y", "-v", "error", "-sseof", "-3", "-i", file, "-frames:v", "1", `${OUT}/clip_frame.png`]);
} catch {
  /* optional */
}

// ---- 2P tags never stack
await p.evaluate((s) => { localStorage.setItem("nf:fighter", JSON.stringify(s[0])); localStorage.setItem("nf:fighter2", JSON.stringify(s[1])); }, [SET.find((d) => d.name === "power_fire").strokes, SET.find((d) => d.name === "power_ice").strokes]);
await p.goto("http://localhost:3100/play?mode=2p&countdown=0" + (process.env.Q ? "&" + process.env.Q : ""), { waitUntil: "networkidle" });
await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
const tags = await p.evaluate(() => {
  const n = window.__nf;
  n.paused = true;
  n.sim.fighters[0].x = 0.02;
  n.sim.fighters[1].x = -0.02;
  n.advance(1);
  const t = n.view.tagPos;
  return { dx: Math.abs(t[0].x - t[1].x), dy: Math.abs(t[0].y - t[1].y) };
});
await p.screenshot({ path: `${OUT}/tags_overlap.png` });
check(tags.dx > 30, `2P tags slide apart when the fighters overlap: ${tags.dx.toFixed(0)} px apart`);
check(errs.length === 0, `no page errors ${errs.slice(0, 3)}`);
console.log(bad ? `${bad} FAILURES` : "FEEL OK");
await b.close();
process.exit(bad ? 1 : 0);
