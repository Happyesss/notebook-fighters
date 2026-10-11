// Phase 7: real sound effects. Every file in public/sfx is served (200) and decodes (WebAudio); after a gesture the
// page decodes all samples into buffers; scripted fights play layered samples on the right frames: a swish on the
// frame the swing starts and an impact body on the frame the blow lands (deeper + a thump layer for the hulk), a clack
// on a block, specials have their own sounds, a K.O. plays big hit + boom + bell; the countdown ticks and FIGHT! rings.
// With the files blocked, the synth fallback still plays. No console errors.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
const BASE = process.env.BASE || "http://localhost:3100";
const DIR = new URL("../apps/web/public/sfx", import.meta.url).pathname;
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const files = fs.readdirSync(DIR).filter((f) => /\.(ogg|m4a)$/.test(f)).sort();
const credits = fs.readFileSync(DIR + "/CREDITS.md", "utf8");
const uncredited = [...new Set(files.map((f) => f.replace(/\.(ogg|m4a)$/, "")))].filter((n) => !credits.includes("`" + n + "`"));
check(files.length >= 80 && uncredited.length === 0, `${files.length} sound files (.ogg + .m4a); every one credited in CREDITS.md${uncredited.length ? " ✗ missing: " + uncredited : ""}`);

async function page(opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|fonts\.g/.test(m.text()) && errs.push(m.text()));
  if (opts.block) await p.route("**/sfx/**", (r) => r.abort());
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.evaluate((s) => { localStorage.setItem("nf:fighter", JSON.stringify(s)); localStorage.removeItem("nf:mute"); }, SET.find((d) => d.name === "clean").strokes);
  return { p, ctx, errs };
}

// ---- every file: 200 and decodable (Ogg in Chromium; .m4a fetched and its header checked: this Chromium has no AAC)
{
  const { p, ctx, errs } = await page();
  const res = await p.evaluate(async (files) => {
    const ac = new OfflineAudioContext(1, 44100, 44100);
    const out = [];
    for (const f of files) {
      const r = await fetch("/sfx/" + f);
      const buf = await r.arrayBuffer();
      let dur = null;
      let err = null;
      if (f.endsWith(".ogg")) {
        try { dur = (await ac.decodeAudioData(buf)).duration; } catch (e) { err = String(e); }
      } else {
        const tag = new TextDecoder().decode(new Uint8Array(buf.slice(4, 8)));
        dur = tag === "ftyp" ? 0 : null;
        if (dur === null) err = "not an MP4/M4A file";
      }
      out.push({ f, status: r.status, type: r.headers.get("content-type"), bytes: buf.byteLength, dur, err });
    }
    return out;
  }, files);
  const failed = res.filter((r) => r.status !== 200 || r.err || (r.f.endsWith(".ogg") && !(r.dur > 0.01)));
  const total = res.reduce((a, r) => a + r.bytes, 0);
  check(!failed.length, `all ${res.length} files: HTTP 200, ${res.filter((r) => r.f.endsWith(".ogg")).length} .ogg decode with WebAudio, .m4a are MP4 audio; ${Math.round(total / 1024)} KB in all${failed.length ? " ✗ " + JSON.stringify(failed.slice(0, 5)) : ""}`);
  check(errs.length === 0, `no console errors on load ${JSON.stringify(errs)}`);
  await ctx.close();
}

