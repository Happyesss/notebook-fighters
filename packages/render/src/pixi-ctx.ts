/**
 * A CanvasRenderingContext2D-shaped front end over PixiJS v8 (WebGL), so the notebook renderer's
 * drawing code (pencil strokes, line-boil, smears, onomatopoeia, the KO scribble) runs unchanged
 * on Pixi: paths are flattened to screen space here (transform stack applied on the CPU) and
 * replayed into pooled Pixi Graphics; text becomes pooled Pixi Text. Draw order is kept by
 * starting a new Graphics layer after every text.
 */
import type * as PIXI_NS from "pixi.js";

type Pixi = typeof PIXI_NS;
type M = [number, number, number, number, number, number]; // a b c d e f
type Cmd = { k: "M" | "L"; x: number; y: number } | { k: "Q"; cx: number; cy: number; x: number; y: number } | { k: "Z" };
type State = {
  m: M;
  alpha: number;
  stroke: string;
  fill: string;
  width: number;
  cap: CanvasLineCap;
  join: CanvasLineJoin;
  font: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
};

const colorCache = new Map<string, [number, number]>();
export function parseColor(c: string): [number, number] {
  const hit = colorCache.get(c);
  if (hit) return hit;
  let out: [number, number] = [0, 1];
  const s = c.trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = [...h].map((x) => x + x).join("");
    out = [parseInt(h.slice(0, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  } else {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b, a] = m[1].split(",").map((x) => parseFloat(x));
      out = [((r & 255) << 16) | ((g & 255) << 8) | (b & 255), a === undefined || Number.isNaN(a) ? 1 : a];
    }
  }
  colorCache.set(c, out);
  return out;
}

export class PixiCtx {
  private pixi: Pixi;
  private app: PIXI_NS.Application;
  private gPool: PIXI_NS.Graphics[] = [];
  private gi = 0;
  private g: PIXI_NS.Graphics | null = null;
  private tPool = new Map<string, PIXI_NS.Text[]>();
  private tUsed = new Map<string, number>();
  private path: Cmd[] = [];
  private st: State;
  private stack: State[] = [];
  private measurer: CanvasRenderingContext2D | null = null;
  /** draw calls this frame (for the benchmark) */
  ops = 0;
  canvas: HTMLCanvasElement;

  constructor(pixi: Pixi, app: PIXI_NS.Application, canvas: HTMLCanvasElement) {
    this.pixi = pixi;
    this.app = app;
    this.canvas = canvas;
    this.st = PixiCtx.fresh();
  }
  private static fresh(): State {
    return { m: [1, 0, 0, 1, 0, 0], alpha: 1, stroke: "#000", fill: "#000", width: 1, cap: "butt", join: "miter", font: '10px sans-serif', align: "start", baseline: "alphabetic" };
  }

  // ---- frame
  begin() {
    this.app.stage.removeChildren();
    this.gi = 0;
    this.g = null;
    this.tUsed.clear();
    this.st = PixiCtx.fresh();
    this.stack = [];
    this.path = [];
    this.ops = 0;
  }
  end() {
    for (const [key, list] of this.tPool) {
      const used = this.tUsed.get(key) ?? 0;
      // drop texts not seen for a while (onomatopoeia come and go)
      if (list.length > used + 4) for (const t of list.splice(used + 4)) t.destroy();
    }
    this.app.renderer.render(this.app.stage);
  }
  resize(w: number, h: number) {
    this.app.renderer.resize(w, h);
  }
  private layer(): PIXI_NS.Graphics {
    if (this.g) return this.g;
    let g = this.gPool[this.gi];
    if (!g) {
      g = new this.pixi.Graphics();
      this.gPool.push(g);
    }
    this.gi++;
    g.clear();
    this.app.stage.addChild(g);
    this.g = g;
    return g;
  }

