// The new rivals and the signature specials: the home roster lists Halloween and Skeleton just before
// the Bodybuilder, their character cards and the rival picker show their own specials, and in a fight
// each special shows on screen (pumpkin in the air, bone pile, shockwave, mega leap). Screenshots into OUT.
import { chromium, devices } from "playwright";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8797";
const OUT = process.env.OUT || new URL("./shots/rivals", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"] });
let bad = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const errs = [];
const page = async (opts) => {
  const ctx = await b.newContext(opts);
  await ctx.addInitScript(() => localStorage.setItem("nf:guide-seen", "1"));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(String(e)));
  return p;
};
const WANT = { halloween: "Throw pumpkin", skeleton: "Bone scatter", pehelwan: "Ground shake", bodybuilder: "Mega leap" };

// home: the roster, the cards (desktop and phone)
for (const [tag, opts] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["iphone", devices["iPhone 13"]]]) {
  const p = await page(opts);
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const ids = await p.$$eval(".rival-grid .rival-card", (els) => els.map((e) => e.dataset.testid.replace("rival-", "")));
  check(ids.slice(-4).join(",") === "pehelwan,halloween,skeleton,bodybuilder", `${tag}: home roster ends ${ids.slice(-4).join(" → ")} (${ids.length} rivals)`);
  await p.locator(".rival-pick").scrollIntoViewIfNeeded();
  await p.locator(".rival-pick").screenshot({ path: `${OUT}/${tag}_home_rivals.png` });
  for (const id of ["halloween", "skeleton", "pehelwan", "bodybuilder"]) {
    await p.getByTestId(`rival-${id}`).click();
    await p.getByTestId("char-card").waitFor();
    const sp = await p.getByTestId("cc-special").innerText();
    const note = await p.locator(".char-card .cc-block").filter({ hasText: "Special move" }).locator(".cc-note").innerText();
    check(sp.includes(WANT[id]) && /own special/.test(note) && !/draws itself/.test(note), `${tag}: ${id} card → "${sp.slice(0, 70)}…" · "${note.slice(0, 60)}…"`);
    if (id === "halloween" || id === "skeleton" || tag === "desktop") await p.getByTestId("char-card").screenshot({ path: `${OUT}/${tag}_card_${id}.png` });
    await p.getByTestId("char-card-close").click();
  }
  if (tag === "desktop") {
    // the rival picker lists them too
    await p.evaluate(() => {
      const c = document.querySelector('[data-testid="slot-0"]');
      const r = c.getBoundingClientRect();
      const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: r.left + x * r.width, clientY: r.top + y * r.height }));
      const line = (pts) => {
        fire("pointerdown", ...pts[0]);
        for (const q of pts.slice(1)) fire("pointermove", ...q);
        fire("pointerup", ...pts[pts.length - 1]);
      };
      const circle = Array.from({ length: 20 }, (_, i) => [0.5 + 0.08 * Math.cos((i / 19) * Math.PI * 2), 0.17 + 0.08 * Math.sin((i / 19) * Math.PI * 2)]);
      line(circle);
      line([[0.5, 0.25], [0.5, 0.6]]);
      line([[0.5, 0.33], [0.38, 0.48]]);
      line([[0.5, 0.33], [0.62, 0.48]]);
      line([[0.5, 0.6], [0.42, 0.9]]);
      line([[0.5, 0.6], [0.58, 0.9]]);
    });
    await p.getByTestId("fight-cpu").click();
    await p.getByTestId("rival-picker").waitFor();
    const picks = await p.$$eval('[data-testid^="pick-"][role="radio"]', (els) => els.map((e) => e.dataset.testid.replace("pick-", "")));
    check(picks.includes("halloween") && picks.includes("skeleton"), `picker lists: ${picks.join(", ")}`);
    await p.getByTestId("pick-halloween").scrollIntoViewIfNeeded();
    await p.getByTestId("rival-picker").screenshot({ path: `${OUT}/desktop_picker.png` });
  }
  await p.context().close();
}

// each special in the arena (desktop 1280x800 and an iPhone in landscape)
for (const [tag, opts] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["iphone-land", { ...devices["iPhone 13 landscape"] }]]) {
  for (const [id, frames, what] of [["halloween", 34, "pumpkin"], ["skeleton", 14, "bones"], ["pehelwan", 34, "quake"], ["bodybuilder", 44, "leap"]]) {
    const p = await page(opts);
    await p.goto(`${BASE}/play?rival=${id}&ai=off&countdown=0`, { waitUntil: "networkidle" });
    await p.waitForFunction(() => window.__nf?.sim && window.__nf.view, null, { timeout: 30000 });
    const seen = await p.evaluate(([n, gap]) => {
      const nf = window.__nf;
      const sim = nf.sim;
      sim.fighters[0].x = -gap / 2;
      sim.fighters[1].x = gap / 2;
      sim.fighters[1].cool = 0;
      const idle = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
      let i = 0;
      sim.think = () => (i++ === 0 ? { ...idle, special: true } : idle);
      nf.paused = true;
      let st = null;
      const out = { pumpkin: 0, quake: 0, scatter: 0, top: 0 };
      for (let k = 0; k < n; k++) {
        st = nf.advance(1);
        out.pumpkin = Math.max(out.pumpkin, st.projectiles.filter((q) => q.kind === "pumpkin").length);
        out.quake = Math.max(out.quake, st.projectiles.filter((q) => q.kind === "quake").length);
        out.scatter = Math.max(out.scatter, st.fighters[1].scatter ?? 0);
        out.top = Math.max(out.top, st.fighters[1].y);
      }
      return { ...out, special: st.fighters[1].special };
    }, [frames, id === "bodybuilder" ? 3 : id === "halloween" ? 2.4 : 1.6]);
    const shown = what === "pumpkin" ? seen.pumpkin > 0 : what === "quake" ? seen.quake > 0 : what === "bones" ? seen.scatter > 0 : seen.top > 0.6;
    check(seen.special === what && shown, `${tag}: ${id} uses ${WANT[id]} on screen (${JSON.stringify(seen)})`);
    await p.screenshot({ path: `${OUT}/${tag}_special_${id}.png` });
    await p.context().close();
  }
}
check(errs.length === 0, `no page errors ${errs.slice(0, 3).join(" | ")}`);
await b.close();
console.log(bad ? `${bad} FAIL` : "RIVALS E2E OK");
process.exit(bad ? 1 : 0);