// ---- a scripted fight: layered samples on the exact frames
{
  const { p, ctx, errs } = await page();
  await p.goto(BASE + "/play?ai=off&rivalPower=none&rival=bodybuilder", { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  await p.keyboard.press("Shift"); // a gesture: the context starts and the samples decode
  await p.waitForFunction(() => window.__nf.sfx.state === "running" && window.__nf.sfx.sampleState.decoded === window.__nf.sfx.sampleState.total, null, { timeout: 15000 }).catch(() => {});
  const st = await p.evaluate(() => window.__nf.sfx.sampleState);
  check(st.decoded === st.total && !st.failed.length, `samples preloaded as WebAudio buffers: ${st.decoded}/${st.total} decoded (.${st.ext}), failed ${JSON.stringify(st.failed)}`);

  // step frame by frame: which samples start on which frame, versus the sim's own frames
  const strike = (who, move) =>
    p.evaluate(({ who, move }) => {
      const n = window.__nf;
      n.paused = true;
      n.sounds = true;
      n.sim.reset();
      const [me, foe] = who === 0 ? n.sim.fighters : [n.sim.fighters[1], n.sim.fighters[0]];
      n.sim.fighters[0].x = -0.35;
      n.sim.fighters[1].x = 0.35;
      n.advance(4);
      const frames = [];
      let swingAt = -1;
      let hitAt = -1;
      for (let i = 0; i < 60; i++) {
        const hp = foe.hp;
        const was = me.anim.move;
        const len = n.sfx.log.length;
        const input = { [move]: i === 0 };
        if (who === 0) n.advance(1, input);
        else n.advance(1, {}, input);
        const now = n.sfx.log.slice(len);
        if (swingAt < 0 && me.anim.move !== was && me.anim.move !== "idle" && me.anim.move !== "walk") swingAt = i;
        if (hitAt < 0 && foe.hp < hp) hitAt = i;
        if (now.length) frames.push({ i, now });
      }
      n.sounds = false;
      return { swingAt, hitAt, frames };
    }, { who, move });
  const at = (r, re) => r.frames.find((f) => f.now.some((s) => re.test(s)))?.i ?? -1;
  for (const [who, move, re] of [[0, "punch", /^punch_/], [0, "kick", /^kick_/]]) {
    const r = await strike(who, move);
    const sw = at(r, /^swish/);
    const hit = at(r, re);
    check(r.swingAt >= 0 && r.hitAt > r.swingAt && sw === r.swingAt && hit === r.hitAt, `${move}: swish on the swing-start frame (${sw} = ${r.swingAt}), ${re.source.slice(1, -1)}* on the contact frame (${hit} = ${r.hitAt}); layers ${JSON.stringify(r.frames.map((f) => f.now))}`);
  }
  // variants: several punches don't repeat the same sample back to back
  const seq = [];
  for (let k = 0; k < 6; k++) {
    const r = await strike(0, "punch");
    seq.push(...r.frames.flatMap((f) => f.now).filter((s) => /^punch_/.test(s)));
  }
  const repeats = seq.filter((s, i) => i && s === seq[i - 1]).length;
  check(new Set(seq).size >= 3 && repeats === 0, `punch variants: ${JSON.stringify(seq)} (${new Set(seq).size} different, ${repeats} back-to-back repeats)`);
  // the hulk (the computer's bodybuilder) attacks for real: P1 first holds block (a clack), then takes its blows
  // (impact + a deep thump layer on the frame P1's HP drops)
  await p.goto(BASE + "/play?countdown=0&rival=bodybuilder&rivalPower=none&level=hard", { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  await p.keyboard.press("Shift");
  await p.waitForFunction(() => window.__nf.sfx.sampleState.decoded === window.__nf.sfx.sampleState.total, null, { timeout: 15000 }).catch(() => {});
  const ai = await p.evaluate(() => {
    const n = window.__nf;
    n.paused = true;
    n.sounds = true;
    n.sim.reset();
    n.sim.fighters[0].x = -0.3;
    n.sim.fighters[1].x = 0.3;
    const me = n.sim.fighters[0];
    const blockLog = [];
    const hits = [];
    for (let i = 0; i < 900 && hits.length < 2; i++) {
      const hp = me.hp;
      const len = n.sfx.log.length;
      n.advance(1, { block: i < 300 });
      const now = n.sfx.log.slice(len);
      if (i < 300) blockLog.push(...now);
      else if (me.hp < hp) hits.push(now);
    }
    n.sounds = false;
    return { blockLog, hits, size: n.sim.fighters[1].size };
  });
  check(ai.blockLog.some((s) => /^block_/.test(s)), `block (P1 guards against the computer): ${JSON.stringify(ai.blockLog.filter((s) => /block/.test(s)))}`);
  check(ai.hits.length > 0 && ai.hits.every((h) => h.some((s) => /^heavy_/.test(s)) && h.some((s) => /^(punch|kick)_/.test(s))), `the hulk (size ${ai.size}) lands blows: ${JSON.stringify(ai.hits)} on the contact frames (impact + deep thump)`);
  // back to the scripted page for the rest
  await p.goto(BASE + "/play?ai=off&rivalPower=none&rival=bodybuilder", { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  await p.keyboard.press("Shift");
  await p.waitForFunction(() => window.__nf.sfx.sampleState.decoded === window.__nf.sfx.sampleState.total, null, { timeout: 15000 }).catch(() => {});
  // specials: their own sound each (played through the same mapping the sim's events use)
  const sp = await p.evaluate(() => {
    const n = window.__nf;
    const out = {};
    for (const k of ["fire", "water", "lightning", "ice", "wings", "shield", "spikes"]) {
      const len = n.sfx.log.length;
      n.sfx.play([{ kind: "special", x: 0, y: 0, power: k, dir: 1 }]);
      out[k] = n.sfx.log.slice(len);
    }
    return out;
  });
  check(Object.values(sp).every((v) => v.length === 1), `specials: ${Object.entries(sp).map(([k, v]) => `${k}→${v}`).join(", ")}`);
  // a K.O.: big hit + boom + bell, the body falls, the round-win jingle
  const ko = await p.evaluate(() => {
    const n = window.__nf;
    n.sounds = true;
    n.sim.reset();
    n.sim.fighters[0].x = -0.35;
    n.sim.fighters[1].x = 0.35;
    n.sim.fighters[1].hp = 1;
    n.advance(4);
    const len = n.sfx.log.length;
    for (let i = 0; i < 40; i++) n.advance(1, { kick: i === 0 });
    n.sounds = false;
    return { log: n.sfx.log.slice(len), over: n.sim.curr.over };
  });
  check(ko.log.includes("ko_bell") && ko.log.includes("ko_boom") && ko.log.filter((s) => /^heavy_/.test(s)).length >= 2 && ko.log.some((s) => /^round_win/.test(s)), `K.O.: ${JSON.stringify(ko.log)}`);
  const end = await p.evaluate(() => ({ errors: window.__nf.sfx.errors, played: window.__nf.sfx.played }));
  check(end.errors.length === 0 && errs.length === 0, `no audio errors (${end.played} sounds) and no console errors ${JSON.stringify([...end.errors, ...errs])}`);
  await ctx.close();
}

// ---- the countdown in a real (unscripted) round: ticks then the fight bell; hits during real play
{
  const { p, ctx, errs } = await page();
  await p.goto(BASE + "/play?countdown=3&rival=kid", { waitUntil: "networkidle" });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  await p.keyboard.press("Shift");
  await p.waitForFunction(() => window.__nf.sfx.sampleState.decoded === window.__nf.sfx.sampleState.total, null, { timeout: 15000 }).catch(() => {});
  await p.waitForFunction(() => window.__nf.sim.curr.countdown <= 0, null, { timeout: 15000 });
  await p.waitForTimeout(300);
  // walk in and trade blows with real key presses
  await p.keyboard.down("d");
  await p.waitForTimeout(700);
  await p.keyboard.up("d");
  for (let i = 0; i < 10; i++) {
    await p.keyboard.press(i % 2 ? "g" : "f");
    await p.waitForTimeout(260);
  }
  const log = await p.evaluate(() => window.__nf.sfx.log.slice());
  check(log.some((s) => /^tick_/.test(s)) && log.includes("fight_bell"), `countdown: ${JSON.stringify(log.filter((s) => /tick|bell/.test(s)))}`);
  check(log.some((s) => /^swish/.test(s)) && log.some((s) => /^(punch|kick)_/.test(s)), `real play with keys: ${log.filter((s) => /swish|punch|kick|heavy|block/.test(s)).length} swing/impact samples, e.g. ${JSON.stringify(log.slice(-8))}`);
  check(errs.length === 0, `no console errors ${JSON.stringify(errs)}`);
  await ctx.close();
}

// ---- fallback: the files can't load → the procedural sounds still play
{
  const { p, ctx, errs } = await page({ block: true });
  await p.goto(BASE + "/play?countdown=3&rival=kid", { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => window.__nf?.sim, null, { timeout: 30000 });
  await p.keyboard.press("Shift");
  await p.waitForTimeout(3500);
  const r = await p.evaluate(() => ({ played: window.__nf.sfx.played, log: window.__nf.sfx.log.length, st: window.__nf.sfx.sampleState, errors: window.__nf.sfx.errors }));
  check(r.st.decoded === 0 && r.st.failed.length === r.st.total && r.played >= 3 && r.log === 0 && r.errors.length === 0, `files blocked: ${r.st.failed.length}/${r.st.total} failed, synth fallback played ${r.played} sounds (ticks + bell), audio errors ${r.errors.length}`);
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} FAILED` : "SFX OK");
process.exit(bad ? 1 : 0);
