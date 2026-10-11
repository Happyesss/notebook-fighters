/**
 * The notebook's ink: the stroke type the drawing boxes edit, the coloured pencils, the painter
 * (the same graphite look as the arena) and the eraser (which really cuts strokes, so the reader
 * and the quality score only ever see the lines that are left).
 */
export type Pt = { x: number; y: number };
/** points are normalised 0..1 over the 3:4 drawing box; w is the line weight (1 = pencil) */
export type Stroke = { color: string; points: Pt[]; w?: number; deco?: "head" | "torso" | "auto" };

export const PENCILS = [
  { name: "Pencil", color: "#2a241c" },
  { name: "Red", color: "#c23b32" },
  { name: "Blue", color: "#1d4f89" },
  { name: "Green", color: "#2f7d4a" },
  { name: "Orange", color: "#e07a2f" },
  { name: "Purple", color: "#6d4ca8" },
  { name: "Gold", color: "#c4962c" },
  { name: "Pink", color: "#d45d8c" },
];

/** line weights for the big drawing pad (1 = the normal pencil) */
export const BRUSHES = [
  { name: "Fine", w: 0.6 },
  { name: "Pencil", w: 1 },
  { name: "Bold", w: 1.6 },
  { name: "Marker", w: 2.4 },
];

/** the drawing box is 3 wide by 4 tall: distances are measured in box widths on both axes */
export const BOX_ASPECT = 3 / 4;
/** points closer than this (in box units, squared) to the last one are skipped while drawing */
export const MIN_STEP2 = 0.00004;

export function hasInk(strokes: Stroke[]) {
  return strokes.some((stroke) => stroke.points.length > 1);
}

export function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function fit(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

/** paints the strokes like coloured pencil: a faint, slightly wider graphite pass, then the line */
export function paintInk(canvas: HTMLCanvasElement | null, strokes: Stroke[]) {
  if (!canvas) return;
  const size = fit(canvas);
  if (!size) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size.w, size.h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.points.length < 1) continue;
    // fine pencil lines (w < 1) still get at least ~0.5 css px so they read on the small card
    const width = Math.max(0.5 * size.dpr, Math.max(2, size.w * 0.012) * (stroke.w ?? 1));
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    if (stroke.points.length === 1) {
      // a dot (shown while drawing, dropped when the stroke ends)
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(stroke.points[0].x * size.w, stroke.points[0].y * size.h, width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = width * 1.45;
    trace(ctx, stroke.points, size.w, size.h);
    ctx.stroke();
    ctx.globalAlpha = 0.93;
    ctx.lineWidth = width;
    trace(ctx, stroke.points, size.w, size.h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function trace(ctx: CanvasRenderingContext2D, pts: Pt[], w: number, h: number) {
  ctx.beginPath();
  pts.forEach((pt, i) => {
    if (i === 0) ctx.moveTo(pt.x * w, pt.y * h);
    else ctx.lineTo(pt.x * w, pt.y * h);
  });
}

/** distance from p to the segment ab, in box widths (y is scaled by the 3:4 box) */
function segDist(p: Pt, a: Pt, b: Pt) {
  const ky = 1 / BOX_ASPECT;
  const px = p.x, py = p.y * ky, ax = a.x, ay = a.y * ky, bx = b.x, by = b.y * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Rubs out everything within `radius` (box widths) of the eraser's path a→b. Strokes it crosses are
 * cut into the pieces that remain (each keeps its colour, weight and costume tag); pieces too short
 * to be a line are dropped. Returns the same array when nothing was touched.
 */
export function eraseStrokes(strokes: Stroke[], a: Pt, b: Pt, radius: number): Stroke[] {
  let changed = false;
  const out: Stroke[] = [];
  const ky = 1 / BOX_ASPECT;
  for (const stroke of strokes) {
    const pts = stroke.points;
    // quick reject on the stroke's bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const rx = radius, ry = radius * BOX_ASPECT;
    if (maxX < Math.min(a.x, b.x) - rx || minX > Math.max(a.x, b.x) + rx || maxY < Math.min(a.y, b.y) - ry || minY > Math.max(a.y, b.y) + ry) {
      out.push(stroke);
      continue;
    }
    // densify so a long straight segment through the eraser is cut, not skipped
    const step = radius * 0.5;
    const dense: Pt[] = [];
    const orig: boolean[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) {
        const p0 = pts[i - 1], p1 = pts[i];
        const d = Math.hypot(p1.x - p0.x, (p1.y - p0.y) * ky);
        const n = Math.min(200, Math.floor(d / step));
        for (let k = 1; k < n; k++) {
          dense.push({ x: p0.x + ((p1.x - p0.x) * k) / n, y: p0.y + ((p1.y - p0.y) * k) / n });
          orig.push(false);
        }
      }
      dense.push(pts[i]);
      orig.push(true);
    }
    const hit = dense.map((p) => segDist(p, a, b) <= radius);
    if (!hit.some(Boolean)) {
      out.push(stroke);
      continue;
    }
    changed = true;
    let run: number[] = [];
    const flush = () => {
      // keep the drawn points plus the two new ends where the eraser cut
      const keep = run.filter((k, j) => orig[k] || j === 0 || j === run.length - 1).map((k) => dense[k]);
      if (keep.length > 1 && arcLen(keep) > 0.004) {
        out.push({ ...stroke, points: keep.map((p) => ({ x: round4(p.x), y: round4(p.y) })) });
      }
      run = [];
    };
    dense.forEach((_, i) => {
      if (hit[i]) flush();
      else run.push(i);
    });
    flush();
  }
  return changed ? out : strokes;
}

function arcLen(pts: Pt[]) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, (pts[i].y - pts[i - 1].y) / BOX_ASPECT);
  return d;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
