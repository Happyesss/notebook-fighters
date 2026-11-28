"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PICKABLE, POWER_INFO, ROSTER, isPickable } from "@nf/sim";
import { BOX_ASPECT, BRUSHES, MIN_STEP2, PENCILS, clamp01, eraseStrokes, hasInk, paintInk, type Pt, type Stroke } from "./ink";
import { judgeDrawing } from "./reading";
import { RivalThumb } from "./rivals";

type Tool = "pencil" | "eraser";
/** what the big area shows: the drawing page, or one of the two pickers */
export type PadPanel = "page" | "fighters" | "specials";
/** what Done hands back besides the strokes: a picked special move and/or a ready-made fighter */
export type PadExtras = { special: string | null; preset: string | null };

/** a picture and a short name for each special you can pick (the details come from the sim's POWER_INFO) */
export const SPECIAL_LOOK: Record<string, { icon: string; name: string; desc: string }> = {
  leap: { icon: "🦘", name: "Mega leap", desc: "Jump right across the page and land in a smash on the foe." },
  flykick: { icon: "🦶", name: "Flying kick", desc: "Leap up and fly in feet first." },
  haymaker: { icon: "🥊", name: "Haymaker", desc: "Wind up one huge punch. Slow to land, but it hurts." },
  stretch: { icon: "🤜", name: "Stretch punch", desc: "Your arm springs out like a spring and punches from far away." },
  longkick: { icon: "🦵", name: "Long kick", desc: "A leg stretches low along the floor and sweeps the foe. They can jump it." },
  boomerang: { icon: "🪃", name: "Boomerang", desc: "Throw it: it hits going out or on the way back, then flies home to you." },
  blades: { icon: "✴️", name: "Throwing stars", desc: "Spring backwards and throw three stars, low, middle and high." },
  web: { icon: "🕸️", name: "Web shot", desc: "Jump and shoot a web: the foe is stuck for a moment." },
  slash: { icon: "🗡️", name: "Dash slash", desc: "Dash forward with a slicing strike." },
  bite: { icon: "🦷", name: "Lunge bite", desc: "Lunge in fast and bite." },
  pumpkin: { icon: "🎃", name: "Pumpkin lob", desc: "Lob a pumpkin in an arc that lands on the foe." },
  quake: { icon: "💥", name: "Ground shake", desc: "Stomp: a shockwave runs along the floor. A jump clears it." },
  chalk: { icon: "🖍️", name: "Chalk throw", desc: "Fling a stick of chalk straight across the page: it stuns." },
  phantom: { icon: "👻", name: "Vanish", desc: "Turn invisible for a moment: attacks pass right through you." },
  bones: { icon: "🦴", name: "Bone scatter", desc: "Fall to bits to dodge a hit, then snap back with a strike." },
};
const specialDesc = (k: string) => SPECIAL_LOOK[k]?.desc ?? POWER_INFO[k as keyof typeof POWER_INFO]?.passive ?? "";
export const specialName = (k: string | null | undefined) => (k ? SPECIAL_LOOK[k]?.name ?? (k in POWER_INFO ? POWER_INFO[k as keyof typeof POWER_INFO].special : k) : "");
export const specialIcon = (k: string | null | undefined) => (k ? SPECIAL_LOOK[k]?.icon ?? "★" : "");

/**
 * The big drawing pad: draw your own fighter (coloured pencils, line weights, an eraser that really cuts
 * strokes, undo/redo, clear) or pick a ready-made one from the roster (shown, but locked: it can't be
 * edited), and pick a special move no doodle can give (boomerang, stretch punch, mega leap …). A live
 * read-out shows what the reader makes of the drawing. Done hands back the strokes (same 0..1 box
 * coordinates) and the picks; Cancel or Escape leaves everything as it was.
 */
