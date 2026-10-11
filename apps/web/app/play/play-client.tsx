"use client";

import { DEFAULT_TUNING, SIM_DT, STORAGE_KEY, STORAGE_KEY_P2, type InkStroke, type PlayerInput, type Tuning } from "@nf/shared";
import type { NotebookView } from "@nf/render";
import type { Difficulty, FighterSnap, FighterStats, FxEvent, NotebookSim, PowerKind, RosterId, SimState } from "@nf/sim";
import { Sfx } from "./sfx";
import { KEYS_1P, KEYS_P1, KEYS_P2, bannerFor, makeReader, paintMeter } from "./controls";
import { makePads } from "./gamepad";
import { TouchPad } from "./touchpad";
import { RotateButton } from "./rotate";
import { watchInputMode } from "./input-mode";
import { PHYSICS_KEY, RENDERER_KEY, chosePixi, pickPhysics, pickRenderer, save, type PhysicsKind, type RendererKind } from "./renderer-pref";

/** one recorded sim frame for replays and clips: the state, its effects, and whether it played in slow-mo */
type Rec = { s: SimState; ev: FxEvent[]; impact: number; slow: boolean };
/** ~5 s of history at 60 Hz */
const HISTORY = 300;
/** the K.O. replay: from ~1.8 s before the final blow to ~0.8 s after, at this speed */
const REPLAY_SPEED = 0.35;
import Link from "next/link";
import { fitArena } from "./arena";
import { useEffect, useRef, useState } from "react";

const SLIDERS: { key: keyof Tuning; label: string; min: number; max: number; step: number }[] = [
  { key: "gravity", label: "Gravity", min: 6, max: 22, step: 0.1 },
  { key: "balanceWn", label: "Pose snap", min: 4, max: 28, step: 0.1 },
  { key: "balanceZeta", label: "Follow-through (low = wobbly)", min: 0.2, max: 1.6, step: 0.01 },
  { key: "muscleScale", label: "Muscle", min: 0.2, max: 3, step: 0.01 },
  { key: "dampingScale", label: "Muscle damping", min: 0.2, max: 3, step: 0.01 },
  { key: "walkForce", label: "Walk force", min: 10, max: 160, step: 1 },
  { key: "walkSpeed", label: "Walk speed", min: 0.4, max: 3.5, step: 0.05 },
  { key: "jabImpulse", label: "Jab impulse", min: 0, max: 3, step: 0.05 },
  { key: "kickImpulse", label: "Kick impulse", min: 0, max: 4, step: 0.05 },
  { key: "hitStopScale", label: "Hit-stop", min: 0, max: 2, step: 0.05 },
];

const LEVELS: Difficulty[] = ["easy", "normal", "hard"];

/** the Fighter Card (plan §5.5): what the drawing's stats are, and why */
type CardData = { kind: string; hp: number; moves: { name: string; mult: number }[]; speed: number; jump: number; lines: string[]; power: string | null; quality: FighterStats["quality"]; name: string | null };
function cardFor(stats: FighterStats, kind: string, moves: { name: string; mult: number }[], power: string | null, name: string | null = null): CardData {
  return { kind, hp: stats.hp, moves, speed: stats.speed, jump: stats.jump, lines: stats.lines.filter((l) => !l.text.startsWith("drawing quality")).map((l) => l.text), power, quality: stats.quality, name };
}

function StatBar({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <span className="stat-track"><span className="stat-fill" style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></span>
      <span className="stat-num">{text}</span>
    </div>
  );
}
const LEVEL_KEY = "nf:level";

