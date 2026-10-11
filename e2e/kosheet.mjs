// KO contact sheet: every drawing knocked out by a kick, classic verlet vs Rapier, mid-fall and at rest.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
const OUT = process.env.OUT || new URL("./shots/p5b", import.meta.url).pathname;
fs.mkdirSync(`${OUT}/ko`, { recursive: true });
const SET = JSON.parse(fs.readFileSync(new URL("./drawings.json", import.meta.url), "utf8"));
const NAMES = (process.env.NAMES || "clean,sloppy,fourArms,quadruped,blob,swordsman,plusSign,loneCircle,tree,car,snake,bigHead,power_fire,power_water,power_lightning,power_ice,power_wings,power_shield,power_spikes").split(",");
const R = process.env.RENDERER || "canvas";
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION/.test(m.text()) && errs.push(m.text()));
await p.goto("http://localhost:3100/", { waitUntil: "networkidle" });
const rows = [];
let bad = 0;
for (const name of NAMES) {
  const row = [];
  for (const phys of ["classic", "rapier"]) {
    await p.evaluate((s) => { localStorage.setItem("nf:fighter", JSON.stringify(s)); localStorage.setItem("nf:mute", "1"); }, SET.find((d) => d.name === name).strokes);
    const url = `http://localhost:3100/play?ai=off&countdown=0&rivalPower=none&physics=${phys}&renderer=${R}`;
    for (let t = 0; ; t++) {
      try {
        await p.goto(url, { waitUntil: "load", timeout: 90000 });
        break;
      } catch (e) {
        if (t >= 2) throw e;
      }
    }
    await p.waitForFunction(() => window.__nf?.sim && window.__nf?.view, null, { timeout: 60000 });
    // hide HUD/help panels so the crop shows only the stage
    await p.addStyleTag({ content: "body *{visibility:hidden !important} canvas{visibility:visible !important}" });
    const r = await p.evaluate(() => {
      const nf = window.__nf;
      nf.paused = true;
      const sim = nf.sim;
      // the rival KOs the player with a kick from close range
      sim.fighters[0].hp = 3;
      const [a, b] = sim.fighters;
      a.x = -0.7;
      b.x = a.x + a.rig.extent.front + b.rig.extent.front + 0.15;
      nf.advance(2);
      sim.forced.push({ who: 1, move: "kick" });
      for (let i = 0; i < 90 && !sim.curr.over; i++) nf.advance(1);
      nf.advance(22);
      const rd = sim.fighters[0].anim.ragdoll;
      return { over: sim.curr.over, kind: !rd ? "none" : "freed" in rd ? ("q" in rd || "rel" in rd ? "RapierTumble" : "RapierRagdoll") : "q" in rd ? "Ragdoll" : "Tumble", x: sim.fighters[0].x };
    });
    const clipFn = () => {
      const { view, sim } = window.__nf;
      const c = view.canvas.getBoundingClientRect();
      const k = c.width / view.canvas.width;
      const S = view.cam.scale * k;
      const f = sim.fighters[0];
      const xs = f.anim.joints.map((q) => f.x + f.facing * q.x);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const sx = c.left + c.width / 2 + (cx - view.cam.x) * S;
      return { x: Math.max(0, sx - S * 1.9), y: Math.max(0, c.top + c.height * 0.8 - S * 1.5), width: S * 3.8, height: S * 1.75 };
    };
    const clip = await p.evaluate(clipFn);
    await p.screenshot({ path: `${OUT}/ko/${name}_${phys}_fall.png`, clip });
    const rest = await p.evaluate(() => {
      window.__nf.advance(200);
      const j = window.__nf.sim.fighters[0].anim.joints;
      return { finite: j.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)), low: Math.min(...j.map((q) => q.y)), high: Math.max(...j.map((q) => q.y)) };
    });
    await p.screenshot({ path: `${OUT}/ko/${name}_${phys}_rest.png`, clip: await p.evaluate(clipFn) });
    const ok = r.over && rest.finite && rest.high < 2.5 && rest.low > -0.1 && (phys === "classic" || /Rapier/.test(r.kind));
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(16)} ${phys.padEnd(8)} ${r.kind.padEnd(14)} KO ${r.over} · rest joints y ${rest.low.toFixed(3)}..${rest.high.toFixed(2)}`);
    row.push(`${OUT}/ko/${name}_${phys}_fall.png`, `${OUT}/ko/${name}_${phys}_rest.png`);
  }
  rows.push([name, row]);
}
fs.writeFileSync(`${OUT}/ko/rows.json`, JSON.stringify(rows));
execFileSync("python3", ["-c", `
import json
from PIL import Image, ImageDraw
rows=json.load(open("${OUT}/ko/rows.json"))
W,H=300,138
im=Image.new("RGB",(110+4*W,24+len(rows)*H),(246,240,226)); d=ImageDraw.Draw(im)
for i,t in enumerate(["classic: falling","classic: at rest","RAPIER: falling","RAPIER: at rest"]): d.text((110+i*W+8,6),t,fill=(42,36,28))
for r,(name,files) in enumerate(rows):
  d.text((6,24+r*H+H//2),name,fill=(42,36,28))
  for c,f in enumerate(files): im.paste(Image.open(f).convert("RGB").resize((W-4,H-4)),(110+c*W,24+r*H))
im.save("${OUT}/ko_sheet.png")`]);
console.log(`sheet: ${OUT}/ko_sheet.png · page errors ${errs.length} ${errs.slice(0, 3).join(" | ")}`);
await b.close();
process.exit(bad + (errs.length ? 1 : 0));