  // ---- state
  save() {
    this.stack.push({ ...this.st, m: [...this.st.m] as M });
  }
  restore() {
    const s = this.stack.pop();
    if (s) this.st = s;
  }
  set globalAlpha(v: number) {
    this.st.alpha = v;
  }
  get globalAlpha() {
    return this.st.alpha;
  }
  set strokeStyle(v: string) {
    this.st.stroke = v;
  }
  get strokeStyle() {
    return this.st.stroke;
  }
  set fillStyle(v: string) {
    this.st.fill = v;
  }
  get fillStyle() {
    return this.st.fill;
  }
  set lineWidth(v: number) {
    this.st.width = v;
  }
  get lineWidth() {
    return this.st.width;
  }
  set lineCap(v: CanvasLineCap) {
    this.st.cap = v;
  }
  get lineCap() {
    return this.st.cap;
  }
  set lineJoin(v: CanvasLineJoin) {
    this.st.join = v;
  }
  get lineJoin() {
    return this.st.join;
  }
  set font(v: string) {
    this.st.font = v;
  }
  get font() {
    return this.st.font;
  }
  set textAlign(v: CanvasTextAlign) {
    this.st.align = v;
  }
  get textAlign() {
    return this.st.align;
  }
  set textBaseline(v: CanvasTextBaseline) {
    this.st.baseline = v;
  }
  get textBaseline() {
    return this.st.baseline;
  }

  // ---- transform (canvas semantics: new = current × op)
  private mul(n: M) {
    const [a, b, c, d, e, f] = this.st.m;
    this.st.m = [a * n[0] + c * n[1], b * n[0] + d * n[1], a * n[2] + c * n[3], b * n[2] + d * n[3], a * n[4] + c * n[5] + e, b * n[4] + d * n[5] + f];
  }
  translate(x: number, y: number) {
    this.mul([1, 0, 0, 1, x, y]);
  }
  scale(x: number, y: number) {
    this.mul([x, 0, 0, y, 0, 0]);
  }
  rotate(r: number) {
    const c = Math.cos(r);
    const s = Math.sin(r);
    this.mul([c, s, -s, c, 0, 0]);
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.st.m = [a, b, c, d, e, f];
  }
  private tx(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.st.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }
  private get unit() {
    const [a, b, c, d] = this.st.m;
    return Math.sqrt(Math.abs(a * d - b * c)) || 1;
  }

