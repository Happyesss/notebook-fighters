import { inferRig, shapeOf, resample } from "../src/index";
import { DRAWINGS, SCRIBBLED } from "./drawings";
for (const d of [...DRAWINGS, ...Object.entries(SCRIBBLED).map(([name, strokes]) => ({ name, strokes }))]) {
  const rig = inferRig(d.strokes)!;
  const out = d.strokes.map((s, i) => { const H = 0.8; const pts = resample(s.points.map(p => ({ x: p.x / H, y: -p.y / H })), 0.012); const sh = shapeOf(pts, false); return `${i}:${sh.shape}(c${sh.corners},i${sh.inflections},t${sh.turning.toFixed(1)})=${rig.parts[i]}`; });
  console.log(d.name.padEnd(14), out.join("  "));
}
