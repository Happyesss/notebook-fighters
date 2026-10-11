"use client";

/**
 * The fight half of a two-device duel, shared by online rooms (/online) and play nearby (/nearby):
 * keyboard / touch / gamepad input, the fixed 60 Hz loop driving an OnlineSession, the renderer, the
 * HUD (health, power meters, banner, ping · input delay · sync line) and the sounds. The page owns
 * the connection; this only needs a way to get the current session.
 */
import { SIM_DT, type PlayerInput } from "@nf/shared";
import type { NotebookView } from "@nf/render";
import type { FxEvent, OnlineSession } from "@nf/sim";
import Link from "next/link";
import { useRef, type RefObject } from "react";
import { KEYS_1P, bannerFor, makeReader, paintMeter } from "../play/controls";
import { makePads } from "../play/gamepad";
import { TouchPad } from "../play/touchpad";
import { watchInputMode } from "../play/input-mode";
import { fitArena } from "../play/arena";
import { Sfx } from "../play/sfx";
import { chosePixi, pickRenderer } from "../play/renderer-pref";

/** the same scripted fighter the headless test uses (seeded, so a run can be repeated) */
export function scriptedFighter(seed: number) {
  let s = seed >>> 0 || 1;
  const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const idle: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
  return (session: OnlineSession): PlayerInput => {
    const sim = session.sim;
    if (!sim) return idle;
    const me = session.seat;
    const self = sim.fighters[me];
    const foe = sim.fighters[1 - me];
    const toward = foe.x > self.x ? 1 : -1;
    const v = r();
    return { ...idle, x: v < 0.55 ? toward : v < 0.62 ? -toward : 0, punch: r() < 0.12, kick: r() < 0.08, jump: r() < 0.01, block: r() < 0.01, special: r() < 0.02 };
  };
}

export type DuelHud = {
  host: RefObject<HTMLDivElement | null>;
  net: RefObject<HTMLSpanElement | null>;
  fills: RefObject<HTMLDivElement | null>[];
  nums: RefObject<HTMLSpanElement | null>[];
  meters: RefObject<HTMLDivElement | null>[];
  banner: RefObject<HTMLDivElement | null>;
  round: RefObject<HTMLSpanElement | null>;
  keys: RefObject<Set<string>>;
  taps: RefObject<Set<string>>;
};

export function useDuelHud(): DuelHud {
  return {
    host: useRef<HTMLDivElement>(null),
    net: useRef<HTMLSpanElement>(null),
    fills: [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)],
    nums: [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)],
    meters: [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)],
    banner: useRef<HTMLDivElement>(null),
    round: useRef<HTMLSpanElement>(null),
    keys: useRef(new Set<string>()),
    taps: useRef(new Set<string>()),
  };
}

export type DuelRun = {
  stop(): void;
  readonly view: NotebookView | null;
  sfx: Sfx;
  stats: { viewFps: number };
};

/**
 * Start input + the render loop. The loop idles until getSession() has a lockstep (the fight
 * started), mounts the renderer once, then calls onFight with the names to show ("You" for your seat).
 */
