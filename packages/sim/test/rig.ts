// Headless check: does the reader bind every drawn stroke to the right bones?
import { inferRig, BONE_NAMES, type InkStroke } from "../src/index";
const circle = (cx: number, cy: number, r: number, n = 24) => Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos((i / n) * 6.283) * r, y: cy + Math.sin((i / n) * 6.283) * r * 1.05 }));
const spiral = (cx: number, cy: number, r: number, turns = 2, n = 60) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; const a = t * turns * 6.283; const rr = r * (0.35 + 0.65 * t); return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr }; });
const L = (...p: number[][]) => p.map(([x, y]) => ({ x, y }));
const S = (color: string, points: { x: number; y: number }[]): InkStroke => ({ color, points });
const drawings: Record<string, { strokes: InkStroke[]; expect: string[] }> = {
  classic: {
    strokes: [
      S("ink", circle(0.5, 0.2, 0.08)),
      S("ink", L([0.5, 0.29], [0.505, 0.45], [0.5, 0.6])),
      S("ink", L([0.5, 0.36], [0.62, 0.42], [0.72, 0.33])),
      S("ink", L([0.5, 0.36], [0.4, 0.43], [0.3, 0.5])),
      S("ink", L([0.5, 0.6], [0.43, 0.75], [0.4, 0.9])),
      S("ink", L([0.5, 0.6], [0.58, 0.75], [0.62, 0.9])),
      S("hat", L([0.42, 0.13], [0.5, 0.03], [0.58, 0.13], [0.42, 0.13])),
      S("sword", L([0.72, 0.33], [0.8, 0.18])),
    ],
    expect: ["head", "torso+head", "upperArmF+foreArmF", "upperArmB+foreArmB", "thighB+shinB", "thighF+shinF", "head", "foreArmF"],
  },
  messy: {
    strokes: [
      S("ink", circle(0.46, 0.22, 0.1, 30)),
      S("face", spiral(0.46, 0.22, 0.05)),
      S("ink", L([0.46, 0.33], [0.47, 0.48], [0.46, 0.6], [0.38, 0.74], [0.33, 0.92])),
      S("ink", L([0.46, 0.6], [0.55, 0.76], [0.62, 0.92])),
      S("ink", L([0.22, 0.48], [0.33, 0.41], [0.46, 0.38], [0.6, 0.41], [0.72, 0.5])),
      S("hair", L([0.38, 0.14], [0.4, 0.06], [0.44, 0.12], [0.47, 0.04], [0.5, 0.12], [0.54, 0.05], [0.55, 0.15])),
      S("cape", L([0.45, 0.37], [0.36, 0.45], [0.3, 0.58], [0.27, 0.68])),
    ],
    expect: ["head", "head", "torso+head+thighB+shinB", "thighF+shinF", "upperArmB+foreArmB+upperArmF+foreArmF", "head", "torso"],
  },
};
let fail = 0;
for (const [name, d] of Object.entries(drawings)) {
  const rig = inferRig(d.strokes)!;
  console.log(`\n== ${name}: found`, JSON.stringify(rig.found), "extras", rig.extras);
  rig.strokes.forEach((s, i) => {
    const bones = [...new Set(s.points.map((p) => BONE_NAMES[p.b0]))];
    const want = d.expect[i].split("+");
    const ok = want.every((w) => bones.includes(w)) && bones.every((b) => want.includes(b) || (want.length > 1 && b === "torso"));
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} stroke ${i} (${d.strokes[i].color}) part=${s.part} bones=${bones.join("+")} want=${d.expect[i]}`);
  });
}
console.log(fail ? `\n${fail} FAILURES` : "\nALL OK");
process.exit(fail ? 1 : 0);
