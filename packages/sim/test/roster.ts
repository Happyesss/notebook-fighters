// Headless: the computer's pre-drawn roster reads as the fighters they are meant to be (no stray tails or
// extra limbs), with sensible stats; the computer's pick follows the level; drawing quality is scored
// and its bonus stays capped.
import { ROSTER, pickRival, inferRig, computeStats, QUALITY_HP, QUALITY_DMG, NotebookSim, createSim, rivalProfile, moveDamage, moveStriker, AI_PROFILES } from "../src/index";
import { DRAWINGS, POWERED } from "./drawings";
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
for (const r of ROSTER) {
  const rig = inferRig(r.strokes)!;
  const st = computeStats(rig);
  const want = r.id === "dog" ? "quadruped" : "biped";
  const stray = r.id === "dog" ? [] : rig.parts.filter((p) => /tail|extra arm|extra leg|both legs|both arms|power:/.test(p));
  const ys = r.strokes.flatMap((s) => s.points.map((q) => q.y));
  const height = Math.max(...ys) - Math.min(...ys);
  check(
    rig.plan === want && !stray.length && st.hp >= 95 && st.hp <= 140 && (r.id !== "swordsman" || !!rig.weapon) && (r.id === "dog" || height > 0.75),
    `${r.name.padEnd(12)} ${rig.plan} · ${rig.kind} · HP ${st.hp} · punch ×${st.dmg.punch} kick ×${st.dmg.kick} · speed ×${st.speed} · quality ${st.quality.score} · height ${height.toFixed(2)}${stray.length ? " · stray: " + stray.join(",") : ""}`,
  );
}
// costumes (outlines, masks, belts) are drawn but never read: same reading and stats without them
{
  const diff = ROSTER.filter((r) => {
    const a = inferRig(r.strokes)!;
    const b = inferRig(r.strokes.filter((x) => !x.deco))!;
    return a.parts.join() !== b.parts.join() || JSON.stringify(computeStats(a).dmg) !== JSON.stringify(computeStats(b).dmg) || computeStats(a).hp !== computeStats(b).hp;
  });
  const n = ROSTER.reduce((k, r) => k + r.strokes.filter((x) => x.deco).length, 0);
  check(diff.length === 0 && n >= 25, `${n} costume lines; reading and stats unchanged by them${diff.length ? " — changed: " + diff.map((r) => r.id).join(",") : ""}`);
}
const tiers = (["easy", "normal", "hard"] as const).map((d) => [d, DRAWINGS.slice(0, 6).map((x) => pickRival(x.strokes, d).id)] as const);
check(tiers[0][1].every((id) => ["kid", "dog"].includes(id)) && tiers[2][1].every((id) => ["bodybuilder", "pehelwan"].includes(id)) && new Set(tiers[1][1]).size >= 2, `computer picks: ${tiers.map(([d, ids]) => `${d} → ${[...new Set(ids)].join("/")}`).join(" · ")}`);
const sim = new NotebookSim({ player: DRAWINGS[0].strokes, rivalId: "bodybuilder", ai: "off" });
check(sim.rivalEntry?.id === "bodybuilder" && sim.fighters[1].rig.plan === "biped", `?rival=bodybuilder → ${sim.rivalEntry?.name}, ${sim.fighters[1].rig.kind}`);
// quality: careful drawings score higher than scrappy ones; the bonus never passes the cap
const q = (name: string) => computeStats(inferRig(DRAWINGS.find((d) => d.name === name)!.strokes)!).quality;
const all = DRAWINGS.map((d) => computeStats(inferRig(d.strokes)!).quality);
check(q("clean").score > q("loneCircle").score && q("swordsman").score > q("plusSign").score, `quality: clean ${q("clean").score} > lone circle ${q("loneCircle").score} · swordsman ${q("swordsman").score} > plus sign ${q("plusSign").score}`);
check(all.every((x) => x.hp <= QUALITY_HP + 1e-9 && x.dmg <= QUALITY_DMG + 1e-9), `quality bonus capped: max HP +${Math.round(Math.max(...all.map((x) => x.hp)) * 100)}% (cap ${QUALITY_HP * 100}%), hits +${Math.round(Math.max(...all.map((x) => x.dmg)) * 100)}% (cap ${QUALITY_DMG * 100}%)`);
// the home page's character cards (rivalProfile) show exactly the fight's numbers: same HP, multipliers,
// speed, reach, power and per-hit damage as the rival in a /play-style sim (rival power "auto")
{
  const off: string[] = [];
  let n = 0;
  for (const d of ["easy", "normal", "hard"] as const)
    for (const player of [null, POWERED.fire.strokes])
      for (const id of [...ROSTER.map((r) => r.id), "auto" as const]) {
        const pr = rivalProfile(id, d, player);
        const live = await createSim({ player, rivalId: id, rivalPower: "auto", difficulty: d, ai: "on", physics: "classic" });
        const f = live.fighters[1];
        const hit = moveDamage(f.anim.moves.punch) * f.stats.dmg[moveStriker(f.anim.moves.punch)] * AI_PROFILES[d].rivalDmg;
        const same = pr.id === live.rivalEntry?.id && pr.hp === f.stats.hp && JSON.stringify(pr.dmg) === JSON.stringify(f.stats.dmg) && pr.speed === f.stats.speed && pr.reach === f.stats.reach && (pr.special?.kind ?? null) === f.special && pr.size === f.size && Math.abs(pr.moves[0].damage - hit) < 0.051;
        if (!same) off.push(`${id}/${d}/${player ? "fire" : "none"}`);
        n++;
        live.destroy();
      }
  const bb = rivalProfile("bodybuilder", "hard", null);
  check(off.length === 0, `character cards = the fight's numbers in ${n - off.length}/${n} rival × level × drawing cases${off.length ? " — differ: " + off.join(", ") : ""} (e.g. Bodybuilder on Hard: HP ${bb.hp}, ${bb.moves.map((m) => `${m.title} ${m.damage}`).join(", ")}, speed ×${bb.speed}, special ${bb.special?.move ?? "none"})`);
}
console.log(bad ? `${bad} FAIL` : "ROSTER OK");
process.exit(bad ? 1 : 0);