export function startDuel(opts: { hud: DuelHud; params: URLSearchParams; getSession: () => OnlineSession | null; onFight: (names: [string, string]) => void; lag?: number; jitter?: number }): DuelRun {
  const { hud, params, getSession, onFight } = opts;
  const lag = opts.lag ?? 0;
  const jitter = opts.jitter ?? 0;
  const keys = hud.keys.current;
  const taps = hud.taps.current;
  let stop = false;
  let raf = 0;
  let view: NotebookView | null = null;
  let unfit = () => {};
  let mounting = false;
  let viewFor: OnlineSession | null = null;
  const auto = params.get("autoplay");
  const brain = auto ? scriptedFighter(Number(auto) || 1) : null;
  const reader = makeReader(KEYS_1P);
  // a game controller (Gamepad API) plays like the keyboard
  const pads = makePads();
  const sfx = new Sfx();
  const unlock = () => sfx.unlock();
  const stats = { viewFps: 0 };

  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (e.code === "Space" || k.startsWith("arrow")) e.preventDefault();
    if (down) {
      keys.add(k);
      if (!e.repeat) taps.add(k);
    } else keys.delete(k);
  };
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);
  window.addEventListener("pointerdown", unlock);
  const unwatchInput = watchInputMode();
  window.addEventListener("keydown", unlock);

  const paintHud = (session: OnlineSession) => {
    const sim = session.sim;
    const lock = session.lock;
    if (!sim || !lock) return;
    const st = sim.curr;
    const hp = [st.playerHp, st.bagHp];
    const max = [st.playerMax, st.bagMax];
    for (let i = 0; i < 2; i++) {
      const el = hud.fills[i].current;
      if (el) el.style.transform = `scaleX(${Math.max(0, hp[i]) / max[i]})`;
      const n = hud.nums[i].current;
      if (n) n.textContent = String(Math.ceil(Math.max(0, hp[i])));
      paintMeter(hud.meters[i].current, st.fighters[i]);
    }
    const b = bannerFor(st, true);
    const nm = session.start?.names ?? ["P1", "P2"];
    const you = session.seat;
    const who = (i: number | null) => (i === you ? "You win" : i === null ? "Double K.O." : `${nm[i]} wins`);
    let text = b.text;
    let sub = b.sub;
    if (st.over) {
      text = st.matchWinner !== null ? (st.matchWinner === you ? "You win the match!" : `${nm[st.matchWinner]} wins the match`) : `K.O.! ${who(st.winner)} round ${st.round}`;
      sub = `${st.wins[0]}–${st.wins[1]} · ${st.matchWinner !== null ? "new match in 5 s" : `round ${st.round + 1} in 3 s`}`;
    }
    const el = hud.banner.current;
    if (el && el.dataset.text !== text + sub) {
      el.dataset.text = text + sub;
      el.dataset.kind = st.over ? (st.matchWinner !== null ? "match" : "ko") : b.kind;
      (el.firstChild as HTMLElement).textContent = text;
      (el.lastChild as HTMLElement).textContent = sub;
    }
    const rr = hud.round.current;
    if (rr) {
      const r = `Round ${st.round} · ${st.wins[0]}–${st.wins[1]} · best of 3`;
      if (rr.textContent !== r) rr.textContent = r;
    }
    const checked = [...lock.sums.keys()].filter((f) => lock.remoteSums.has(f)).length;
    const sync = lock.desyncs.length || session.serverDesyncs.length ? `DESYNC at frame ${lock.desyncs[0] ?? session.serverDesyncs[0]?.f}` : `in sync ✓ ${checked} checks`;
    const t = `ping ${session.rtt} ms · input delay ${lock.delay}f (${Math.round((lock.delay * 1000) / 60)} ms) · frame ${lock.frame}${lock.stalledNow ? " · waiting" : ""} · ${sync}${lag || jitter ? ` · sim lag ${lag}±${jitter}` : ""}`;
    const ne = hud.net.current;
    if (ne && ne.textContent !== t) {
      ne.textContent = t;
      ne.dataset.sync = lock.desyncs.length ? "bad" : "ok";
    }
  };

  const ensureView = async (session: OnlineSession) => {
    if (view || mounting || !hud.host.current) return;
    mounting = true;
    const { mountView } = await import("@nf/render");
    if (stop || !hud.host.current) return;
    view = await mountView(hud.host.current, pickRenderer(params), { allowSoftware: chosePixi(params) });
    unfit = fitArena(view);
    viewFor = session;
    const names = session.start?.names;
    view.labels = session.seat === 0 ? ["YOU", names?.[1] || "P2"] : [names?.[0] || "P1", "YOU"];
    onFight(session.seat === 0 ? ["You", names?.[1] || "Friend"] : [names?.[0] || "Friend", "You"]);
    mounting = false;
  };

  let acc = 0;
  let last = performance.now();
  let fpsT = last;
  let fpsN = 0;
  const loop = (now: number) => {
    if (stop) return;
    raf = requestAnimationFrame(loop);
    const real = Math.min(0.25, (now - last) / 1000);
    last = now;
    const session = getSession();
    if (!session?.lock) return;
    if (!view) {
      void ensureView(session);
      return;
    }
    if (viewFor !== session) {
      // a new fight on the same page (play nearby's Rematch): fresh labels, back to the fight screen
      viewFor = session;
      const names = session.start?.names;
      view.labels = session.seat === 0 ? ["YOU", names?.[1] || "P2"] : [names?.[0] || "P1", "YOU"];
      onFight(session.seat === 0 ? ["You", names?.[1] || "Friend"] : [names?.[0] || "Friend", "You"]);
    }
    acc += real;
    pads.poll(keys, taps, [KEYS_1P]);
    const events: FxEvent[] = [];
    let impact = 0;
    let n = 0;
    while (acc >= SIM_DT && n < 5) {
      acc -= SIM_DT;
      n++;
      const input = brain ? brain(session) : reader.read(keys, taps);
      const r = session.tick(input);
      if (r.sampled) {
        reader.used();
        taps.clear();
      }
      events.push(...r.events);
      impact += r.impact;
    }
    if (n >= 5) acc = 0;
    const sim = session.sim!;
    view.draw(sim.curr, sim.prev, session.lock.stalledNow ? 1 : Math.min(1, acc / SIM_DT), events, impact);
    sfx.play(events);
    paintHud(session);
    fpsN++;
    if (now - fpsT > 1000) {
      stats.viewFps = Math.round((fpsN * 1000) / (now - fpsT));
      fpsT = now;
      fpsN = 0;
    }
  };
  raf = requestAnimationFrame(loop);

  return {
    get view() {
      return view;
    },
    sfx,
    stats,
    stop() {
      stop = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("pointerdown", unlock);
      unwatchInput();
      window.removeEventListener("keydown", unlock);
      view?.destroy();
      view = null;
      unfit();
      void sfx.ctx?.close().catch(() => {});
    },
  };
}

