"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROSTER, type Difficulty, type RosterId } from "@nf/sim";
import { judgeDrawing } from "./reading";
import { MIN_STEP2, PENCILS, clamp01, hasInk, paintInk, type Pt, type Stroke } from "./ink";
import { SketchModal } from "./sketch-modal";
import { MAX_FIGHTERS, emptyBook, loadBook, newId, saveBook, strokesOf, type FighterBook } from "./fighters";
import { LEVELS, RivalCard, RivalPicker, RivalThumb } from "./rivals";
import { OfflineHint } from "./offline";
import { GuideButton, HowToPlay, useFirstVisitGuide } from "./guide";

const RIVAL_KEY = "nf:rival";
const LEVEL_KEY = "nf:level";

type Action = "cpu" | "2p" | "room";
const ACTION_NAMES: Record<Action, string> = { cpu: "play with the computer", "2p": "start a 2-player duel", room: "create a room" };

/**
 * The notebook page: your saved fighters (draw several, pick the one you play with, "+" adds a page),
 * and three ways to play, top right: with the computer (pick a pre-drawn rival and a level), two
 * players on this device, or an online room for a friend. Anything that needs a drawing asks for one
 * first. The rivals at the bottom open their character cards.
 */
export function HomeClient() {
  const [book, setBook] = useState<FighterBook>(() => emptyBook());
  const [loaded, setLoaded] = useState(false);
  const [pen, setPen] = useState(PENCILS[0].color);
  const [rival, setRival] = useState<RosterId | "auto">("auto");
  const [level, setLevel] = useState<Difficulty>("normal");
  const [guide, setGuide] = useState(false);
  useFirstVisitGuide(() => setGuide(true));
  /** which fighter (id) is open on the big drawing pad */
  const [big, setBig] = useState<string | null>(null);
  /** "draw your fighter first": which player still needs a drawing, and what to do once there is one */
  const [drawFirst, setDrawFirst] = useState<{ who: "p1" | "p2"; action: Action } | null>(null);
  const [picker, setPicker] = useState(false);
  const [card, setCard] = useState<RosterId | null>(null);
  const router = useRouter();
  const tilesRef = useRef<HTMLDivElement>(null);

  const p1 = strokesOf(book, book.p1);
  const p2 = strokesOf(book, book.p2);

  useEffect(() => {
    const loadedBook = loadBook();
    setBook(loadedBook);
    setLoaded(true);
    // "/?play=cpu" or "/?play=2p" (from the online page when online is busy): straight into that way
    // to play, drawing first if needed
    const want = new URLSearchParams(window.location.search).get("play");
    if (want === "cpu" || want === "2p") {
      window.history.replaceState(null, "", "/");
      requestAnimationFrame(() => start(want, loadedBook));
    }
    try {
      const saved = window.localStorage.getItem(RIVAL_KEY) as RosterId | "auto" | null;
      if (saved && (saved === "auto" || ROSTER.some((r) => r.id === saved))) setRival(saved);
      const lv = window.localStorage.getItem(LEVEL_KEY) as Difficulty | null;
      if (lv && LEVELS.includes(lv)) setLevel(lv);
    } catch {
      // storage blocked
    }
  }, []);

  /** every change is saved at once (and the selected drawings mirrored for the fight pages) */
  function update(fn: (b: FighterBook) => FighterBook) {
    setBook((prev) => {
      const next = fn(prev);
      saveBook(next);
      return next;
    });
  }
  const setStrokes = (id: string, strokes: Stroke[]) => update((b) => ({ ...b, fighters: b.fighters.map((f) => (f.id === id ? { ...f, strokes } : f)) }));
  function addFighter() {
    if (book.fighters.length >= MAX_FIGHTERS) return;
    const id = newId();
    update((b) => ({ ...b, fighters: [...b.fighters, { id, strokes: [] }], p1: id }));
    // the new page scrolls into view, ready to draw on
    requestAnimationFrame(() => tilesRef.current?.querySelector<HTMLElement>(`[data-fid="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }
  function deleteFighter(id: string) {
    update((b) => {
      const fighters = b.fighters.filter((f) => f.id !== id);
      if (!fighters.length) return emptyBook();
      const other = (keep: string) => (fighters.some((f) => f.id === keep) ? keep : fighters[0].id);
      const p1 = other(b.p1);
      const p2 = fighters.some((f) => f.id === b.p2) ? b.p2 : (fighters.find((f) => f.id !== p1) ?? fighters[0]).id;
      return { fighters, p1, p2 };
    });
  }
  function select(who: "p1" | "p2", id: string) {
    update((b) => ({ ...b, [who]: id }));
  }
  function chooseRival(id: RosterId | "auto") {
    setRival(id);
    try {
      window.localStorage.setItem(RIVAL_KEY, id);
    } catch {
      // ignore
    }
  }
  function chooseLevel(d: Difficulty) {
    setLevel(d);
    try {
      window.localStorage.setItem(LEVEL_KEY, d);
    } catch {
      // ignore
    }
  }

  /** the three ways to play; each needs a drawing first */
  function start(action: Action, b: FighterBook = book) {
    const missing = !hasInk(strokesOf(b, b.p1)) ? "p1" : action === "2p" && !hasInk(strokesOf(b, b.p2)) ? "p2" : null;
    if (missing) {
      setDrawFirst({ who: missing, action });
      const id = missing === "p1" ? b.p1 : b.p2;
      requestAnimationFrame(() => {
        const tile = tilesRef.current?.querySelector<HTMLElement>(`[data-fid="${id}"]`);
        tile?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      return;
    }
    setDrawFirst(null);
    saveBook(b);
    if (action === "cpu") setPicker(true);
    else if (action === "2p") router.push("/play?mode=2p");
    else router.push("/online?create=1");
  }
  function fightCpu() {
    setPicker(false);
    saveBook(book);
    const q = new URLSearchParams({ level });
    if (rival !== "auto") q.set("rival", rival);
    router.push(`/play?${q}`);
  }

  const waitingId = drawFirst ? (drawFirst.who === "p1" ? book.p1 : book.p2) : null;
  const waitingReady = waitingId ? hasInk(strokesOf(book, waitingId)) : false;

  return (
    <main className="notebook" data-loaded={loaded ? "true" : "false"}>
      <header className="home-head">
        <div className="home-title">
          <div className="kicker-row">
            <p className="kicker">The notebook</p>
            <GuideButton onOpen={() => setGuide(true)} />
          </div>
          <h1>Draw your fighter</h1>
        </div>
        <nav className="home-nav" aria-label="Play">
          <div className="home-actions">
            <button className="play-link" type="button" data-testid="fight-cpu" onClick={() => start("cpu")}>
              Play with computer
            </button>
            <button className="play-link alt" type="button" data-testid="duel-2p" onClick={() => start("2p")} title="Two players on this device, each with their own drawing">
              2 players
            </button>
            <button className="play-link room" type="button" data-testid="home-room" onClick={() => start("room")} title="Make a room code, send it to a friend, fight online">
              Create a room
            </button>
          </div>
          <div className="home-links">
            <a className="join-link" href="/online" data-testid="home-join">
              <span className="when-wide">or join a friend&apos;s room with a code</span>
              <span className="when-narrow">🔑 Join with a code</span>
            </a>
            <a className="join-link nearby-link" href="/nearby" data-testid="home-nearby" title="Two phones on one hotspot, paired with QR codes">
              <span className="nearby-main">📶 Play nearby</span> <span className="home-nearby-sub">(no internet)</span>
            </a>
          </div>
        </nav>
      </header>
      <p className="pitch">Draw a person: head, body, arms and legs. Go over a part again to make it stronger. A neat, detailed drawing fights a little better.</p>
      {drawFirst && (
        <div className="draw-first" role="alert" data-testid="draw-first">
          <span>
            {waitingReady ? "Got it! " : drawFirst.who === "p1" ? "Draw your fighter first" : "Player 2 needs a fighter too"}
            {waitingReady ? "" : `: draw in the highlighted box to ${ACTION_NAMES[drawFirst.action]}.`}
          </span>
          {waitingReady ? (
            <button type="button" className="play-link" data-testid="draw-first-go" onClick={() => start(drawFirst.action)}>
              {drawFirst.action === "cpu" ? "Choose a rival →" : drawFirst.action === "2p" ? "Start the duel →" : "Create the room →"}
            </button>
          ) : (
            <button type="button" className="text-btn" data-testid="draw-first-big" onClick={() => setBig(waitingId)}>
              ⤢ Draw it big
            </button>
          )}
          <button type="button" className="draw-first-x" aria-label="Not now" onClick={() => setDrawFirst(null)}>
            ✕
          </button>
        </div>
      )}
      <div className="pencils" role="group" aria-label="Pencil colors">
        {PENCILS.map((pencil) => (
          <button key={pencil.color} type="button" className="pencil" style={{ background: pencil.color }} aria-label={pencil.name} aria-pressed={pen === pencil.color} onClick={() => setPen(pencil.color)} />
        ))}
      </div>
      <div className="slots home-slots" ref={tilesRef} data-testid="fighters">
        {book.fighters.map((f, index) => (
          <Slot
            key={f.id}
            id={f.id}
            index={index}
            strokes={f.strokes}
            pen={pen}
            isP1={book.p1 === f.id}
            isP2={book.p2 === f.id}
            needsInk={waitingId === f.id && !waitingReady}
            canDelete={book.fighters.length > 1}
            onChange={(next) => setStrokes(f.id, next)}
            onExpand={() => setBig(f.id)}
            onPick={(who) => select(who, f.id)}
            onDelete={() => deleteFighter(f.id)}
          />
        ))}
        {book.fighters.length < MAX_FIGHTERS ? (
          <button type="button" className="slot-add" data-testid="add-fighter" onClick={addFighter} aria-label={`Add a fighter page (${book.fighters.length} of ${MAX_FIGHTERS})`}>
            <span className="slot-add-plus" aria-hidden="true">
              +
            </span>
            <span className="slot-add-text">new fighter</span>
          </button>
        ) : (
          <p className="slot-full" data-testid="fighters-full">
            {MAX_FIGHTERS} fighters is the most: delete one to draw another.
          </p>
        )}
      </div>
      <div className="home-offline">
        <OfflineHint />
      </div>
      {big !== null && (
        <SketchModal
          title={`Fighter ${book.fighters.findIndex((f) => f.id === big) + 1}${big === book.p1 ? " (you)" : big === book.p2 ? " (player 2)" : ""}`}
          strokes={strokesOf(book, big)}
          pen={pen}
          onPen={setPen}
          onCancel={() => setBig(null)}
          onDone={(next) => {
            const id = big;
            setBig(null);
            const nb: FighterBook = { ...book, fighters: book.fighters.map((f) => (f.id === id ? { ...f, strokes: next } : f)) };
            update(() => nb);
            // asked to draw first: carry on with what you were doing
            if (drawFirst && id === waitingId && hasInk(next)) start(drawFirst.action, nb);
          }}
        />
      )}
      {picker && (
        <RivalPicker
          player={p1}
          rival={rival}
          level={level}
          onRival={chooseRival}
          onLevel={chooseLevel}
          onFight={fightCpu}
          onInfo={(id) => {
            setPicker(false);
            setCard(id);
          }}
          onClose={() => setPicker(false)}
        />
      )}
      {card && (
        <RivalCard
          id={card}
          player={hasInk(p1) ? p1 : null}
          level={level}
          onClose={() => setCard(null)}
          onFight={(id, lv) => {
            setCard(null);
            chooseRival(id);
            chooseLevel(lv);
            start("cpu");
          }}
        />
      )}
      <section className="rival-pick" aria-label="The computer's fighters">
        <h2>The rivals</h2>
        <p className="rival-pick-note">Tap one for its stats, moves and special.</p>
        <div className="rival-grid">
          {ROSTER.map((r) => (
            <button key={r.id} type="button" className="rival-card" data-testid={`rival-${r.id}`} aria-haspopup="dialog" onClick={() => setCard(r.id)}>
              <RivalThumb strokes={r.strokes} />
              <span className="rival-name">{r.name}</span>
              <span className="rival-blurb">{r.blurb}</span>
            </button>
          ))}
        </div>
      </section>
      {guide && <HowToPlay onClose={() => setGuide(false)} />}
      {/* p2 is only read by the 2-player duel; keep it referenced so the selection is visible to tests */}
      <span hidden data-testid="sel" data-p1={book.fighters.findIndex((f) => f.id === book.p1)} data-p2={book.fighters.findIndex((f) => f.id === book.p2)} data-n={book.fighters.length} data-p2ink={hasInk(p2) ? "1" : "0"} />
    </main>
  );
}

function Slot({
  id,
  index,
  strokes,
  pen,
  isP1,
  isP2,
  needsInk,
  canDelete,
  onChange,
  onExpand,
  onPick,
  onDelete,
}: {
  id: string;
  index: number;
  strokes: Stroke[];
  pen: string;
  isP1: boolean;
  isP2: boolean;
  needsInk: boolean;
  canDelete: boolean;
  onChange: (strokes: Stroke[]) => void;
  /** open this drawing on the big drawing pad */
  onExpand: () => void;
  onPick: (who: "p1" | "p2") => void;
  onDelete: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const local = useRef<Stroke[]>(strokes);
  const drawing = useRef(false);
  const penRef = useRef(pen);
  penRef.current = pen;
  const [inked, setInked] = useState(hasInk(strokes));
  const [sure, setSure] = useState(false);
  // live stats as you draw: draw a part over again and watch its number go up
  const card = useMemo(() => (hasInk(strokes) ? judgeDrawing(strokes, index) : null), [strokes, index]);

  useEffect(() => {
    if (drawing.current) return;
    local.current = strokes;
    setInked(hasInk(strokes));
    paintInk(canvasRef.current, strokes);
  }, [strokes]);
  useEffect(() => {
    if (!sure) return;
    const t = setTimeout(() => setSure(false), 3500);
    return () => clearTimeout(t);
  }, [sure]);

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
  /** the tools sit on the drawing: a press on them must never start a stroke or scroll the page */
  const guard = (e: React.PointerEvent) => e.stopPropagation();

  const n = index + 1;
  return (
    <div className={`slot-wrap${isP1 ? " sel-p1" : ""}${isP2 ? " sel-p2" : ""}${needsInk ? " needs-ink" : ""}`} data-fid={id} data-testid={`tile-${index}`}>
      <div className="slot">
        <span className="slot-label">{n}</span>
        {(isP1 || isP2) && (
          <span className="slot-badges">
            {isP1 && <span className="slot-badge p1">You</span>}
            {isP2 && <span className="slot-badge p2">P2</span>}
          </span>
        )}
        {!inked && <span className="slot-hint">{needsInk ? "draw your fighter here" : "draw a fighter"}</span>}
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
            if (last && (next.x - last.x) ** 2 + (next.y - last.y) ** 2 < MIN_STEP2) return;
            stroke.points.push(next);
            paintInk(canvasRef.current, local.current);
          }}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        />
        <div className="slot-tools" onPointerDown={guard} onPointerMove={guard} onTouchStart={(e) => e.stopPropagation()}>
          <button className="slot-expand" type="button" data-testid={`expand-${index}`} onClick={onExpand} aria-label={`Expand fighter ${n}: draw it big with colours and an eraser`} title="Draw big: colours, line weights, eraser, undo">
            ⤢
          </button>
          <button className="slot-clear" type="button" data-testid={`clear-${index}`} onClick={() => onChange([])} aria-label={`Clear fighter ${n}`} title="Clear this drawing" disabled={!inked}>
            clear
          </button>
        </div>
      </div>
      <div className="slot-foot">
        <button type="button" className="slot-pick p1" data-testid={`pick-p1-${index}`} aria-pressed={isP1} onClick={() => onPick("p1")} aria-label={`Play with fighter ${n}`}>
          {isP1 ? (
            <>
              <span className="when-wide">✓ playing</span>
              <span className="when-narrow">✓ you</span>
            </>
          ) : (
            "play this"
          )}
        </button>
        <button type="button" className="slot-pick p2" data-testid={`pick-p2-${index}`} aria-pressed={isP2} onClick={() => onPick("p2")} aria-label={`Fighter ${n} for player 2`} title="Player 2's fighter in a 2-player duel">
          {isP2 ? "✓ P2" : "P2"}
        </button>
        {canDelete && (
          <button type="button" className="slot-del" data-testid={`delete-${index}`} data-sure={sure ? "true" : "false"} onClick={() => (sure ? onDelete() : setSure(true))} aria-label={sure ? `Really delete fighter ${n}?` : `Delete fighter ${n}`}>
            {sure ? "delete?" : "🗑"}
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