export default function PlayClient() {
  const hostRef = useRef<HTMLDivElement>(null);
  const tuningRef = useRef<Tuning>(DEFAULT_TUNING);
  const keysRef = useRef(new Set<string>());
  const tapsRef = useRef(new Set<string>());
  const resetRef = useRef<() => void>(() => {});
  const [tuning, setTuning] = useState<Tuning>(DEFAULT_TUNING);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [moveNames, setMoveNames] = useState<{ punch: string; kick: string; extra: string }>({ punch: "Jab", kick: "Kick", extra: "" });
  const playerFill = useRef<HTMLDivElement>(null);
  const bagFill = useRef<HTMLDivElement>(null);
  const playerNum = useRef<HTMLSpanElement>(null);
  const bagNum = useRef<HTMLSpanElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const roundRef = useRef<HTMLSpanElement>(null);
  const rematchRef = useRef<() => void>(() => {});
  const simRef = useRef<NotebookSim | null>(null);
  const [level, setLevel] = useState<Difficulty>("normal");
  const [cards, setCards] = useState<{ you: CardData; rival: CardData } | null>(null);
  const [cardPinned, setCardPinned] = useState<boolean | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const meterRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const [twoP, setTwoP] = useState(false);
  const cardsRef = useRef<() => void>(() => {});
  const stageRef = useRef<HTMLElement>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const saveClipRef = useRef<() => void>(() => {});
  const [muted, setMuted] = useState(false);
  /** phones: the sound / engine / clip chips, the reading line and the tuners live in this menu */
  const [menuOpen, setMenuOpen] = useState(false);
  const [engine, setEngine] = useState<{ renderer: RendererKind; physics: PhysicsKind; fallback: string | null } | null>(null);
  const [clip, setClip] = useState<"idle" | "recording" | "saved" | "unsupported">("idle");

  useEffect(() => {
    tuningRef.current = tuning;
  }, [tuning]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const keys = keysRef.current;
    const taps = tapsRef.current;
    let stop = false;
    let frame = 0;
    let sim: NotebookSim | null = null;
    let view: NotebookView | null = null;
    let unfit = () => {};

    const onKey = (event: KeyboardEvent, down: boolean) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (event.code === "Space" || key.startsWith("arrow")) event.preventDefault();
      if (down) {
        keys.add(key);
        // latch taps: a press released before the next frame still counts
        if (!event.repeat) taps.add(key);
      } else keys.delete(key);
      if (down && key === "r" && !event.repeat) rematchRef.current();
    };
    const down = (event: KeyboardEvent) => onKey(event, true);
    const up = (event: KeyboardEvent) => onKey(event, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    // sound starts only after a gesture (autoplay rules): the first key or tap unlocks it
    const sfx = new Sfx();
    sfxRef.current = sfx;
    setMuted(sfx.muted);
    const unlock = () => sfx.unlock();
    window.addEventListener("pointerdown", unlock);
    const unwatchInput = watchInputMode();
    window.addEventListener("keydown", unlock);

    void (async () => {
      try {
      const [{ createSim, MOVE_TITLES, moveStriker, POWER_INFO }, { mountView }] = await Promise.all([
        import("@nf/sim"),
        import("@nf/render"),
      ]);
      if (stop || !hostRef.current) return;
      const load = (key: string) => {
        try {
          const raw = window.localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as InkStroke[]) : null;
        } catch {
          return null;
        }
      };
      const drawn = load(STORAGE_KEY);
      const params = new URLSearchParams(window.location.search);
      // "2P duel": two people on one keyboard (or one screen), each with their own drawing
      const versus = params.get("mode") === "2p";
      const drawn2 = versus ? load(STORAGE_KEY_P2) : null;
      setTwoP(versus);
      const aiOn = params.get("ai") !== "off";
      let startLevel: Difficulty = "normal";
      try {
        const saved = (params.get("level") ?? window.localStorage.getItem(LEVEL_KEY)) as Difficulty | null;
        if (saved && LEVELS.includes(saved)) startLevel = saved;
      } catch {
        // storage blocked: Normal
      }
      setLevel(startLevel);
      // with the CPU on, every round opens with "3-2-1 FIGHT!" (the move-capture tests turn the AI off and skip it)
      const created = await createSim({
        player: drawn,
        rival: drawn2,
        ai: versus ? "versus" : aiOn ? "on" : "off",
        difficulty: startLevel,
        countdown: aiOn || versus ? Number(params.get("countdown") ?? 3) : 0,
        // the CPU draws itself a power to match yours (none on Easy, the counter on Hard)
        // K.O. ragdoll: Rapier2D (deterministic build) unless ?physics=classic / the saved toggle says otherwise
        physics: pickPhysics(params),
        // the computer's opponent: a pre-drawn fighter (?rival=bodybuilder|ninja|…, else the computer picks)
        rivalId: versus ? null : params.get("rival") === "sketch" ? null : ((params.get("rival") as RosterId | null) ?? "auto"),
        rivalPower: versus ? null : ((params.get("rivalPower") as PowerKind | "none" | null) === "none" ? null : (params.get("rivalPower") as PowerKind | null) ?? "auto"),
      });
      const rig = created.fighters[0].rig;
      // parts as drawn: a line gone over again is one part drawn darker, not more parts
      const counts = new Map<string, number>();
      const passes = new Map<string, number>();
      rig.parts.forEach((raw, i) => {
        const label = raw.replace(/^power:(.*)$/, "$1 doodle");
        if (rig.over[i] >= 0) passes.set(label, (passes.get(label) ?? 1) + 1);
        else counts.set(label, (counts.get(label) ?? 0) + 1);
      });
      const summary = [...counts].map(([label, n]) => `${n > 1 ? `${n}× ` : ""}${label}${passes.get(label) ? ` (drawn ${passes.get(label)}×)` : ""}`).join(", ");
      const moves = created.fighters[0].anim.moves;
      const title = (m: string | undefined) => (m ? MOVE_TITLES[m as keyof typeof MOVE_TITLES] ?? m : "");
      const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
      const extra = [moves.run ? `run in + F: ${title(moves.run)}` : "", moves.air ? `jump + attack: ${title(moves.air)}` : ""].filter(Boolean).join(" · ");
      setMoveNames({ punch: cap(title(moves.punch)), kick: cap(title(moves.kick)), extra });
      const card = (i: number) => {
        const f = created.fighters[i];
        const mv = f.anim.moves;
        const power = f.special ? `${POWER_INFO[f.special].special} (${POWER_INFO[f.special].cooldown}s) · ${[...f.passives].map((k) => POWER_INFO[k].passive).join(" · ")}` : null;
        return cardFor(f.stats, f.rig.kind, [mv.punch, mv.kick].map((m) => ({ name: cap(title(m)), mult: f.stats.dmg[moveStriker(m)] })), power, i === 1 ? created.rivalEntry?.name ?? null : null);
      };
      setCards({ you: card(0), rival: card(1) });
      // a new level redraws the CPU's power: refresh the cards
      cardsRef.current = () => setCards({ you: card(0), rival: card(1) });
      const article = /^[aeiou]/i.test(rig.kind) ? "an" : "a";
      setReading(
        drawn
          ? `${versus ? "P1: " : "I read "}${article} ${rig.kind}: ${summary}. Moves: ${title(moves.punch)} / ${title(moves.kick)}${extra ? " · " + extra : ""}${created.fighters[0].special ? ` · special: ${POWER_INFO[created.fighters[0].special].special}` : ""}${versus ? ` — P2: ${created.fighters[1].rig.kind}${created.fighters[1].special ? `, special ${POWER_INFO[created.fighters[1].special].special}` : ""}${drawn2 ? "" : " (sketch: P2 can draw one on the notebook page)"}` : ""}`
          : "No drawing found: using a sketch fighter. Draw one in the notebook.",
      );
      if (stop) {
        created.destroy();
        return;
      }
      sim = created;
      // the fight renderer: PixiJS (WebGL) or Canvas2D — Pixi falls back to Canvas2D without WebGL
      const mounted = await mountView(hostRef.current, pickRenderer(params), { allowSoftware: chosePixi(params) });
      setEngine({ renderer: mounted.backend, physics: created.koPhysics, fallback: mounted.fallback });
      if (stop || !sim) {
        mounted.destroy();
        sim?.destroy();
        sim = null;
        return;
      }
      view = mounted;
      unfit = fitArena(view);
      if (versus) view.labels = ["P1", "P2"];
      simRef.current = sim;
      // R mid-fight restarts the round; after a K.O. it goes to the next round (or a new match)
      resetRef.current = () => sim?.reset();
      rematchRef.current = () => {
        if (!sim) return;
        cancelReplay();
        if (sim.curr.over) sim.rematch();
        else sim.reset();
        keys.clear();
      };
      setBooted(true);
      // ---- replay: a ring buffer of recorded frames; the K.O. replays itself in slow-mo; "Save clip" records one
      const hist: Rec[] = [];
      let pushed = 0;
      let slowUntil = 0;
      let koAt = -1;
      let replayAt = 0;
      let lastCount = -1;
      const stats = { replays: 0, slowmoSteps: 0, hitstopSteps: 0, maxHitstop: 0, clips: 0, lastClipBytes: 0, lastClipType: "" };
      let play: { frames: Rec[]; pos: number; speed: number; done: () => void } | null = null;
      const record = (slow: boolean) => {
        const fx = sim!.drainFx();
        if (sim!.hitstop > 0) {
          stats.hitstopSteps++;
          stats.maxHitstop = Math.max(stats.maxHitstop, sim!.hitstop + 1);
        }
        hist.push({ s: sim!.curr, ev: fx.events, impact: fx.impact, slow });
        pushed++;
        if (hist.length > HISTORY) hist.shift();
        if (fx.events.some((e) => e.kind === "ko")) {
          koAt = pushed;
          // the final blow plays in slow motion, then replays itself
          slowUntil = performance.now() + 1300;
          replayAt = performance.now() + 2300;
        }
        return fx;
      };
      const setReplay = (on: boolean) => {
        if (stageRef.current) stageRef.current.dataset.replay = on ? "on" : "off";
      };
      const startReplay = (frames: Rec[], speed: number, caption: string, done: () => void) => {
        if (!view || frames.length < 2) return;
        view.clearFx();
        view.caption = caption;
        setReplay(true);
        play = { frames, pos: 0, speed, done };
      };
      const cancelReplay = () => {
        if (!play) return;
        const d = play.done;
        play = null;
        d();
      };
      const endReplay = () => {
        if (view) {
          view.caption = null;
          view.clearFx();
        }
        setReplay(false);
      };
      saveClipRef.current = () => {
        if (!view || play) return;
        const canvas = view.canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream };
        if (typeof MediaRecorder === "undefined" || !canvas.captureStream) {
          setClip("unsupported");
          return;
        }
        const frames = hist.slice();
        if (frames.length < 20) return;
        const stream = canvas.captureStream(30);
        if (sfx.stream && sfx.state === "running" && !sfx.muted) for (const t of sfx.stream.stream.getAudioTracks()) stream.addTrack(t);
        const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined);
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: "video/webm" });
          stats.clips++;
          stats.lastClipBytes = blob.size;
          stats.lastClipType = mime;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `notebook-fighters-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          for (const t of stream.getTracks()) if (t.kind === "video") t.stop();
          if (view) view.recording = false;
          setClip("saved");
        };
        view.recording = true;
        setClip("recording");
        rec.start(250);
        // the clip: the whole buffer at full speed (slow-mo where the final blow was slowed)
        startReplay(frames, 1, "CLIP", () => {
          endReplay();
          setTimeout(() => rec.state !== "inactive" && rec.stop(), 200);
        });
      };
      // test / debug hook (Playwright drives moves through this)
      const hook = {
        sim,
        view,
        keys,
        sfx,
        stats,
        hist,
        get replaying() {
          return !!play;
        },
        paused: false,
        /** play the sounds of scripted `advance` steps (off by default) */
        sounds: false,
        /** connected game controllers (Gamepad API), for tests and the HUD */
        pads: 0,
        /** step the sim exactly n fixed frames with a scripted input (and P2's in a 2P duel), then draw once */
        advance(n: number, scripted: Partial<PlayerInput> = {}, scripted2: Partial<PlayerInput> = {}) {
          if (!sim || !view) return null;
          const fxAll: ReturnType<NotebookSim["drainFx"]>["events"] = [];
          let impact = 0;
          const idle = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
          const taps = { punch: false, kick: false, jump: false, special: false };
          for (let i = 0; i < n; i++) {
            sim.step({ ...idle, ...scripted, ...(i > 0 ? taps : {}) }, tuningRef.current, { ...idle, ...scripted2, ...(i > 0 ? taps : {}) });
            const fx = record(false);
            fxAll.push(...fx.events);
            impact += fx.impact;
            // tests can hear scripted steps too, sound by sound on the frame each event happens
            if (hook.sounds) sfx.play(fx.events);
          }
          view.draw(sim.curr, sim.prev, 1, fxAll, impact);
          hud();
          return sim.curr;
        },
      };
      (window as unknown as { __nf?: typeof hook }).__nf = hook;

      let acc = 0;
      let last = performance.now();
      // presses wait in each reader until a sim step consumes them (a frame can run zero steps)
      const p1 = makeReader(versus ? KEYS_P1 : KEYS_1P);
      const p2 = makeReader(KEYS_P2);
      // game controllers (Gamepad API): pad 1 plays P1 (or you), pad 2 plays P2
      const pads = makePads();
      const padMaps = versus ? [KEYS_P1, KEYS_P2] : [KEYS_1P];

      const loop = (now: number) => {
        if (stop || !sim || !view) return;
        if (hook.paused) {
          last = now;
          frame = requestAnimationFrame(loop);
          return;
        }
        const real = Math.min((now - last) / 1000, 0.25);
        last = now;
        hook.pads = pads.poll(keys, taps, padMaps);
        if (play) {
          // replaying recorded frames (the K.O. replay or a clip being recorded); the live fight waits
          const p = play;
          const from = Math.floor(p.pos);
          const cur = p.frames[Math.min(from, p.frames.length - 1)];
          p.pos += real * 60 * p.speed * (p.speed >= 1 && cur.slow ? 0.3 : 1);
          const idx = Math.min(Math.floor(p.pos), p.frames.length - 1);
          const ev: FxEvent[] = [];
          let impact = 0;
          for (let i = from + 1; i <= idx; i++) {
            ev.push(...p.frames[i].ev);
            impact += p.frames[i].impact;
          }
          const next = p.frames[Math.min(idx + 1, p.frames.length - 1)];
          view.draw(next.s, p.frames[idx].s, Math.min(1, p.pos - idx), ev, impact);
          sfx.play(ev);
          taps.clear();
          if (idx >= p.frames.length - 1) {
            play = null;
            p.done();
          }
          frame = requestAnimationFrame(loop);
          return;
        }
        // the final blow lands in slow motion
        const slow = now < slowUntil;
        if (slow) stats.slowmoSteps++;
        acc += real * (slow ? 0.3 : 1);
        const ev: FxEvent[] = [];
        let impact = 0;
        while (acc >= SIM_DT) {
          const input = p1.read(keys, taps);
          const input2 = versus ? p2.read(keys, taps) : undefined;
          taps.clear();
          sim.step(input, tuningRef.current, input2);
          const fx = record(slow);
          ev.push(...fx.events);
          impact += fx.impact;
          acc -= SIM_DT;
          p1.used();
          p2.used();
        }
        // a tap between steps still lands on the next step
        if (taps.size) {
          p1.read(keys, taps);
          if (versus) p2.read(keys, taps);
          taps.clear();
        }
        const alpha = acc / SIM_DT;
        view.draw(sim.curr, sim.prev, alpha, ev, impact);
        sfx.play(ev);
        // countdown: a classroom clock tick each second, the school bell on FIGHT!
        const count = Math.ceil(sim.curr.countdown);
        if (count !== lastCount) {
          if (count > 0) sfx.tick();
          else if (lastCount > 0) sfx.schoolBell();
          lastCount = count;
        }
        hud();
        // auto-replay the K.O. once the dust settles
        if (koAt > 0 && now >= replayAt && sim.curr.over) {
          const back = pushed - koAt;
          const end = Math.min(hist.length - 1, hist.length - 1 - back + 48);
          const start = Math.max(0, hist.length - 1 - back - 110);
          koAt = -1;
          startReplay(hist.slice(start, end + 1), REPLAY_SPEED, `REPLAY ×${REPLAY_SPEED}`, () => {
            stats.replays++;
            endReplay();
          });
        }
        frame = requestAnimationFrame(loop);
      };
      /** health bars, special meters, banner, round line, card fold */
      const hud = () => {
        if (!sim) return;

        const player = Math.max(0, sim.curr.playerHp);
        const bag = Math.max(0, sim.curr.bagHp);
        if (playerFill.current) playerFill.current.style.transform = `scaleX(${player / sim.curr.playerMax})`;
        if (bagFill.current) bagFill.current.style.transform = `scaleX(${bag / sim.curr.bagMax})`;
        // the fighter card opens itself between rounds (countdown, K.O.) and folds away while fighting
        const auto = sim.curr.countdown > 0 || sim.curr.over ? "true" : "false";
        if (cardRef.current && cardRef.current.dataset.auto !== auto) cardRef.current.dataset.auto = auto;
        paintMeter(meterRefs[0].current, sim.curr.fighters[0]);
        paintMeter(meterRefs[1].current, sim.curr.fighters[1]);
        if (playerNum.current) playerNum.current.textContent = String(Math.ceil(player));
        if (bagNum.current) bagNum.current.textContent = String(Math.ceil(bag));
        const b = bannerFor(sim.curr, versus);
        const el = bannerRef.current;
        if (el && el.dataset.text !== b.text + b.sub) {
          el.dataset.text = b.text + b.sub;
          el.dataset.kind = b.kind;
          (el.firstChild as HTMLElement).textContent = b.text;
          (el.lastChild as HTMLElement).textContent = b.sub;
        }
        if (roundRef.current) {
          const r = `Round ${sim.curr.round} · ${sim.curr.wins[0]}–${sim.curr.wins[1]} · best of 3`;
          if (roundRef.current.textContent !== r) roundRef.current.textContent = r;
        }
      };
      frame = requestAnimationFrame(loop);
      } catch (err) {
        if (!stop) setBootError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      stop = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("pointerdown", unlock);
      unwatchInput();
      window.removeEventListener("keydown", unlock);
      void sfx.ctx?.close().catch(() => {});
      view?.destroy();
      sim?.destroy();
      unfit();
      view = null;
      sim = null;
      resetRef.current = () => {};
      rematchRef.current = () => {};
      simRef.current = null;
    };
  }, []);

  const pickLevel = (next: Difficulty) => {
    setLevel(next);
    try {
      window.localStorage.setItem(LEVEL_KEY, next);
    } catch {
      // ignore
    }
    // a new difficulty starts a fresh match
    simRef.current?.setDifficulty(next);
    simRef.current?.reset(true);
    cardsRef.current();
  };

  return (
    <main className="stage" ref={stageRef} data-replay="off" data-menu={menuOpen ? "open" : "closed"}>
      <div className="canvas-host" ref={hostRef} />
      {!booted && <p className="boot">{bootError ?? "Sharpening pencils…"}</p>}
      {reading && <p className="reading" data-testid="reading">{reading}</p>}
      <div
        className="banner"
        ref={bannerRef}
        data-testid="banner"
        data-kind=""
        onPointerDown={() => {
          if (simRef.current?.curr.over) rematchRef.current();
        }}
      >
        <p className="banner-text" />
        <p className="banner-sub" />
      </div>
      <RotateButton />
      <div className="overlay">
        <div className="topbar">
          <Link className="back" href="/">
            ← notebook
          </Link>
          <button type="button" className="menu-toggle" data-testid="menu" aria-expanded={menuOpen} aria-label="Menu: sound, engine, clip, tuners" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? "✕" : "☰"}
          </button>
          <span className="fx-buttons">
            <Link className="menu-back" href="/" data-testid="menu-back">
              ← notebook
            </Link>
            <button
              type="button"
              data-testid="mute"
              aria-pressed={muted}
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => {
                const s = sfxRef.current;
                if (!s) return;
                s.unlock();
                s.setMuted(!s.muted);
                setMuted(s.muted);
              }}
            >
              {muted ? "🔇 sound off" : "🔊 sound on"}
            </button>
            <button
              type="button"
              data-testid="renderer-toggle"
              data-renderer={engine?.renderer ?? ""}
              title={engine?.fallback ? `Pixi unavailable (${engine.fallback}) — using Canvas2D` : "Switch the fight renderer (reloads the fight)"}
              onClick={() => {
                const next = engine?.renderer === "pixi" ? "canvas" : "pixi";
                save(RENDERER_KEY, next);
                const q = new URLSearchParams(window.location.search);
                q.delete("renderer");
                window.location.search = q.toString();
              }}
            >
              {engine ? (engine.renderer === "pixi" ? "🖌 Pixi (WebGL)" : "🖌 Canvas2D") : "🖌 …"}
            </button>
            <button
              type="button"
              data-testid="physics-toggle"
              data-physics={engine?.physics ?? ""}
              title="K.O. ragdoll physics: Rapier2D (deterministic) or the classic verlet ragdoll (reloads the fight)"
              onClick={() => {
                const next = engine?.physics === "rapier" ? "classic" : "rapier";
                save(PHYSICS_KEY, next);
                const q = new URLSearchParams(window.location.search);
                q.delete("physics");
                window.location.search = q.toString();
              }}
            >
              {engine ? (engine.physics === "rapier" ? "KO: Rapier" : "KO: classic") : "KO: …"}
            </button>
            <button type="button" data-testid="save-clip" disabled={clip === "recording"} onClick={() => saveClipRef.current()} title="Save the last ~5 seconds as a WebM video">
              {clip === "recording" ? "● recording…" : clip === "saved" ? "Saved ✓ (save again)" : clip === "unsupported" ? "No recorder in this browser" : "● Save clip"}
            </button>
          </span>
          <div className="bars" aria-label="Health">
            <div>
              <div className="bar-label"><span>{twoP ? "P1" : "You"}</span><span ref={playerNum}>100</span></div>
              <div className="track"><div className="fill" ref={playerFill} /></div>
              <div className="meter" ref={meterRefs[0]} data-testid="meter-0" data-state="none"><span className="meter-fill" /><span className="meter-label" /></div>
            </div>
            <div>
              <div className="bar-label"><span>{twoP ? "P2" : "Rival"}</span><span ref={bagNum}>100</span></div>
              <div className="track"><div className="fill bag" ref={bagFill} /></div>
              <div className="meter" ref={meterRefs[1]} data-testid="meter-1" data-state="none"><span className="meter-fill" /><span className="meter-label" /></div>
            </div>
            <div className="round-row">
              <span ref={roundRef} data-testid="round">Round 1 · 0–0 · best of 3</span>
              {twoP ? <span className="levels">2P duel</span> : <span className="levels" role="group" aria-label="Difficulty">
                {LEVELS.map((l) => (
                  <button key={l} type="button" aria-pressed={level === l} onClick={() => pickLevel(l)}>
                    {l.charAt(0).toUpperCase() + l.slice(1)}
                  </button>
                ))}
              </span>}
            </div>
          </div>
        </div>
        <div />
        {twoP ? (
          <div className="bottombar two-p">
            {([0, 1] as const).map((p) => {
              const m = p === 0 ? KEYS_P1 : KEYS_P2;
              const k = (key: string) => (key === " " ? "Space" : key.startsWith("arrow") ? { arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" }[key] : key.toUpperCase());
              return (
                <div className={`player-side p${p + 1}`} key={p} data-testid={`legend-p${p + 1}`}>
                  <p className="hint" data-testid={`keys-legend-p${p + 1}`}>
                    <b>P{p + 1}</b> <kbd>{k(m.left[0])}</kbd> <kbd>{k(m.right[0])}</kbd> walk · <kbd>{k(m.jump[0])}</kbd> jump · <kbd>{k(m.crouch[0])}</kbd> crouch · <kbd>{k(m.punch[0])}</kbd> {p === 0 ? moveNames.punch.toLowerCase() : "punch"} · <kbd>{k(m.kick[0])}</kbd> {p === 0 ? moveNames.kick.toLowerCase() : "kick"} · <kbd>{k(m.block[0])}</kbd> block · <kbd>{k(m.special[0])}</kbd> special
                  </p>
                  <TouchPad map={m} keys={keysRef} taps={tapsRef} who={`P${p + 1}`} punch="Hit" kick="Kick" compact />
                </div>
              );
            })}
          </div>
        ) : (
        <div className="bottombar">
          <p className="hint" data-testid="keys-legend">
            <kbd>A</kbd> <kbd>D</kbd> walk · <kbd>F</kbd> {moveNames.punch.toLowerCase()} · <kbd>G</kbd> {moveNames.kick.toLowerCase()} · <kbd>Space</kbd> jump · <kbd>H</kbd> block · <kbd>S</kbd> crouch · <kbd>E</kbd> special · <kbd>R</kbd> restart round / next round{moveNames.extra ? ` · ${moveNames.extra}` : ""}
          </p>
          <TouchPad map={KEYS_1P} keys={keysRef} taps={tapsRef} punch={moveNames.punch} kick={moveNames.kick} />
        </div>
        )}
      </div>
      {cards && (
        <aside className="fighter-card" ref={cardRef} data-testid="fighter-card" data-auto="true" data-pinned={cardPinned === null ? "auto" : String(cardPinned)}>
          <button type="button" className="card-toggle" onClick={() => setCardPinned((p) => !(p ?? cardRef.current?.dataset.auto === "true"))}>
            Fighter card
          </button>
          <div className="card-body">
            <p className="card-title">{twoP ? "P1" : "You"} · {cards.you.kind}</p>
            <StatBar label="HP" value={cards.you.hp} max={160} text={String(cards.you.hp)} />
            {cards.you.moves.map((m) => (
              <StatBar key={m.name} label={m.name} value={m.mult} max={1.8} text={`×${m.mult.toFixed(2)}`} />
            ))}
            <StatBar label="Speed" value={cards.you.speed} max={1.5} text={`×${cards.you.speed.toFixed(2)}`} />
            <div className="card-quality" data-testid="card-quality" title={`detail ${Math.round(cards.you.quality.detail * 100)} · closed head ${Math.round(cards.you.quality.closed * 100)} · symmetry ${Math.round(cards.you.quality.symmetry * 100)} · dark parts ${Math.round(cards.you.quality.dark * 100)} · add-ons ${Math.round(cards.you.quality.addons * 100)}`}>
              <StatBar label="Drawing" value={cards.you.quality.score} max={100} text={`${cards.you.quality.score}/100`} />
              <p className="card-qline">
                {cards.you.quality.score >= 10 ? `Neat, detailed drawing: HP +${Math.round(cards.you.quality.hp * 100)}%, hits +${Math.round(cards.you.quality.dmg * 100)}%` : "A quick sketch: add detail, close the head, keep arms and legs even"}
                {" · "}
                {[["detail", cards.you.quality.detail], ["closed head", cards.you.quality.closed], ["symmetry", cards.you.quality.symmetry], ["dark parts", cards.you.quality.dark], ["add-ons", cards.you.quality.addons]].map(([k, v]) => `${k} ${Math.round((v as number) * 100)}`).join(" · ")}
              </p>
            </div>
            <p className="card-power" data-testid="card-power">{cards.you.power ? `★ ${cards.you.power}` : "No power doodle: draw a flame, bolt, drops, wings, a shield or spikes on for a special"}</p>
            <ul className="card-why">
              {(cards.you.lines.length ? cards.you.lines.slice(0, 5) : ["One pass everywhere. Draw a part over again to make it stronger."]).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="card-rival">
              {twoP ? "P2" : cards.rival.name ? `Rival: ${cards.rival.name}` : "Rival"} · {cards.rival.kind}: HP {cards.rival.hp} · {cards.rival.moves.map((m) => `${m.name.toLowerCase()} ×${m.mult.toFixed(2)}`).join(" · ")} · speed ×{cards.rival.speed.toFixed(2)}{cards.rival.power ? ` · ★ ${cards.rival.power}` : ""}
            </p>
          </div>
        </aside>
      )}
      <aside className="tune" data-open={tuneOpen ? "true" : "false"}>
        <button type="button" className="tune-toggle" onClick={() => setTuneOpen((open) => !open)}>
          {tuneOpen ? "Hide tuners" : "Tuners"}
        </button>
        <div className="tune-body">
          <h2>Feel</h2>
          {SLIDERS.map((slider) => (
            <label className="slider" key={slider.key}>
              <span>{slider.label}</span>
              <span>{tuning[slider.key].toFixed(slider.step < 1 ? 2 : 0)}</span>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={tuning[slider.key]}
                aria-label={slider.label}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setTuning((current) => ({ ...current, [slider.key]: value }));
                }}
              />
            </label>
          ))}
          <div className="tune-actions">
            <button type="button" className="text-btn" onClick={() => setTuning(DEFAULT_TUNING)}>
              Defaults
            </button>
            <button type="button" className="text-btn" onClick={() => resetRef.current()}>
              Reset fight
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}
