"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BOX_ASPECT, BRUSHES, MIN_STEP2, PENCILS, clamp01, eraseStrokes, hasInk, paintInk, type Pt, type Stroke } from "./ink";

type Tool = "pencil" | "eraser";

/**
 * The big drawing pad: the same fighter drawing as the small box, near full screen, with the
 * coloured pencils, line weights, an eraser that really cuts strokes, undo/redo and clear.
 * Done hands the edited strokes back (same 0..1 box coordinates, so nothing needs rescaling);
 * Cancel or Escape leaves the drawing as it was.
 */
export function SketchModal({
  title,
  strokes,
  pen,
  onPen,
  onDone,
  onCancel,
}: {
  title: string;
  strokes: Stroke[];
  pen: string;
  onPen: (color: string) => void;
  onDone: (strokes: Stroke[]) => void;
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
  // history: past states, the current one, and undone states
  const [hist, setHist] = useState<{ past: Stroke[][]; now: Stroke[]; future: Stroke[][] }>(() => ({ past: [], now: strokes.map(copy), future: [] }));
  const work = useRef<Stroke[]>(hist.now);
  const active = useRef<{ id: number; before: Stroke[]; last: Pt } | null>(null);

  const eraserR = 0.014 + 0.016 * brush;
  const repaint = useCallback(() => paintInk(canvasRef.current, work.current), []);

  // keep the working copy in step with the history (undo / redo / clear)
  useEffect(() => {
    if (active.current) return;
    work.current = hist.now;
    repaint();
  }, [hist.now, repaint, box]);

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
  const done = useCallback(() => onDone(work.current.filter((s) => s.points.length > 1)), [onDone]);

  const pickColor = (c: string) => {
    setColor(c);
    setTool("pencil");
    onPen(c);
  };

  // keyboard: Esc cancels, Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z or Ctrl+Y redo, E eraser, P pencil, 1-8 colours, [ ] line weight
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab") {
        // keep focus inside the dialog
        const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && (i <= 0)) {
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
    c.style.opacity = tool === "eraser" && e.pointerType !== "touch" ? "1" : tool === "eraser" && active.current ? "1" : "0";
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (active.current || (e.pointerType === "mouse" && e.button !== 0)) return;
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
  return (
    <div className="sketch-backdrop" data-testid="sketch-modal">
      <div className="sketch" ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Draw ${title} — big page`}>
        <div className="sketch-tools" role="toolbar" aria-label="Drawing tools">
          <div className="sketch-head">
            <span className="sketch-title">{title}</span>
          </div>
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
                {...(color === p.color ? { "data-autofocus": true } : {})}
                onClick={() => pickColor(p.color)}
              />
            ))}
          </div>
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
                onClick={() => setBrush(b.w)}
              >
                <span style={{ width: `${0.25 + b.w * 0.32}rem`, height: `${0.25 + b.w * 0.32}rem`, background: tool === "eraser" ? "#fffaf1" : color }} />
              </button>
            ))}
          </div>
          <div className="sketch-group" role="group" aria-label="Tools">
            <button type="button" className="sketch-btn" aria-pressed={tool === "pencil"} data-testid="sketch-pencil" title="Pencil (P)" onClick={() => setTool("pencil")}>
              ✎ pencil
            </button>
            <button type="button" className="sketch-btn" aria-pressed={tool === "eraser"} data-testid="sketch-eraser" title="Eraser (E)" onClick={() => setTool("eraser")}>
              ⌫ eraser
            </button>
            <button type="button" className="sketch-btn" data-testid="sketch-undo" title="Undo (Ctrl/⌘+Z)" disabled={!hist.past.length} onClick={undo}>
              ↶ undo
            </button>
            <button type="button" className="sketch-btn" data-testid="sketch-redo" title="Redo (Ctrl/⌘+Shift+Z)" disabled={!hist.future.length} onClick={redo}>
              ↷ redo
            </button>
            <button type="button" className="sketch-btn" data-testid="sketch-clear" title="Clear the page" disabled={!inked} onClick={clear}>
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
          <div className="sketch-page" style={box ? { width: box.w, height: box.h } : { visibility: "hidden" }} data-tool={tool}>
            {!inked && <span className="slot-hint">draw a fighter</span>}
            <canvas
              ref={canvasRef}
              data-testid="sketch-canvas"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              onPointerLeave={(e) => {
                if (!active.current && cursorRef.current) cursorRef.current.style.opacity = "0";
                void e;
              }}
              onContextMenu={(e) => e.preventDefault()}
            />
            <div className="sketch-cursor" ref={cursorRef} aria-hidden="true" />
          </div>
        </div>
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