/** the banner, and the top bar (health, meters, round) and bottom bar (net line, legend, pads) of a fight */
export function DuelOverlay({ hud, names, hidden, tag, backHref = "/" }: { hud: DuelHud; names: [string, string]; hidden: boolean; tag: string; backHref?: string }) {
  return (
    <>
      <div className="banner" ref={hud.banner} data-testid="banner" data-kind="">
        <p className="banner-text" />
        <p className="banner-sub" />
      </div>
      <div className="overlay" hidden={hidden}>
        <div className="topbar">
          <Link className="back" href={backHref}>
            ← notebook
          </Link>
          <div className="bars" aria-label="Health">
            {[0, 1].map((i) => (
              <div key={i}>
                <div className="bar-label">
                  <span>{names[i]}</span>
                  <span ref={hud.nums[i]}>100</span>
                </div>
                <div className="track">
                  <div className={i ? "fill bag" : "fill"} ref={hud.fills[i]} />
                </div>
                <div className="meter" ref={hud.meters[i]} data-testid={`meter-${i}`} data-state="none">
                  <span className="meter-fill" />
                  <span className="meter-label" />
                </div>
              </div>
            ))}
            <div className="round-row">
              <span ref={hud.round} data-testid="round">
                Round 1 · 0–0 · best of 3
              </span>
              <span className="levels">{tag}</span>
            </div>
          </div>
        </div>
        <div />
        <div className="bottombar">
          <p className="hint">
            <span className="net-hud" ref={hud.net} data-testid="net-hud" data-sync="ok" />
            <span className="keys-legend" data-testid="keys-legend">
              <br />
              <kbd>A</kbd> <kbd>D</kbd> walk · <kbd>F</kbd> punch · <kbd>G</kbd> kick · <kbd>Space</kbd> jump · <kbd>H</kbd> block · <kbd>S</kbd> crouch · <kbd>E</kbd> special
            </span>
          </p>
          <TouchPad map={KEYS_1P} keys={hud.keys} taps={hud.taps} punch="Punch" kick="Kick" />
        </div>
      </div>
    </>
  );
}

/**
 * Copies text: the async Clipboard API first, then the old execCommand("copy") on a hidden
 * textarea (http pages, older browsers, embedded webviews). If both fail, the text in the page
 * (element `selectId`) is selected so the player can copy it by hand; returns false then.
 */
export async function copyText(text: string, selectId: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // denied or unavailable: try the fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) return true;
  } catch {
    // fall through
  }
  const el = document.getElementById(selectId);
  if (el) {
    const range = document.createRange();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.select();
    else {
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }
  return false;
}