export function SketchModal({
  title,
  strokes,
  special = null,
  preset = null,
  panel: startPanel = "page",
  pen,
  onPen,
  onDone,
  onCancel,
}: {
  title: string;
  /** the page's own drawing (kept even while a ready-made fighter is picked, so you can switch back) */
  strokes: Stroke[];
  special?: string | null;
  preset?: string | null;
  /** open straight on a picker */
  panel?: PadPanel;
  pen: string;
  onPen: (color: string) => void;
  onDone: (strokes: Stroke[], extras: PadExtras) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(pen);
  const [brush, setBrush] = useState(1);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [panel, setPanel] = useState<PadPanel>(startPanel);
  const [pick, setPick] = useState<{ special: string | null; preset: string | null }>(() => ({
    special: isPickable(special) ? special : null,
    preset: preset && ROSTER.some((r) => r.id === preset) ? preset : null,
  }));
  // history: past states, the current one, and undone states
  const [hist, setHist] = useState<{ past: Stroke[][]; now: Stroke[]; future: Stroke[][] }>(() => ({ past: [], now: strokes.map(copy), future: [] }));
  const work = useRef<Stroke[]>(hist.now);
  const active = useRef<{ id: number; before: Stroke[]; last: Pt } | null>(null);

  const ready = pick.preset ? ROSTER.find((r) => r.id === pick.preset) ?? null : null;
  const locked = !!ready;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const eraserR = 0.014 + 0.016 * brush;
  const repaint = useCallback(() => paintInk(canvasRef.current, lockedRef.current && ready ? (ready.strokes as Stroke[]) : work.current), [ready]);

  // keep the working copy in step with the history (undo / redo / clear) and the picked fighter
  useEffect(() => {
    if (active.current) return;
    work.current = hist.now;
    repaint();
  }, [hist.now, repaint, box, panel, locked]);

  // size the page: the biggest 3:4 box that fits the free space
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      const h = Math.max(120, Math.min(r.height, r.width / BOX_ASPECT));
      setBox({ w: Math.floor(h * BOX_ASPECT), h: Math.floor(h) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // no page scroll / zoom behind the pad; focus moves in, and back to the opener on close
  useEffect(() => {
    const html = document.documentElement;
    const prev = { o: html.style.overflow, b: document.body.style.overflow, t: document.body.style.touchAction };
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      html.style.overflow = prev.o;
      document.body.style.overflow = prev.b;
      document.body.style.touchAction = prev.t;
      opener?.focus?.();
    };
  }, []);

  const commit = useCallback((next: Stroke[]) => {
    setHist((h) => (next === h.now ? h : { past: [...h.past, h.now].slice(-100), now: next, future: [] }));
  }, []);
  const undo = useCallback(() => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), now: h.past[h.past.length - 1], future: [h.now, ...h.future] } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.future.length ? { past: [...h.past, h.now], now: h.future[0], future: h.future.slice(1) } : h)), []);
  const clear = useCallback(() => commit([]), [commit]);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const done = useCallback(() => {
    const p = pickRef.current;
    onDone(work.current.filter((s) => s.points.length > 1), { preset: p.preset, special: p.preset ? null : p.special });
  }, [onDone]);

  const pickColor = (c: string) => {
    setColor(c);
    setTool("pencil");
    onPen(c);
  };
  const chooseFighter = (id: string | null) => {
    setPick((p) => ({ ...p, preset: id }));
    setPanel("page");
  };
  const chooseSpecial = (k: string | null) => {
    setPick((p) => ({ ...p, special: k }));
    setPanel("page");
  };

  // keyboard: Esc cancels (or closes a picker), Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z or Ctrl+Y redo, E eraser, P pencil, 1-8 colours, [ ] line weight
  const panelRef = useRef(panel);
  panelRef.current = panel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (panelRef.current !== "page") setPanel("page");
        else onCancel();
        return;
      }
      if (e.key === "Tab") {
        // keep focus inside the dialog
        const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          items[items.length - 1].focus();
        } else if (!e.shiftKey && i === items.length - 1) {
          e.preventDefault();
          items[0].focus();
        } else if (i === -1) {
          e.preventDefault();
          items[0].focus();
        }
        return;
      }
      if (lockedRef.current || panelRef.current !== "page") return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey) {
        if (k === "e") setTool("eraser");
        else if (k === "p" || k === "b") setTool("pencil");
        else if (k === "[") setBrush((b) => prevBrush(b));
        else if (k === "]") setBrush((b) => nextBrush(b));
        else if (/^[1-8]$/.test(k)) pickColor(PENCILS[Number(k) - 1].color);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCancel, undo, redo]);

  function point(e: { clientX: number; clientY: number }): Pt {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - rect.left) / rect.width), y: clamp01((e.clientY - rect.top) / rect.height) };
  }
  function moveCursor(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = cursorRef.current;
    const canvas = canvasRef.current;
    if (!c || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const d = eraserR * 2 * rect.width;
    c.style.width = c.style.height = `${d}px`;
    c.style.transform = `translate(${e.clientX - rect.left - d / 2}px, ${e.clientY - rect.top - d / 2}px)`;
    c.style.opacity = locked ? "0" : tool === "eraser" && e.pointerType !== "touch" ? "1" : tool === "eraser" && active.current ? "1" : "0";
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (locked || active.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // drawing still works without capture
    }
    const p = point(e);
    active.current = { id: e.pointerId, before: work.current, last: p };
    if (tool === "eraser") {
      work.current = eraseStrokes(work.current, p, p, eraserR);
    } else {
      work.current = [...work.current, { color, points: [p], ...(brush !== 1 ? { w: brush } : {}) }];
    }
    moveCursor(e);
    repaint();
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    moveCursor(e);
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const list = events.length ? events : [e.nativeEvent];
    if (tool === "eraser") {
      for (const ev of list) {
        const p = point(ev);
        work.current = eraseStrokes(work.current, a.last, p, eraserR);
        a.last = p;
      }
    } else {
      const strokes = work.current;
      const s = strokes[strokes.length - 1];
      const pts = [...s.points];
      for (const ev of list) {
        const p = point(ev);
        const last = pts[pts.length - 1];
        if ((p.x - last.x) ** 2 + (p.y - last.y) ** 2 < MIN_STEP2) continue;
        pts.push(p);
        a.last = p;
      }
      work.current = [...strokes.slice(0, -1), { ...s, points: pts }];
    }
    repaint();
  }
  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    active.current = null;
    const next = work.current.filter((s) => s.points.length > 1);
    work.current = next;
    if (next.length === a.before.length && next.every((s, i) => s === a.before[i])) {
      repaint();
      return;
    }
    commit(next);
  }

  const inked = hasInk(hist.now);
  // what the reader makes of the page right now (only on each finished stroke, not while drawing)
  const reading = useMemo(() => (inked && !locked ? judgeDrawing(hist.now, 0) : null), [hist.now, inked, locked]);
  const shownSpecial = ready ? ready.signature ?? null : pick.special;
  const noTools = locked || panel !== "page";

  return (
    <div className="sketch-backdrop" data-testid="sketch-modal">
      <div className="sketch" ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Draw ${title} — big page`} data-locked={locked ? "true" : "false"}>
        <div className="sketch-tools" role="toolbar" aria-label="Drawing tools">
          <div className="sketch-head">
            <span className="sketch-title">{title}</span>
          </div>
          <div className="sketch-mode" role="group" aria-label="Your own drawing or a ready-made fighter">
            <button type="button" className="sketch-tab" aria-pressed={!locked && panel !== "fighters"} data-testid="pad-mode-draw" onClick={() => chooseFighter(null)}>
              ✎ Draw my own
            </button>
            <button type="button" className="sketch-tab" aria-pressed={locked || panel === "fighters"} data-testid="pad-mode-pick" onClick={() => setPanel(panel === "fighters" ? "page" : "fighters")}>
              👤 Pick a fighter
            </button>
          </div>
          <span className="sketch-label">Colour</span>
          <div className="sketch-group" role="group" aria-label="Pencil colours">
            {PENCILS.map((p, i) => (
              <button
                key={p.color}
                type="button"
                className="pencil"
                style={{ background: p.color }}
                aria-label={`${p.name} pencil (${i + 1})`}
                title={`${p.name} (${i + 1})`}
                aria-pressed={tool === "pencil" && color === p.color}
                data-testid={`sketch-color-${p.name.toLowerCase()}`}
                disabled={noTools}
                {...(color === p.color ? { "data-autofocus": true } : {})}
                onClick={() => pickColor(p.color)}
              />
            ))}
          </div>
          <span className="sketch-label">Line</span>
          <div className="sketch-group" role="group" aria-label="Line weight">
            {BRUSHES.map((b) => (
              <button
                key={b.w}
                type="button"
                className="sketch-brush"
                aria-label={`${b.name} line`}
                title={`${b.name} line ([ and ])`}
                aria-pressed={brush === b.w}
                data-testid={`sketch-brush-${b.name.toLowerCase()}`}
                disabled={noTools}
                onClick={() => setBrush(b.w)}
              >
                <span style={{ width: `${0.25 + b.w * 0.32}rem`, height: `${0.25 + b.w * 0.32}rem`, background: tool === "eraser" ? "#fffaf1" : color }} />
              </button>
            ))}
          </div>
          <span className="sketch-label">Tools</span>
          <div className="sketch-group" role="group" aria-label="Tools">
            <button type="button" className="sketch-btn" aria-pressed={tool === "pencil"} data-testid="sketch-pencil" title="Pencil (P)" disabled={noTools} onClick={() => setTool("pencil")}>
              ✎ pencil
            </button>
            <button type="button" className="sketch-btn" aria-pressed={tool === "eraser"} data-testid="sketch-eraser" title="Eraser (E)" disabled={noTools} onClick={() => setTool("eraser")}>
              ⌫ eraser
            </button>
            <button type="button" className="sketch-btn" data-testid="sketch-undo" title="Undo (Ctrl/⌘+Z)" disabled={noTools || !hist.past.length} onClick={undo}>
              ↶ undo
            </button>
            <button type="button" className="sketch-btn" data-testid="sketch-redo" title="Redo (Ctrl/⌘+Shift+Z)" disabled={noTools || !hist.future.length} onClick={redo}>
              ↷ redo
            </button>
            <button type="button" className="sketch-btn" data-testid="sketch-clear" title="Clear the page" disabled={noTools || !inked} onClick={clear}>
              clear
            </button>
          </div>
          <div className="sketch-group sketch-end">
            <button type="button" className="sketch-btn" data-testid="sketch-cancel" title="Cancel (Esc)" onClick={onCancel}>
              cancel
            </button>
            <button type="button" className="sketch-btn sketch-done" data-testid="sketch-done" onClick={done}>
              done ✓
            </button>
          </div>
        </div>
        <div className="sketch-stage" ref={stageRef}>
          <div className="sketch-page" style={box ? { width: box.w, height: box.h } : { visibility: "hidden" }} data-tool={tool} data-locked={locked ? "true" : "false"} hidden={panel !== "page"}>
            {!inked && !locked && <GhostGuide />}
            <canvas
              ref={canvasRef}
              data-testid="sketch-canvas"
              aria-label={locked ? `${ready!.name}, a ready-made fighter (can't be edited)` : "Drawing page"}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onPointerLeave={() => {
                if (!active.current && cursorRef.current) cursorRef.current.style.opacity = "0";
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
            <div className="sketch-cursor" ref={cursorRef} aria-hidden="true" />
            {locked && (
              <div className="sketch-lock" data-testid="pad-locked">
                <span>🔒 {ready!.name}: ready-made, can&apos;t be edited</span>
                <button type="button" className="sketch-btn" data-testid="pad-unlock" onClick={() => chooseFighter(null)}>
                  ✎ draw my own instead
                </button>
              </div>
            )}
          </div>
          {panel === "fighters" && <FighterPicker current={pick.preset} onPick={chooseFighter} onBack={() => setPanel("page")} />}
          {panel === "specials" && <SpecialPicker current={pick.special} onPick={chooseSpecial} onBack={() => setPanel("page")} />}
        </div>
        <aside className="sketch-side" aria-label="Your fighter">
          <div className="side-card" data-testid="pad-special">
            <span className="side-title">★ Special move</span>
            {shownSpecial ? (
              <span className="side-special">
                <span className="side-icon" aria-hidden="true">
                  {specialIcon(shownSpecial)}
                </span>
                <b>{specialName(shownSpecial)}</b>
              </span>
            ) : (
              <span className="side-note">From your doodles: draw a flame, bolt, drops, snowflake, wings, a shield or spikes next to the fighter.</span>
            )}
            {shownSpecial && <span className="side-note">{specialDesc(shownSpecial)}</span>}
            {locked ? (
              <span className="side-note">Comes with {ready!.name}.</span>
            ) : (
              <button type="button" className="sketch-btn side-btn" data-testid="pad-pick-special" onClick={() => setPanel(panel === "specials" ? "page" : "specials")}>
                {shownSpecial ? "change special" : "★ add a special move"}
              </button>
            )}
          </div>
          <div className="side-card" data-testid="pad-reading" aria-live="polite">
            <span className="side-title">{locked ? ready!.name : "How it reads"}</span>
            {locked ? (
              <span className="side-note">{ready!.blurb}. Same strength as a good drawing, with its own moves.</span>
            ) : reading && reading.kind !== "rock" ? (
              <>
                <span className="side-stats">
                  {reading.kind} · HP {reading.hp} · hits ×{reading.punch.toFixed(1)} · speed ×{reading.speed.toFixed(1)}
                </span>
                <span className="side-note">{reading.why?.[0] ?? "Go over a part again to make it stronger."}</span>
              </>
            ) : inked ? (
              <span className="side-note">Not a fighter yet: give it a head, a body, arms and legs.</span>
            ) : (
              <span className="side-note">Head, body, two arms, two legs. Go over a part again to make it hit harder. Or pick a ready-made fighter.</span>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** a faint dotted stick man on an empty page: where the head, body, arms and legs go */
function GhostGuide() {
  return (
    <svg className="sketch-ghost" viewBox="0 0 300 400" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="2 9" strokeLinecap="round">
        <ellipse cx="150" cy="62" rx="26" ry="28" />
        <path d="M150 92 L150 222" />
        <path d="M150 118 L112 156 L100 196" />
        <path d="M150 118 L188 156 L200 196" />
        <path d="M150 222 L124 296 L116 370" />
        <path d="M150 222 L176 296 L184 370" />
      </g>
      <g className="sketch-ghost-label">
        <text x="186" y="52">head</text>
        <text x="160" y="185">body</text>
        <text x="206" y="196">arm</text>
        <text x="190" y="340">leg</text>
      </g>
    </svg>
  );
}

function FighterPicker({ current, onPick, onBack }: { current: string | null; onPick: (id: string | null) => void; onBack: () => void }) {
  return (
    <div className="pad-picker" role="group" aria-label="Pick a ready-made fighter" data-testid="pad-fighters">
      <div className="pad-picker-head">
        <span className="side-title">Pick a ready-made fighter</span>
        <span className="side-note">It fights as drawn, with its own special. You can&apos;t change the drawing.</span>
        <button type="button" className="sketch-btn" data-testid="pad-picker-back" onClick={onBack}>
          ← back
        </button>
      </div>
      <div className="pad-grid">
        {ROSTER.map((r) => (
          <button key={r.id} type="button" className="pad-card" aria-pressed={current === r.id} data-testid={`pad-fighter-${r.id}`} onClick={() => onPick(r.id)}>
            <RivalThumb strokes={r.strokes as Stroke[]} className="pad-thumb" />
            <span className="pad-card-name">{r.name}</span>
            <span className="pad-card-sub">{r.signature ? `${specialIcon(r.signature)} ${specialName(r.signature)}` : "no special"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SpecialPicker({ current, onPick, onBack }: { current: string | null; onPick: (k: string | null) => void; onBack: () => void }) {
  return (
    <div className="pad-picker" role="group" aria-label="Pick a special move" data-testid="pad-specials">
      <div className="pad-picker-head">
        <span className="side-title">Pick a special move</span>
        <span className="side-note">Moves no doodle gives you. Press ★ (or E) in a fight; it recharges after each use.</span>
        <button type="button" className="sketch-btn" data-testid="pad-picker-back" onClick={onBack}>
          ← back
        </button>
      </div>
      <div className="pad-grid pad-grid-specials">
        <button type="button" className="pad-card pad-special" aria-pressed={!current} data-testid="pad-special-none" onClick={() => onPick(null)}>
          <span className="pad-special-icon" aria-hidden="true">
            ✏️
          </span>
          <span className="pad-card-name">From my doodles</span>
          <span className="pad-card-sub">a flame, bolt, drops, wings… drawn next to the fighter</span>
        </button>
        {PICKABLE.map((k) => (
          <button key={k} type="button" className="pad-card pad-special" aria-pressed={current === k} data-testid={`pad-special-${k}`} onClick={() => onPick(k)}>
            <span className="pad-special-icon" aria-hidden="true">
              {specialIcon(k)}
            </span>
            <span className="pad-card-name">{specialName(k)}</span>
            <span className="pad-card-sub">{specialDesc(k)}</span>
            <span className="pad-card-cool">recharges in {POWER_INFO[k].cooldown}s</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function copy(s: Stroke): Stroke {
  return { ...s, points: s.points.map((p) => ({ x: p.x, y: p.y })) };
}
function prevBrush(w: number) {
  const i = BRUSHES.findIndex((b) => b.w === w);
  return BRUSHES[Math.max(0, i - 1)].w;
}
function nextBrush(w: number) {
  const i = BRUSHES.findIndex((b) => b.w === w);
  return BRUSHES[Math.min(BRUSHES.length - 1, i + 1)].w;
}
