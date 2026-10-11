"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { STORAGE_KEY, STORAGE_KEY_P2 } from "@nf/shared";
import { ROSTER, type RosterId } from "@nf/sim";
import { judgeDrawing } from "./reading";

type Pt = { x: number; y: number };
type Stroke = { color: string; points: Pt[] };

const PENCILS = [
  { name: "Pencil", color: "#2a241c" },
  { name: "Red", color: "#c23b32" },
  { name: "Blue", color: "#1d4f89" },
  { name: "Green", color: "#2f7d4a" },
  { name: "Orange", color: "#e07a2f" },
  { name: "Purple", color: "#6d4ca8" },
  { name: "Gold", color: "#c4962c" },
  { name: "Pink", color: "#d45d8c" },
];
const RIVAL_KEY = "nf:rival";

function hasInk(strokes: Stroke[]) {
  return strokes.some((stroke) => stroke.points.length > 1);
}

/**
 * The notebook page: draw your fighter (box 1), pick who you fight (a pre-drawn computer fighter, or let
 * the computer pick), and go. Box 2 is for a second player on the same device (2P duel).
 */
export function HomeClient() {
  const [boxes, setBoxes] = useState<Stroke[][]>(() => [[], []]);
  const [pen, setPen] = useState(PENCILS[0].color);
  const [rival, setRival] = useState<RosterId | "auto">("auto");
  const router = useRouter();
  const ready = hasInk(boxes[0]);
  const twoReady = hasInk(boxes[0]) && hasInk(boxes[1]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RIVAL_KEY) as RosterId | "auto" | null;
      if (saved && (saved === "auto" || ROSTER.some((r) => r.id === saved))) setRival(saved);
    } catch {
      // storage blocked
    }
  }, []);

  function save(key: string, strokes: Stroke[]) {
    try {
      window.localStorage.setItem(key, JSON.stringify(strokes));
    } catch {
      // storage blocked: the fight falls back to a sketch fighter
    }
  }
  function chooseRival(id: RosterId | "auto") {
    setRival(id);
    try {
      window.localStorage.setItem(RIVAL_KEY, id);
    } catch {
      // ignore
    }
  }
  /** 1 player vs the computer: a normal 1v1 duel against the chosen pre-drawn fighter */
  function fight(strokes: Stroke[] = boxes[0]) {
    save(STORAGE_KEY, strokes);
    router.push(rival === "auto" ? "/play" : `/play?rival=${rival}`);
  }
  function duel2p() {
    save(STORAGE_KEY, boxes[0]);
    save(STORAGE_KEY_P2, boxes[1]);
    router.push("/play?mode=2p");
  }
  function online() {
    if (hasInk(boxes[0])) save(STORAGE_KEY, boxes[0]);
    router.push("/online");
  }

  return (
    <main className="notebook">
      <p className="kicker">The notebook</p>
      <h1>Draw your fighter</h1>
      <p className="pitch">Draw a person: head, body, arms and legs. Go over a part again to make it stronger. A neat, detailed drawing fights a little better.</p>
      <div className="pencils" role="group" aria-label="Pencil colors">
        {PENCILS.map((pencil) => (
          <button
            key={pencil.color}
            type="button"
            className="pencil"
            style={{ background: pencil.color }}
            aria-label={pencil.name}
            aria-pressed={pen === pencil.color}
            onClick={() => setPen(pencil.color)}
          />
        ))}
      </div>
      <div className="slots home-slots">
        {boxes.map((strokes, index) => (
          <Slot
            key={index}
            index={index}
            strokes={strokes}
            pen={pen}
            onChange={(next) => setBoxes((prev) => prev.map((slot, i) => (i === index ? next : slot)))}
            onDuel={() => fight(strokes)}
            player={index + 1}
            title={index === 0 ? "You" : "Player 2 (optional)"}
          />
        ))}
      </div>
      <section className="rival-pick" aria-label="Choose your opponent">
        <h2>Who do you fight?</h2>
        <div className="rival-grid">
          <button type="button" className="rival-card" data-testid="rival-auto" aria-pressed={rival === "auto"} onClick={() => chooseRival("auto")}>
            <span className="rival-q">?</span>
            <span className="rival-name">Computer picks</span>
            <span className="rival-blurb">a fair match for the level</span>
          </button>
          {ROSTER.map((r) => (
            <button key={r.id} type="button" className="rival-card" data-testid={`rival-${r.id}`} aria-pressed={rival === r.id} onClick={() => chooseRival(r.id)}>
              <RivalThumb strokes={r.strokes} />
              <span className="rival-name">{r.name}</span>
              <span className="rival-blurb">{r.blurb}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="home-actions">
        <button className="play-link" type="button" data-testid="fight-cpu" disabled={!ready} onClick={() => fight()}>
          {ready ? `Fight ${rival === "auto" ? "the computer" : ROSTER.find((r) => r.id === rival)?.name} →` : "Draw your fighter first"}
        </button>
        <button className="text-btn" type="button" data-testid="duel-2p" disabled={!twoReady} onClick={duel2p}>
          {twoReady ? "2P duel →" : "2P: both players draw first"}
        </button>
        <button className="text-btn" type="button" data-testid="online-duel" onClick={online} title="Create a room, send the code to a friend, fight online">
          Online duel →
        </button>
      </div>
    </main>
  );
}

function RivalThumb({ strokes }: { strokes: Stroke[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    paintInk(ref.current, strokes);
  }, [strokes]);
  return <canvas ref={ref} className="rival-thumb" aria-hidden="true" />;
}

function Slot({
  index,
  strokes,
  pen,
  onChange,
  onDuel,
  player = 0,
  title,
}: {
  index: number;
  strokes: Stroke[];
  pen: string;
  onChange: (strokes: Stroke[]) => void;
  onDuel: () => void;
  /** 1 or 2 when this box is a 2P duellist */
  player?: number;
  title?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const local = useRef<Stroke[]>(strokes);
  const drawing = useRef(false);
  const penRef = useRef(pen);
  penRef.current = pen;
  const [inked, setInked] = useState(hasInk(strokes));
  // live stats as you draw: draw a part over again and watch its number go up
  const card = useMemo(() => (hasInk(strokes) ? judgeDrawing(strokes, index) : null), [strokes, index]);

  useEffect(() => {
    if (drawing.current) return;
    local.current = strokes;
    setInked(hasInk(strokes));
    paintInk(canvasRef.current, strokes);
  }, [strokes]);

  function point(event: React.PointerEvent<HTMLCanvasElement>): Pt {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function finishStroke() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(local.current.filter((stroke) => stroke.points.length > 1));
  }

  return (
    <div className="slot-wrap">
    <div className="slot">
      <span className="slot-label">{index + 1}</span>
      {player > 0 && <span className={`slot-badge p${player}`}>{title ? title.replace(" (optional)", "") : `P${player}`}{title?.includes("(optional)") && <span className="opt"> (optional)</span>}</span>}
      {!inked && <span className="slot-hint">draw a fighter</span>}
      <canvas
        ref={canvasRef}
        data-testid={`slot-${index}`}
        onPointerDown={(event) => {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Drawing still works if the browser refuses capture.
          }
          drawing.current = true;
          setInked(true);
          local.current = [...local.current, { color: penRef.current, points: [point(event)] }];
          paintInk(canvasRef.current, local.current);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const stroke = local.current[local.current.length - 1];
          const next = point(event);
          const last = stroke.points[stroke.points.length - 1];
          if (last && (next.x - last.x) ** 2 + (next.y - last.y) ** 2 < 0.00004) return;
          stroke.points.push(next);
          paintInk(canvasRef.current, local.current);
        }}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      />
      <button
        className="slot-clear"
        type="button"
        onClick={() => onChange([])}
        aria-label={`Clear fighter ${index + 1}`}
      >
        clear
      </button>
      {inked && (
        <button className="slot-duel" type="button" onClick={onDuel} aria-label={`Duel with fighter ${index + 1}`}>
          duel →
        </button>
      )}
    </div>
      {card && card.kind !== "rock" && (
        <p className="slot-stats" data-testid={`slot-stats-${index}`} title={(card.why ?? []).join("\n")}>
          <span>HP {card.hp} · hits ×{card.punch.toFixed(1)} · speed ×{card.speed.toFixed(1)}</span>
          <span className="slot-why">{card.why?.[0] ?? "draw a part again to make it stronger"}</span>
        </p>
      )}
    </div>
  );
}

function paintInk(canvas: HTMLCanvasElement | null, strokes: Stroke[]) {
  if (!canvas) return;
  const size = fit(canvas);
  if (!size) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size.w, size.h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    // fine pencil lines (w < 1) still get at least ~0.5 css px so they read on the small card
    ctx.lineWidth = Math.max(0.5 * size.dpr, Math.max(2, size.w * 0.012) * ((stroke as { w?: number }).w ?? 1));
    ctx.strokeStyle = stroke.color;
    ctx.beginPath();
    stroke.points.forEach((pt, i) => {
      const x = pt.x * size.w;
      const y = pt.y * size.h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function fit(canvas: HTMLCanvasElement): { w: number; h: number; dpr: number } | null {
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

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

