/**
 * Canvas2D notebook renderer. Every fighter is drawn by skinning the player's own
 * strokes onto the animated joints (no generic art), with pencil line-boil,
 * smears, onomatopoeia, dust and the KO scribble-out.
 */
import type { Pt } from "@nf/shared";
import type { PixiCtx } from "./pixi-ctx";
import { J, headCenterOf, isAttack, skinStrokes, type Deform, type FxEvent, type Joints, type Rig, type SimState } from "@nf/sim";

// ---------------------------------------------------------------- fighter drawing (shared with the clan battle)
export type DrawFighterOpts = {
  /** px per figure height */
  scale: number;
  /** screen position of the fighter's ground point (pelvis x, y = 0) */
  x: number;
  y: number;
  facing: number;
  time: number;
  shiver?: number;
  alpha?: number;
  tint?: string | null;
  boil?: boolean;
  /** secondary-motion angle for tails / capes */
  sway?: number;
  /** full shape deform (sway, wheel spin, serpent wave, squash) — overrides sway */
  deform?: Deform;
};

function hash(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/** Draw the drawn fighter at its current joints. */
export function drawFighter(ctx: CanvasRenderingContext2D, rig: Rig, joints: Joints, o: DrawFighterOpts) {
  const lines = skinStrokes(rig, joints, o.deform ?? o.sway ?? 0);
  const frame = Math.floor(o.time * 10) % 3; // ~10 fps boil, 3 variants (plan §7.3)
  const amp = (o.boil === false ? 0 : 0.003) + (o.shiver ?? 0) * 0.006;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(o.facing * o.scale, -o.scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = o.alpha ?? 1;
  lines.forEach((s, si) => {
    // smooth, low-frequency wobble along the stroke (a re-traced line, not jitter)
    const ph = hash(si * 7.3 + frame * 3.1) * 6.283;
    const ph2 = hash(si * 3.7 + frame * 5.9) * 6.283;
    const pts = s.points.map((p, i) => {
      if (amp === 0) return p;
      const n = Math.sin(i * 0.22 + ph) * 0.6 + Math.sin(i * 0.57 + ph2) * 0.4;
      const m = Math.sin(i * 0.19 + ph2) * 0.6 + Math.sin(i * 0.61 + ph) * 0.4;
      return { x: p.x + n * amp, y: p.y + m * amp };
    });
    const color = o.tint ?? s.color;
    // graphite: a faint, slightly wider pass (kept tight so the ink stays sharp), then the crisp line
    ctx.strokeStyle = color;
    ctx.globalAlpha = (o.alpha ?? 1) * 0.18;
    ctx.lineWidth = 0.026 * (s.width ?? 1);
    path(ctx, pts);
    ctx.stroke();
    ctx.globalAlpha = (o.alpha ?? 1) * 0.95;
    ctx.lineWidth = 0.019 * (s.width ?? 1);
    path(ctx, pts);
    ctx.stroke();
  });
  ctx.restore();
}

function path(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length < 3) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    return;
  }
  // quadratic smoothing through midpoints
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

export function lerpJoints(a: Joints, b: Joints, t: number): Joints {
  return b.map((p, i) => ({ x: (a[i]?.x ?? p.x) + (p.x - (a[i]?.x ?? p.x)) * t, y: (a[i]?.y ?? p.y) + (p.y - (a[i]?.y ?? p.y)) * t }));
}

// ---------------------------------------------------------------- the page view
type Particle = {
  kind: "spark" | "word" | "dust" | "speed" | "stamp" | "star";
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  text?: string;
  rot?: number;
  size: number;
  color: string;
  dir?: number;
};

const WORDS = ["POW!", "DHISHOOM!", "THWACK!", "BAM!", "DHISH!"];

export class NotebookView {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private host: HTMLElement;
  private ro: ResizeObserver | null = null;
  private parts: Particle[] = [];
  private trauma = 0;
  private cam = { x: 0, scale: 0 };
  /**
   * Arena framing: where the ground line sits (fraction of the height), the most of the height a figure
   * may take, and the side room (figure units) kept around the two fighters. Phones set their own.
   */
  layout = { ground: 0.8, fill: 0.36, margin: 2.6 };
  private start = performance.now();
  private trails: Pt[][] = [[], []];
  private koAt: (number | null)[] = [null, null];
  private wordIx = 0;
  private flash = 0;
  /** last drawn frame time (s) – read by tests */
  time = 0;
  /** name tags over the fighters' heads (2P duel: "P1", "P2") */
  labels: [string, string] | null = null;
  /** a caption in the corner (e.g. "REPLAY ×0.3"), and a recording dot */
  caption: string | null = null;
  recording = false;
  /** squash-and-stretch on the fighter who took a blow: amplitude and time since */
  private squash = [{ amp: 0, t: 9 }, { amp: 0, t: 9 }];
  /** camera punch-in on heavy hits and K.O.: extra zoom toward a point (decays) */
  private zoom = { amt: 0, x: 0, y: 0 };
  /** last zoom amount drawn – read by tests */
  lastZoom = 0;
  /** forget transient effects (a replay starts from a clean slate) */
  clearFx() {
    this.parts = [];
    this.trails = [[], []];
    this.koAt = [null, null];
    this.zoom.amt = 0;
    this.squash = [{ amp: 0, t: 9 }, { amp: 0, t: 9 }];
    this.trauma = 0;
  }

  /** which renderer draws: Canvas2D, or PixiJS (WebGL) through the same drawing code */
  backend: "canvas" | "pixi" = "canvas";
  /** why Pixi wasn't used when it was asked for (no WebGL…) */
  fallback: string | null = null;
  private pixi: PixiCtx | null = null;
  /** draw-time stats for the renderer benchmark */
  perf = { draws: 0, ms: 0, last: 0, ops: 0 };

  private constructor(host: HTMLElement, pre?: { canvas: HTMLCanvasElement; pixi: PixiCtx }) {
    this.host = host;
    this.canvas = pre?.canvas ?? document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.canvas.setAttribute("data-testid", "duel-canvas");
    if (!pre) host.appendChild(this.canvas);
    if (pre) {
      this.pixi = pre.pixi;
      this.backend = "pixi";
      this.canvas.dataset.renderer = "pixi";
      this.ctx = pre.pixi as unknown as CanvasRenderingContext2D;
    } else {
      this.canvas.dataset.renderer = "canvas";
      this.ctx = this.canvas.getContext("2d")!;
    }
    this.resize();
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(host);
    }
  }

  static async mount(host: HTMLElement): Promise<NotebookView> {
    if (typeof document !== "undefined" && document.fonts?.load) {
      try {
        await document.fonts.load('32px "Patrick Hand"');
      } catch {
        /* font optional */
      }
    }
    return new NotebookView(host);
  }

  /** the PixiJS (WebGL) renderer: same look, drawn through Pixi Graphics/Text. Throws without WebGL. */
  static async mountPixi(host: HTMLElement): Promise<NotebookView> {
    await NotebookView.fonts();
    const PIXI = await import("pixi.js");
    const { PixiCtx } = await import("./pixi-ctx");
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);
    const r = host.clientWidth > 0 ? { width: host.clientWidth, height: host.clientHeight } : host.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const app = new PIXI.Application();
    // ?aa=0 turns MSAA off (diagnostics: software WebGL spends most of its time resolving MSAA)
    const antialias = typeof location === "undefined" || new URLSearchParams(location.search).get("aa") !== "0";
    try {
      await app.init({ canvas, width: Math.max(2, Math.round(r.width * dpr)), height: Math.max(2, Math.round(r.height * dpr)), antialias, background: "#f6f0e2", preference: "webgl", autoStart: false, sharedTicker: false, resolution: 1, autoDensity: false });
    } catch (err) {
      canvas.remove();
      throw err;
    }
    app.ticker?.stop();
    return new NotebookView(host, { canvas, pixi: new PixiCtx(PIXI, app, canvas) });
  }

  private static async fonts() {
    if (typeof document !== "undefined" && document.fonts?.load) {
      try {
        await document.fonts.load('32px "Patrick Hand"');
      } catch {
        /* font optional */
      }
    }
  }

  destroy() {
    this.ro?.disconnect();
    this.pixi?.destroy();
    this.pixi = null;
    this.canvas.remove();
  }

  private resize() {
    // layout size, not the on-screen box: a view turned sideways in CSS (phone "Rotate") keeps its own width/height
    const r = this.host.clientWidth > 0 ? { width: this.host.clientWidth, height: this.host.clientHeight } : this.host.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr));
    const h = Math.max(2, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      if (this.pixi) this.pixi.resize(w, h);
      else {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }
  }

  draw(curr: SimState, prev: SimState, alpha: number, events: FxEvent[], impact: number) {
    const t0 = performance.now();
    this.pixi?.begin();
    this.drawScene(curr, prev, alpha, events, impact);
    this.pixi?.end();
    const ms = performance.now() - t0;
    this.perf.draws++;
    this.perf.ms += ms;
    this.perf.last = ms;
    this.perf.ops = this.pixi?.ops ?? 0;
  }

  private drawScene(curr: SimState, prev: SimState, alpha: number, events: FxEvent[], impact: number) {
    this.resize();
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const now = (performance.now() - this.start) / 1000;
    const dt = Math.min(0.05, Math.max(0, now - this.time));
    this.time = now;
    this.trauma = Math.min(1, this.trauma + impact);

    // camera: keep both fighters framed, critically damped
    const xs = curr.fighters.map((f) => f.x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    const span = Math.max(...xs) - Math.min(...xs);
    const targetScale = Math.min(H * this.layout.fill, W / (span + this.layout.margin));
    if (this.cam.scale === 0) this.cam = { x: mid, scale: targetScale };
    const k = 1 - Math.exp(-dt * 4);
    this.cam.x += (mid - this.cam.x) * k;
    this.cam.scale += (targetScale - this.cam.scale) * k;
    const ground = H * this.layout.ground;
    const shake = this.trauma * this.trauma * Math.min(W, H) * 0.02;
    const sx = (hash(now * 61) - 0.5) * shake;
    const sy = (hash(now * 47 + 3) - 0.5) * shake;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    // punch-in: zoom toward the blow, and ease back out
    this.zoom.amt = Math.max(0, this.zoom.amt - dt * (this.zoom.amt > 0.12 ? 0.3 : 0.6));
    const z = this.zoom.amt;
    this.lastZoom = z;
    const S = this.cam.scale * (1 + z);
    const cx = this.cam.x + (this.zoom.x - this.cam.x) * Math.min(0.8, z * 3);
    const gy0 = ground + Math.min(H * 0.12, this.zoom.y * S * z * 1.2);
    const toScreen = (p: Pt): Pt => ({ x: W / 2 + (p.x - cx) * S + sx, y: gy0 - p.y * S + sy });
    for (const q of this.squash) q.t += dt;

    this.paper(W, H, gy0 + sy, sx);

    for (const e of events) this.spawn(e, toScreen, S);
    this.powers(curr, prev, alpha, toScreen, S, now);

    // fighters
    const tags: (Pt | null)[] = [null, null];
    curr.fighters.forEach((f, i) => {
      const p = prev.fighters[i] ?? f;
      const joints = lerpJoints(p.joints, f.joints, alpha);
      const x = p.x + (f.x - p.x) * alpha;
      const y = p.y + (f.y - p.y) * alpha;
      const base = toScreen({ x, y });
      // shadow
      ctx.save();
      ctx.fillStyle = "rgba(42,36,28,0.13)";
      const gy = toScreen({ x, y: 0 }).y;
      const shrink = 1 / (1 + y * 2.5);
      ctx.beginPath();
      // long bodies (a dog, a car, a snake) cast a long shadow centred under their middle
      const half = Math.max(0.2, (f.rig.extent.front + f.rig.extent.back) / 2 + 0.05);
      const mid = f.rig.pivotX ? (f.rig.extent.front - f.rig.extent.back) / 2 : joints[J.pelvis].x;
      ctx.ellipse(base.x + mid * f.facing * S, gy + 2, S * half * shrink, S * 0.035 * shrink, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // smear trail behind the striking edge (fist, foot, a sword's tip, a tail, a bumper)
      const trail = this.trails[i];
      const swing = f.move === "swing" || f.move === "tailWhip";
      if (isAttack(f.move) && f.tip && !f.ko) {
        // the striking edge can jump (a dog turning round to whip its tail): start a fresh trail
        const last = trail[trail.length - 1];
        if (last && Math.hypot(last.x - f.tip.x, last.y - f.tip.y) > 0.3) trail.length = 0;
        trail.push({ ...f.tip });
        if (trail.length > (swing ? 11 : 7)) trail.shift();
      } else if (trail.length) trail.shift();
      if (trail.length > 2) {
        ctx.save();
        ctx.lineCap = "round";
        for (let t = 1; t < trail.length; t++) {
          const a = toScreen(trail[t - 1]);
          const b = toScreen(trail[t]);
          ctx.strokeStyle = f.color;
          ctx.globalAlpha = (t / trail.length) * (swing ? 0.45 : 0.35);
          ctx.lineWidth = S * (swing ? 0.03 : 0.012) * (t / trail.length) + 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      const pd = p.deform ?? f.deform;
      const mixD = (k: keyof Deform) => (pd[k] ?? 0) + ((f.deform[k] ?? 0) - (pd[k] ?? 0)) * alpha;
      // squash on the receiver: flattened by the blow, then a springy wobble back
      const sq = this.squash[i];
      const k = f.ko ? 0 : sq.amp * Math.exp(-sq.t * 7) * Math.cos(sq.t * 26);
      const deform: Deform = { sway: mixD("sway"), spin: mixD("spin"), wavePhase: mixD("wavePhase"), waveAmp: mixD("waveAmp"), sx: (f.deform.sx ?? 1) * (1 + 0.22 * k), sy: (f.deform.sy ?? 1) * (1 - 0.18 * k) };
      // lightning dash / dive: an after-image streak behind the body
      if (f.dashing && !f.ko) {
        for (let g = 1; g <= 3; g++)
          drawFighter(ctx, f.rig, joints, { scale: S, x: base.x - f.facing * g * S * 0.12, y: base.y, facing: f.facing, time: now + g, alpha: 0.22 / g, tint: f.element === "lightning" ? "#c4962c" : f.color, deform });
      }
      drawFighter(ctx, f.rig, joints, { scale: S, x: base.x, y: base.y, facing: f.facing, time: now + i * 0.37, shiver: f.shiver, deform, tint: f.frozen && !f.ko ? "#3f7fbf" : null });
      if (this.labels && !f.ko) {
        const hc = headCenterOf(f.rig, joints);
        tags[i] = toScreen({ x: x + f.facing * hc.x, y: y + hc.y + 0.3 });
      }
      // statuses: burning (little flames), frozen (ice crystals)
      if ((f.burning || f.frozen) && !f.ko) {
        const hc = headCenterOf(f.rig, joints);
        const top = toScreen({ x: x + f.facing * hc.x, y: y + hc.y + 0.12 });
        ctx.save();
        ctx.lineWidth = Math.max(1.5, S * 0.008);
        ctx.lineCap = "round";
        if (f.burning) {
          ctx.strokeStyle = "#e07a2f";
          for (let k = 0; k < 3; k++) {
            const fx = top.x + (k - 1) * S * 0.07;
            const h = S * (0.06 + 0.03 * Math.sin(now * 14 + k * 2));
            ctx.beginPath();
            ctx.moveTo(fx - S * 0.02, top.y);
            ctx.quadraticCurveTo(fx - S * 0.03, top.y - h * 0.6, fx, top.y - h);
            ctx.quadraticCurveTo(fx + S * 0.03, top.y - h * 0.6, fx + S * 0.02, top.y);
            ctx.stroke();
          }
        }
        if (f.frozen) {
          ctx.strokeStyle = "#3f7fbf";
          for (let k = 0; k < 3; k++) {
            const cx = top.x + (k - 1) * S * 0.09;
            const r = S * 0.025;
            for (let a = 0; a < 3; a++) {
              const t = (a * Math.PI) / 3;
              ctx.beginPath();
              ctx.moveTo(cx - Math.cos(t) * r, top.y - S * 0.04 - Math.sin(t) * r);
              ctx.lineTo(cx + Math.cos(t) * r, top.y - S * 0.04 + Math.sin(t) * r);
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      }

      // KO: scribble-out + teacher's stamp
      if (f.ko) {
        if (this.koAt[i] === null) this.koAt[i] = now;
        const since = now - (this.koAt[i] ?? now);
        if (since > 1.1) this.scribble(joints, f.facing, base, S, Math.min(1, (since - 1.1) / 0.6), i);
      } else this.koAt[i] = null;
      if (f.move === "victory" && hash(now * 13 + i) < 0.08) {
        const hc = headCenterOf(f.rig, joints);
        const hp = toScreen({ x: x + f.facing * hc.x, y: y + hc.y + 0.12 });
        this.parts.push({ kind: "star", x: hp.x + (hash(now) - 0.5) * S * 0.5, y: hp.y, vx: 0, vy: -S * 0.3, life: 0.8, max: 0.8, size: S * 0.05, color: "#c4962c" });
      }
    });

    this.particles(dt);
    // name tags go on top of everything (a hit word or a big drawing must not cover them)
    this.drawTags(tags, S, curr.fighters.map((f) => f.x));
    if (this.caption || this.recording) this.drawCaption(W, H);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,250,${this.flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
      this.flash = Math.max(0, this.flash - dt * 8);
    }
  }

  /** P1/P2 name tags; when the fighters overlap, the tags slide apart (left one left) instead of stacking */
  private drawTags(tags: (Pt | null)[], S: number, xs: number[]) {
    if (!this.labels) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `bold ${Math.round(S * 0.09)}px "Patrick Hand", cursive`;
    ctx.textAlign = "center";
    const pos = tags.map((t) => (t ? { ...t } : null));
    const [a, b] = pos;
    if (a && b) {
      const w = Math.max(ctx.measureText(this.labels[0]).width, ctx.measureText(this.labels[1]).width) * 1.35;
      // close together (a clinch, a beast biting): both tags share the higher line, side by side, so a
      // low head (the dog's) doesn't put its tag under the other fighter's or into the hit word
      if (Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < S * 0.6) {
        const mid = (a.x + b.x) / 2;
        const top = Math.min(a.y, b.y);
        const left = xs[0] <= xs[1] ? a : b;
        const right = left === a ? b : a;
        left.x = mid - w / 2;
        right.x = mid + w / 2;
        left.y = right.y = top;
      }
    }
    pos.forEach((t, i) => {
      if (!t) return;
      ctx.fillStyle = i === 0 ? "#2a241c" : "#1d4f89";
      ctx.strokeStyle = "#f6f0e2";
      ctx.lineWidth = Math.max(2, S * 0.012);
      ctx.lineJoin = "round";
      ctx.strokeText(this.labels![i], t.x, t.y);
      ctx.fillText(this.labels![i], t.x, t.y);
    });
    ctx.restore();
    this.tagPos = pos;
  }
  /** where the tags were drawn last frame – read by tests */
  tagPos: (Pt | null)[] = [null, null];

  private drawCaption(W: number, H: number) {
    const ctx = this.ctx;
    ctx.save();
    const s = Math.max(16, H * 0.045);
    ctx.font = `bold ${Math.round(s)}px "Patrick Hand", cursive`;
    ctx.textBaseline = "middle";
    const x = W * 0.09;
    const y = H * 0.27;
    if (this.recording) {
      ctx.fillStyle = "#c23b32";
      ctx.beginPath();
      ctx.arc(x + s * 0.3, y, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.caption) {
      ctx.fillStyle = "#c23b32";
      ctx.strokeStyle = "#f6f0e2";
      ctx.lineWidth = s * 0.18;
      const tx = x + (this.recording ? s * 0.8 : 0);
      ctx.strokeText(this.caption, tx, y);
      ctx.fillText(this.caption, tx, y);
      ctx.strokeStyle = "#c23b32";
      ctx.lineWidth = 2;
      const w = ctx.measureText(this.caption).width;
      ctx.strokeRect(tx - s * 0.25, y - s * 0.65, w + s * 0.5, s * 1.3);
    }
    ctx.restore();
  }

  /** drawn powers in flight: fireballs, water waves, ice shards, and puddles on the ground */
  private powers(curr: SimState, prev: SimState, alpha: number, toScreen: (p: Pt) => Pt, S: number, now: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const q of curr.puddles ?? []) {
      const c = toScreen({ x: q.x, y: 0 });
      ctx.globalAlpha = Math.min(1, q.t) * 0.8;
      ctx.strokeStyle = "#1d4f89";
      ctx.lineWidth = Math.max(1.5, S * 0.007);
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.ellipse(c.x + k * S * 0.02, c.y + 1, q.w * S * (1 - k * 0.25), S * 0.03 * (1 - k * 0.3), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha *= 0.25;
      ctx.fillStyle = "#3f7fbf";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 1, q.w * S, S * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of curr.projectiles ?? []) {
      const was = prev.projectiles?.find((o) => o.owner === p.owner && o.kind === p.kind && Math.abs(o.x - p.x) < 0.3);
      const at = toScreen({ x: was ? was.x + (p.x - was.x) * alpha : p.x, y: p.y });
      const dir = Math.sign(p.vx) || 1;
      const r = p.r * S * (p.kind === "ice" ? 1.6 : 1);
      const wob = (k: number) => Math.sin(now * 30 + k * 2.1) * r * 0.12;
      if (p.kind === "fire") {
        // a scribbled fireball with a flickering tail
        ctx.strokeStyle = "#e07a2f";
        ctx.lineWidth = Math.max(2, S * 0.012);
        ctx.beginPath();
        for (let k = 0; k <= 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const rr = r * (1 + (k % 2 ? 0.35 : 0)) + wob(k);
          const px = at.x + Math.cos(a) * rr;
          const py = at.y + Math.sin(a) * rr;
          if (k) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.stroke();
        ctx.fillStyle = "rgba(224,122,47,0.3)";
        ctx.fill();
        ctx.strokeStyle = "#c23b32";
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.moveTo(at.x - dir * r, at.y + (k - 1) * r * 0.5);
          ctx.lineTo(at.x - dir * r * (2.4 + 0.5 * Math.sin(now * 20 + k)), at.y + (k - 1) * r * 0.7);
          ctx.stroke();
        }
      } else if (p.kind === "water") {
        // a curling wave: three scalloped crests
        ctx.strokeStyle = "#1d4f89";
        ctx.lineWidth = Math.max(2, S * 0.011);
        for (let k = 0; k < 3; k++) {
          const off = k * r * 0.45;
          ctx.beginPath();
          ctx.moveTo(at.x - dir * (r * 1.2 + off), at.y + r - off * 0.2);
          ctx.quadraticCurveTo(at.x - dir * off * 0.5, at.y - r * 1.3 + off + wob(k), at.x + dir * (r * 0.8 - off), at.y - r * 0.2 + off * 0.6);
          ctx.quadraticCurveTo(at.x + dir * (r * 0.3 - off), at.y + off * 0.3, at.x + dir * (r * 0.1 - off), at.y - r * 0.4 + off);
          ctx.stroke();
        }
      } else if (p.kind === "ice") {
        ctx.strokeStyle = "#3f7fbf";
        ctx.lineWidth = Math.max(2, S * 0.01);
        ctx.beginPath();
        ctx.moveTo(at.x + dir * r * 1.6, at.y);
        ctx.lineTo(at.x, at.y - r * 0.55);
        ctx.lineTo(at.x - dir * r * 1.2, at.y);
        ctx.lineTo(at.x, at.y + r * 0.55);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = "rgba(63,127,191,0.2)";
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(at.x - dir * r * 1.2, at.y);
        ctx.lineTo(at.x + dir * r * 1.6, at.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private paper(W: number, H: number, ground: number, sx: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "#f6f0e2";
    ctx.fillRect(0, 0, W, H);
    const gap = Math.max(18, H / 24);
    ctx.strokeStyle = "rgba(70,110,170,0.22)";
    ctx.lineWidth = 1;
    for (let y = gap * 2; y < H; y += gap) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(212,83,74,0.55)";
    ctx.lineWidth = Math.max(2, W * 0.002);
    ctx.beginPath();
    ctx.moveTo(W * 0.07, 0);
    ctx.lineTo(W * 0.07, H);
    ctx.stroke();
    // ground: a pencil-ruled line with grass ticks
    ctx.strokeStyle = "#2a241c";
    ctx.lineWidth = Math.max(1.5, W * 0.0018);
    ctx.beginPath();
    ctx.moveTo(W * 0.04 + sx, ground);
    ctx.lineTo(W * 0.96 + sx, ground);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      const x = W * (0.05 + i * 0.023) + sx;
      ctx.beginPath();
      ctx.moveTo(x, ground);
      ctx.lineTo(x + W * 0.004, ground - H * 0.012);
      ctx.stroke();
    }
  }

  private scribble(joints: Joints, facing: number, base: Pt, S: number, k: number, i: number) {
    const ctx = this.ctx;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of joints) {
      minX = Math.min(minX, p.x * facing);
      maxX = Math.max(maxX, p.x * facing);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    ctx.save();
    ctx.strokeStyle = "rgba(194,59,50,0.7)";
    ctx.lineWidth = Math.max(1.5, S * 0.008);
    ctx.beginPath();
    const n = Math.floor(14 * k);
    for (let z = 0; z <= n; z++) {
      const u = z / 14;
      const x = base.x + (minX - 0.05 + (maxX - minX + 0.1) * u) * S;
      const y = base.y - (z % 2 ? maxY + 0.04 : minY - 0.02) * S + (hash(z + i * 7) - 0.5) * S * 0.04;
      if (z === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (k >= 1) {
      ctx.translate(base.x + ((minX + maxX) / 2) * S, base.y - (maxY + 0.25) * S);
      ctx.rotate(-0.18);
      ctx.strokeStyle = "#c23b32";
      ctx.fillStyle = "#c23b32";
      ctx.lineWidth = Math.max(2, S * 0.012);
      ctx.font = `bold ${Math.round(S * 0.16)}px "Patrick Hand", cursive`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = S * 0.42;
      ctx.strokeRect(-w / 2, -S * 0.1, w, S * 0.2);
      ctx.fillText("OUT!", 0, 0);
    }
    ctx.restore();
  }

  private spawn(e: FxEvent, toScreen: (p: Pt) => Pt, S: number) {
    const p = toScreen(e);
    // a new swing or blow retires the previous hit word, so "CRASH!" doesn't hang over the next move
    if (e.kind === "special" || e.kind === "clash") {
      const COL: Record<string, string> = { fire: "#e07a2f", water: "#1d4f89", lightning: "#c4962c", ice: "#3f7fbf", wings: "#2a241c", shield: "#2a241c", spikes: "#2a241c" };
      const color = e.kind === "clash" ? e.color : COL[e.power];
      const n = e.kind === "clash" ? 10 : 7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const v = S * (0.9 + hash(i * 5 + this.wordIx) * 0.8);
        this.parts.push({ kind: "spark", x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3, max: 0.3, size: S * 0.06, color });
      }
      if (e.kind === "clash") this.parts.push({ kind: "word", x: p.x, y: p.y - S * 0.2, vx: 0, vy: -S * 0.2, life: 0.8, max: 0.8, text: e.word, rot: -0.12, size: S * 0.16, color });
      return;
    }
    if (e.kind === "hit" || e.kind === "ko" || e.kind === "whoosh" || e.kind === "block")
      for (const q of this.parts) if (q.kind === "word" && q.text !== "K.O.!") q.life = Math.min(q.life, 0.08);
    if (e.kind === "hit" && e.who !== undefined) this.squash[e.who] = { amp: Math.min(1, 0.35 + e.power / 14), t: 0 };
    if ((e.kind === "hit" && e.power >= 11) || e.kind === "ko") {
      // a heavy blow punches the camera in; a K.O. even more
      const amt = e.kind === "ko" ? 0.24 : Math.min(0.14, 0.05 + (e.power - 11) * 0.01);
      if (amt >= this.zoom.amt) this.zoom = { amt, x: e.x, y: e.y };
    }
    if (e.kind === "hit" || e.kind === "ko") {
      const n = e.kind === "ko" ? 14 : 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + hash(i + this.wordIx) * 0.5;
        const v = S * (1.4 + hash(i * 3 + this.wordIx) * 1.4);
        this.parts.push({ kind: "spark", x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25, max: 0.25, size: S * 0.06, color: (e.kind === "hit" && e.color) || "#c23b32" });
      }
      const text = e.kind === "ko" ? "K.O.!" : e.word ?? WORDS[this.wordIx++ % WORDS.length];
      this.parts.push({ kind: "word", x: p.x, y: p.y - S * 0.25, vx: 0, vy: -S * 0.25, life: 0.75, max: 0.75, text, rot: (hash(this.wordIx) - 0.5) * 0.5, size: S * (e.kind === "ko" ? 0.26 : 0.17), color: (e.kind === "hit" && e.color) || "#c23b32" });
      this.flash = e.kind === "ko" ? 1 : 0.5;
    } else if (e.kind === "block") {
      this.parts.push({ kind: "word", x: p.x, y: p.y - S * 0.2, vx: 0, vy: -S * 0.2, life: 0.5, max: 0.5, text: "TAK", rot: 0.15, size: S * 0.12, color: "#1d4f89" });
      for (let i = 0; i < 5; i++) this.parts.push({ kind: "spark", x: p.x, y: p.y, vx: (hash(i) - 0.5) * S * 2, vy: -hash(i + 9) * S * 1.5, life: 0.18, max: 0.18, size: S * 0.04, color: "#1d4f89" });
    } else if (e.kind === "land" || e.kind === "jump") {
      for (let i = 0; i < 6; i++) {
        const s = i % 2 ? 1 : -1;
        this.parts.push({ kind: "dust", x: p.x + s * S * 0.08, y: p.y, vx: s * S * (0.5 + hash(i + p.x) * 0.6), vy: -S * 0.15 * hash(i * 5 + p.x), life: 0.45, max: 0.45, size: S * 0.035, color: "rgba(42,36,28,0.45)" });
      }
    } else if (e.kind === "whoosh") {
      for (let i = 0; i < 3; i++) this.parts.push({ kind: "speed", x: p.x - e.dir * S * 0.25, y: p.y + (i - 1) * S * 0.08 + (e.move === "kick" || e.move === "squish" || e.move === "charge" ? S * 0.15 : -S * 0.1), vx: -e.dir * S * 0.6, vy: 0, life: 0.22, max: 0.22, size: S * 0.18, color: "rgba(42,36,28,0.4)", dir: e.dir });
    }
  }

  private particles(dt: number) {
    const ctx = this.ctx;
    this.parts = this.parts.filter((q) => (q.life -= dt) > 0);
    for (const q of this.parts) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= 0.9;
      q.vy *= 0.9;
      const k = q.life / q.max;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.strokeStyle = q.color;
      ctx.fillStyle = q.color;
      ctx.lineCap = "round";
      if (q.kind === "spark") {
        ctx.lineWidth = Math.max(1.5, q.size * 0.25);
        const L = q.size * (0.5 + k);
        const a = Math.atan2(q.vy, q.vx);
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x - Math.cos(a) * L, q.y - Math.sin(a) * L);
        ctx.stroke();
      } else if (q.kind === "word" && q.text) {
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot ?? 0);
        const pop = 1 + Math.max(0, (k - 0.8) * 2.5); // squash-pop in
        ctx.scale(pop, pop);
        ctx.font = `bold ${Math.round(q.size)}px "Patrick Hand", cursive`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(3, q.size * 0.18);
        ctx.strokeStyle = "#f6f0e2";
        ctx.strokeText(q.text, 0, 0);
        ctx.fillText(q.text, 0, 0);
      } else if (q.kind === "dust") {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(q.x, q.y - q.size, q.size * (1.6 - k), 0, Math.PI * 1.6);
        ctx.stroke();
      } else if (q.kind === "speed") {
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x - (q.dir ?? 1) * q.size * k, q.y);
        ctx.stroke();
      } else if (q.kind === "star") {
        ctx.font = `${Math.round(q.size * 1.6)}px serif`;
        ctx.textAlign = "center";
        ctx.fillText("✦", q.x, q.y);
      }
      ctx.restore();
    }
  }
}

/**
 * Mount the fight renderer: "pixi" (PixiJS v8 / WebGL) or "canvas" (Canvas2D). Pixi falls back to
 * Canvas2D when it can't start (no WebGL); `view.fallback` says why.
 */
export async function mountView(host: HTMLElement, kind: "canvas" | "pixi" = "canvas", opts: { allowSoftware?: boolean } = {}): Promise<NotebookView> {
  if (kind === "pixi") {
    // a software WebGL (SwiftShader, llvmpipe: no GPU / blocklisted driver) is slower than Canvas2D
    const gl = webglInfo();
    if (!gl.ok || (gl.software && !opts.allowSoftware)) {
      const v = await NotebookView.mount(host);
      v.fallback = !gl.ok ? "no WebGL" : `software WebGL (${gl.renderer})`;
      return v;
    }
    try {
      return await NotebookView.mountPixi(host);
    } catch (err) {
      const v = await NotebookView.mount(host);
      v.fallback = err instanceof Error ? err.message : String(err);
      return v;
    }
  }
  return NotebookView.mount(host);
}

/** is there a WebGL, and is it a real GPU? */
export function webglInfo(): { ok: boolean; software: boolean; renderer: string } {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { ok: false, software: false, renderer: "" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: true, software: /swiftshader|llvmpipe|software|softpipe/i.test(renderer), renderer };
  } catch {
    return { ok: false, software: false, renderer: "" };
  }
}