  // ---- paths (stored in screen space)
  beginPath() {
    this.path = [];
  }
  moveTo(x: number, y: number) {
    const [X, Y] = this.tx(x, y);
    this.path.push({ k: "M", x: X, y: Y });
  }
  lineTo(x: number, y: number) {
    const [X, Y] = this.tx(x, y);
    this.path.push({ k: this.path.length ? "L" : "M", x: X, y: Y });
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    const [CX, CY] = this.tx(cx, cy);
    const [X, Y] = this.tx(x, y);
    if (!this.path.length) this.path.push({ k: "M", x: CX, y: CY });
    this.path.push({ k: "Q", cx: CX, cy: CY, x: X, y: Y });
  }
  closePath() {
    this.path.push({ k: "Z" });
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false) {
    this.ellipse(x, y, r, r, 0, a0, a1, ccw);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false) {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep += Math.PI * 2;
    if (ccw && sweep > 0) sweep -= Math.PI * 2;
    sweep = Math.max(-Math.PI * 2, Math.min(Math.PI * 2, sweep));
    const px = Math.max(rx, ry) * this.unit;
    const n = Math.max(8, Math.min(64, Math.ceil((Math.abs(sweep) * Math.sqrt(px)) / 0.9)));
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      const ex = Math.cos(t) * rx;
      const ey = Math.sin(t) * ry;
      const [X, Y] = this.tx(x + ex * cr - ey * sr, y + ex * sr + ey * cr);
      this.path.push({ k: i === 0 && !this.path.length ? "M" : "L", x: X, y: Y });
    }
  }
  private replay(g: PIXI_NS.Graphics, cmds: Cmd[]) {
    g.beginPath();
    let px = 0;
    let py = 0;
    for (const c of cmds) {
      if (c.k === "M") g.moveTo((px = c.x), (py = c.y));
      else if (c.k === "L") g.lineTo((px = c.x), (py = c.y));
      else if (c.k === "Q") {
        // flatten here (a few px per segment): Pixi's own curve subdivision is the slow part of a frame
        const len = Math.hypot(c.cx - px, c.cy - py) + Math.hypot(c.x - c.cx, c.y - c.cy);
        const n = Math.max(1, Math.min(8, Math.ceil(len / 7)));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          g.lineTo(u * u * px + 2 * u * t * c.cx + t * t * c.x, u * u * py + 2 * u * t * c.cy + t * t * c.y);
        }
        px = c.x;
        py = c.y;
      } else g.closePath();
    }
  }
  stroke() {
    if (this.path.length < 2) return;
    const g = this.layer();
    const [color, a] = parseColor(this.st.stroke);
    this.replay(g, this.path);
    g.stroke({ width: this.st.width * this.unit, color, alpha: a * this.st.alpha, cap: this.st.cap, join: this.st.join });
    this.ops++;
  }
  fill() {
    if (this.path.length < 3) return;
    const g = this.layer();
    const [color, a] = parseColor(this.st.fill);
    this.replay(g, this.path);
    g.fill({ color, alpha: a * this.st.alpha });
    this.ops++;
  }
  private rectPath(x: number, y: number, w: number, h: number): Cmd[] {
    const p = [this.tx(x, y), this.tx(x + w, y), this.tx(x + w, y + h), this.tx(x, y + h)];
    return [{ k: "M", x: p[0][0], y: p[0][1] }, ...p.slice(1).map(([X, Y]) => ({ k: "L" as const, x: X, y: Y })), { k: "Z" }];
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const g = this.layer();
    const [color, a] = parseColor(this.st.fill);
    this.replay(g, this.rectPath(x, y, w, h));
    g.fill({ color, alpha: a * this.st.alpha });
    this.ops++;
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    const g = this.layer();
    const [color, a] = parseColor(this.st.stroke);
    this.replay(g, this.rectPath(x, y, w, h));
    g.stroke({ width: this.st.width * this.unit, color, alpha: a * this.st.alpha, cap: this.st.cap, join: this.st.join });
    this.ops++;
  }

  // ---- text
  measureText(text: string): TextMetrics {
    if (!this.measurer) this.measurer = document.createElement("canvas").getContext("2d");
    if (!this.measurer) return { width: text.length * 8 } as TextMetrics;
    this.measurer.font = this.st.font;
    return this.measurer.measureText(text);
  }
  private pendingStroke: { text: string; x: number; y: number; color: string; width: number } | null = null;
  strokeText(text: string, x: number, y: number) {
    // canvas code strokes then fills the same word: merge them into one outlined Pixi Text
    this.pendingStroke = { text, x, y, color: this.st.stroke, width: this.st.width };
  }
  fillText(text: string, x: number, y: number) {
    const ps = this.pendingStroke && this.pendingStroke.text === text && this.pendingStroke.x === x && this.pendingStroke.y === y ? this.pendingStroke : null;
    this.pendingStroke = null;
    const m = this.st.font.match(/(bold\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/);
    const size = m ? Number(m[2]) : 10;
    const family = (m ? m[3] : "sans-serif").split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
    const [fill, fa] = parseColor(this.st.fill);
    const sc = ps ? parseColor(ps.color) : null;
    const key = `${text}|${this.st.font}|${this.st.fill}|${ps ? ps.color + ps.width : ""}`;
    const used = this.tUsed.get(key) ?? 0;
    this.tUsed.set(key, used + 1);
    let list = this.tPool.get(key);
    if (!list) this.tPool.set(key, (list = []));
    let t = list[used];
    if (!t) {
      t = new this.pixi.Text({
        text,
        style: {
          fontFamily: family,
          fontSize: size,
          fontWeight: m?.[1] ? "bold" : "normal",
          fill,
          ...(sc ? { stroke: { color: sc[0], width: ps!.width, join: "round" as const } } : {}),
        },
      });
      list.push(t);
    }
    const ax = this.st.align === "center" ? 0.5 : this.st.align === "right" || this.st.align === "end" ? 1 : 0;
    const ay = this.st.baseline === "middle" ? 0.5 : this.st.baseline === "top" || this.st.baseline === "hanging" ? 0 : this.st.baseline === "bottom" ? 1 : 0.8;
    t.anchor.set(ax, ay);
    const [X, Y] = this.tx(x, y);
    const [a, b] = this.st.m;
    t.position.set(X, Y);
    t.rotation = Math.atan2(b, a);
    const s = Math.hypot(a, b);
    t.scale.set(s, s);
    t.alpha = fa * this.st.alpha;
    this.app.stage.addChild(t);
    // whatever comes next draws on top of this text
    this.g = null;
    this.ops++;
  }

  destroy() {
    for (const g of this.gPool) g.destroy();
    for (const list of this.tPool.values()) for (const t of list) t.destroy();
    this.app.destroy(false);
  }
}
