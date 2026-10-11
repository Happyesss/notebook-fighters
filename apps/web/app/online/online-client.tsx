"use client";

/**
 * Online 1v1 (plan §10): "Create room" gives a code / link, a friend joins, the host sees the friend's
 * drawing and accepts (or declines: the seat frees up for someone else), then 3-2-1 and a best of 3 — deterministic lockstep with input delay over one WebSocket to
 * the room's Durable Object on the Notebook Fighters Worker.
 * ?server=https://host picks the game server (default: this site; NEXT_PUBLIC_NF_SERVER for `next dev`)
 * ?lag=100&jitter=30 simulates a slow link (extra round trip in ms, ± per message)
 * ?autoplay=SEED lets a scripted fighter play for you (tests, demos)
 */
import { BUSY_MESSAGE as BUSY_TEXT, SIM_DT, isRoomCode, type AskMsg, type InkStroke, type LobbyMsg, type PlayerInput } from "@nf/shared";
import type { NotebookView } from "@nf/render";
import type { FxEvent, NetRoom, OnlineSession } from "@nf/sim";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { KEYS_1P, bannerFor, makeReader, paintMeter } from "../play/controls";
import { makePads } from "../play/gamepad";
import { TouchPad } from "../play/touchpad";
import { watchInputMode } from "../play/input-mode";
import { fitArena } from "../play/arena";
import { Sfx } from "../play/sfx";
import { chosePixi, pickPhysics, pickRenderer } from "../play/renderer-pref";
import { RotateButton } from "../play/rotate";
import { adoptFighter, myFighter } from "../fighters";
import { PENCILS, hasInk, type Stroke } from "../ink";
import { RivalThumb } from "../rivals";
import { SketchModal } from "../sketch-modal";

type Phase = "menu" | "connecting" | "lobby" | "fight" | "error";

const tokenKey = (code: string) => `nf:online:${code}`;

/** the Worker serving this page is also the game server; `next dev` points at `wrangler dev` instead */
function serverUrl(params: URLSearchParams) {
  const fromParam = params.get("server");
  if (fromParam) return fromParam;
  const env = process.env.NEXT_PUBLIC_NF_SERVER;
  if (env) return env;
  return window.location.origin;
}

/** the same scripted fighter the headless test uses (seeded, so a run can be repeated) */
function scriptedFighter(seed: number) {
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

export default function OnlineClient() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("menu");
  const [error, setError] = useState<string | null>(null);
  /** the free-plan server is over its limits (or unreachable): what to retry */
  const [busy, setBusy] = useState<{ mode: "create" | "join"; code?: string } | null>(null);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [lobby, setLobby] = useState<LobbyMsg | null>(null);
  const [mine, setMine] = useState<string>("");
  const [mineStrokes, setMineStrokes] = useState<Stroke[] | null>(null);
  /** the host's question: a friend sat down (with their drawing) */
  const [ask, setAsk] = useState<AskMsg | null>(null);
  /** no drawing yet: what to do once there is one (create a room, or join `code`) */
  const [needDraw, setNeedDraw] = useState<{ mode: "create" | "join"; code?: string } | null>(null);
  const [pad, setPad] = useState(false);
  const [pen, setPen] = useState(PENCILS[0].color);
  const [peerNote, setPeerNote] = useState<string | null>(null);
  /** which thing was just copied ("code" or "link"), for the "Copied!" feedback */
  const [copied, setCopied] = useState<"" | "code" | "link" | "manual-code" | "manual-link">("");
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), copied.startsWith("manual") ? 5000 : 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const actions = useRef<{ create: () => void; join: (c: string) => void; retry: () => void; accept: () => void; decline: () => void; drawn: (s: Stroke[]) => void }>({
    create: () => {},
    join: () => {},
    retry: () => {},
    accept: () => {},
    decline: () => {},
    drawn: () => {},
  });
  const netRef = useRef<HTMLSpanElement>(null);
  const fills = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const nums = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const meters = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const bannerRef = useRef<HTMLDivElement>(null);
  const roundRef = useRef<HTMLSpanElement>(null);
  const keysRef = useRef(new Set<string>());
  const tapsRef = useRef(new Set<string>());
  const [names, setNames] = useState<[string, string]>(["P1", "P2"]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const keys = keysRef.current;
    const taps = tapsRef.current;
    let stop = false;
    let raf = 0;
    let session: OnlineSession | null = null;
    let room: NetRoom | null = null;
    const base = serverUrl(params);
    let view: NotebookView | null = null;
    let unfit = () => {};
    let mounting = false;
    let leaving = false;
    let reconnecting = false;
    let NetRoomCls: typeof NetRoom | null = null;
    let FINAL: Set<number> = new Set([4000]);
    const lag = Number(params.get("lag") ?? 0);
    const jitter = Number(params.get("jitter") ?? 0);
    const auto = params.get("autoplay");
    const brain = auto ? scriptedFighter(Number(auto) || 1) : null;
    const reader = makeReader(KEYS_1P);
    // a game controller (Gamepad API) plays like the keyboard
    const pads = makePads();
    const sfx = new Sfx();
    const unlock = () => sfx.unlock();
    const net = { reconnects: 0, rebuilt: false, viewFps: 0, frames: 0 };

    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (e.target instanceof HTMLInputElement) return;
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

    // your fighter: the one selected on the notebook page (a room needs a drawing: see needDraw)
    let drawing: InkStroke[] | null = myFighter();

    const hud = () => {
      const sim = session?.sim;
      const lock = session?.lock;
      if (!sim || !lock || !session) return;
      const st = sim.curr;
      const hp = [st.playerHp, st.bagHp];
      const max = [st.playerMax, st.bagMax];
      for (let i = 0; i < 2; i++) {
        const el = fills[i].current;
        if (el) el.style.transform = `scaleX(${Math.max(0, hp[i]) / max[i]})`;
        const n = nums[i].current;
        if (n) n.textContent = String(Math.ceil(Math.max(0, hp[i])));
        paintMeter(meters[i].current, st.fighters[i]);
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
      const el = bannerRef.current;
      if (el && el.dataset.text !== text + sub) {
        el.dataset.text = text + sub;
        el.dataset.kind = st.over ? (st.matchWinner !== null ? "match" : "ko") : b.kind;
        (el.firstChild as HTMLElement).textContent = text;
        (el.lastChild as HTMLElement).textContent = sub;
      }
      if (roundRef.current) {
        const r = `Round ${st.round} · ${st.wins[0]}–${st.wins[1]} · best of 3`;
        if (roundRef.current.textContent !== r) roundRef.current.textContent = r;
      }
      const checked = [...lock.sums.keys()].filter((f) => lock.remoteSums.has(f)).length;
      const sync = lock.desyncs.length || session.serverDesyncs.length ? `DESYNC at frame ${lock.desyncs[0] ?? session.serverDesyncs[0]?.f}` : `in sync ✓ ${checked} checks`;
      const t = `ping ${session.rtt} ms · input delay ${lock.delay}f (${Math.round((lock.delay * 1000) / 60)} ms) · frame ${lock.frame}${lock.stalledNow ? " · waiting" : ""} · ${sync}${lag || jitter ? ` · sim lag ${lag}±${jitter}` : ""}`;
      const ne = netRef.current;
      if (ne && ne.textContent !== t) {
        ne.textContent = t;
        ne.dataset.sync = lock.desyncs.length ? "bad" : "ok";
      }
    };

    const ensureView = async () => {
      if (view || mounting || !session?.lock || !hostRef.current) return;
      mounting = true;
      const { mountView } = await import("@nf/render");
      if (stop || !hostRef.current) return;
      view = await mountView(hostRef.current, pickRenderer(params), { allowSoftware: chosePixi(params) });
      unfit = fitArena(view);
      view.labels = session.seat === 0 ? ["YOU", session.start?.names[1] || "P2"] : [session.start?.names[0] || "P1", "YOU"];
      setNames(session.seat === 0 ? ["You", session.start?.names[1] || "Friend"] : [session.start?.names[0] || "Friend", "You"]);
      setPhase("fight");
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
      if (!session?.lock) return;
      if (!view) {
        void ensureView();
        return;
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
      hud();
      fpsN++;
      if (now - fpsT > 1000) {
        net.viewFps = Math.round((fpsN * 1000) / (now - fpsT));
        fpsT = now;
        fpsN = 0;
      }
    };
    raf = requestAnimationFrame(loop);

    const saveToken = () => {
      if (!room) return;
      try {
        window.sessionStorage.setItem(tokenKey(room.roomId), room.reconnectionToken);
      } catch {
        // private mode: no reload-reconnect
      }
    };

    const bind = (r: NetRoom) => {
      room = r;
      session!.attach(r);
      setCode(r.roomId);
      saveToken();
      r.onLeave((code) => {
        session?.detach();
        if (leaving || stop || room !== r) return;
        // the host said no: back to the menu with a note (the seat is free for someone else)
        if (code === 4403) {
          setError("The host declined. Ask them for a new invite.");
          setCode("");
          setPhase("error");
          return;
        }
        // left on purpose / seat taken by another tab / seat expired: nothing to reconnect to
        if (FINAL.has(code)) {
          if (code !== 4000) setPeerNote(code === 4001 ? "This match continued in another tab." : "The match is over — start a new room.");
          return;
        }
        // anything else is a dropped connection: take the seat back with the token
        void reconnectLoop();
      });
    };

    const reconnectLoop = async () => {
      if (reconnecting || !room) return;
      reconnecting = true;
      const token = room.reconnectionToken;
      const code = room.roomId;
      setPeerNote("Connection lost — reconnecting…");
      for (let i = 0; i < 30 && !stop; i++) {
        await new Promise((r) => setTimeout(r, 800));
        try {
          const r = await NetRoomCls!.join(base, code, { token });
          net.reconnects++;
          bind(r);
          setPeerNote(null);
          reconnecting = false;
          return;
        } catch (err) {
          // server still away: try again (unless the seat is gone for good)
          if (FINAL.has((err as { code?: number }).code ?? 0)) break;
        }
      }
      reconnecting = false;
      setPeerNote("Couldn't reconnect. The match is lost — start a new room.");
    };

    const newSession = async () => {
      const { OnlineSession } = await import("@nf/sim");
      const s = new OnlineSession({ lag, jitter });
      s.onChange = () => {
        if (s.lobby) setLobby({ ...s.lobby });
        setAsk(s.ask ? { ...s.ask } : null);
        if (!s.peer.connected) setPeerNote(s.peer.gone ? "Your friend left the match." : "Friend's connection dropped — waiting for them (seat held 60 s)…");
        else if (s.connected) setPeerNote(null);
      };
      return s;
    };

    const connect = async (mode: "create" | "join", joinCode?: string) => {
      const sim = await import("@nf/sim");
      try {
        setPhase("connecting");
        setError(null);
        setBusy(null);
        NetRoomCls = sim.NetRoom;
        FINAL = sim.FINAL_CLOSE;
        session = await newSession();
        const opts = { name: params.get("name") ?? (mode === "create" ? "Host" : "Guest"), strokes: drawing, physics: pickPhysics(params) };
        let r: NetRoom | null = null;
        if (mode === "join" && joinCode) {
          // a reload mid-match: the token from this tab gets our seat back, and we rebuild from the log
          let token: string | null = null;
          try {
            token = window.sessionStorage.getItem(tokenKey(joinCode));
          } catch {
            token = null;
          }
          if (token) {
            try {
              r = await sim.NetRoom.join(base, joinCode, { token });
              net.rebuilt = true;
              session.expectRebuild(r.seat);
            } catch {
              r = null;
            }
          }
          r ??= await sim.NetRoom.join(base, joinCode, opts);
        } else r = await sim.NetRoom.create(base, opts);
        if (stop) {
          r.leave();
          return;
        }
        bind(r);
        setPhase("lobby");
      } catch (err) {
        if (sim.isBusyError(err)) {
          // Cloudflare limits (429/503/1027), an overloaded room or no network: offer offline play
          console.warn("online busy:", (err as { detail?: string }).detail ?? err);
          setBusy({ mode, code: joinCode });
          setError(null);
        } else setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    };
    const hasToken = (c: string) => {
      try {
        return !!window.sessionStorage.getItem(tokenKey(c));
      } catch {
        return false;
      }
    };
    const showMine = () => {
      setMine(drawing ? "your fighter from the notebook" : "no fighter yet: draw one first");
      setMineStrokes(drawing as Stroke[] | null);
    };
    actions.current = {
      create: () => {
        if (!drawing || !hasInk(drawing as Stroke[])) {
          setNeedDraw({ mode: "create" });
          return;
        }
        setNeedDraw(null);
        void connect("create");
      },
      join: (c: string) => {
        const up = c.trim().toUpperCase();
        if (!isRoomCode(up)) {
          setError("Room codes are 6 letters/digits.");
          return;
        }
        window.history.replaceState(null, "", `/online?${new URLSearchParams({ ...Object.fromEntries(params), join: up })}`);
        // a friend's link needs your drawing first (a reload mid-match takes the seat back without one)
        if ((!drawing || !hasInk(drawing as Stroke[])) && !hasToken(up)) {
          setNeedDraw({ mode: "join", code: up });
          return;
        }
        setNeedDraw(null);
        void connect("join", up);
      },
      retry: () => {
        const b = busyRef.current;
        if (b?.mode === "join" && b.code) actions.current.join(b.code);
        else actions.current.create();
      },
      accept: () => session?.accept(),
      decline: () => session?.decline(),
      /** drawn on the big pad here: saved to the notebook (selected), then on with the room */
      drawn: (strokes: Stroke[]) => {
        drawing = strokes as InkStroke[];
        adoptFighter(strokes);
        showMine();
      },
    };
    showMine();
    // connect on the next tick: React's dev double-mount runs the cleanup first, so only one socket opens
    const j = params.get("join");
    const autoConnect = setTimeout(() => {
      if (j) actions.current.join(j);
      else if (params.get("create") !== null) actions.current.create();
    }, 0);

    const hook = {
      get session() {
        return session;
      },
      get sim() {
        return session?.sim ?? null;
      },
      get view() {
        return view;
      },
      get room() {
        return room;
      },
      net,
      sfx,
      keys,
      /** pull the cable: close the socket without leaving (the server holds the seat) */
      drop() {
        room?.drop();
      },
    };
    (window as unknown as { __nf?: typeof hook }).__nf = hook;

    return () => {
      clearTimeout(autoConnect);
      stop = true;
      leaving = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("pointerdown", unlock);
      unwatchInput();
      window.removeEventListener("keydown", unlock);
      room?.leave();
      session?.dispose();
      view?.destroy();
      unfit();
      void sfx.ctx?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = typeof window !== "undefined" && code ? `${window.location.origin}/r/${code}` : "";

  return (
    <main className="stage online" data-phase={phase} data-testid="online">
      <div className="canvas-host" ref={hostRef} />
      {phase !== "fight" && (
        <section className="lobby" data-testid="lobby">
          <h1>Online duel</h1>
          <p className="lobby-mine">
            {mineStrokes && <RivalThumb strokes={mineStrokes} className="mine-thumb" />}
            <span>You fight with {mine}.</span>
          </p>
          {needDraw && (
            <div className="draw-first-online" role="alert" data-testid="draw-first">
              <p>
                <b>Draw your fighter first.</b> {needDraw.mode === "join" ? `Your friend's room ${needDraw.code} is waiting: they'll see your drawing before the fight.` : "Your friend will see it when they join."}
              </p>
              <button type="button" data-testid="online-draw" onClick={() => setPad(true)}>
                ✎ Draw my fighter
              </button>
            </div>
          )}
          {busy && phase === "error" && (
            <div className="online-busy" role="alert" data-testid="online-busy">
              <p>
                <b>{BUSY_TEXT}</b>
              </p>
              <div className="online-busy-actions">
                <a className="big-btn" href="/?play=cpu" data-testid="busy-cpu">
                  Play with computer
                </a>
                <a className="big-btn" href="/?play=2p" data-testid="busy-2p">
                  Local 2-player
                </a>
                <button type="button" data-testid="busy-retry" onClick={() => actions.current.retry()}>
                  Try again
                </button>
              </div>
            </div>
          )}
          {(phase === "menu" || (phase === "error" && !busy)) && !needDraw && (
            <div className="lobby-actions">
              <button type="button" className="big-btn" data-testid="create-room" onClick={() => actions.current.create()}>
                Create room
              </button>
              <span className="or">or</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} placeholder="CODE" maxLength={6} aria-label="Room code" data-testid="join-code" />
              <button type="button" data-testid="join-room" onClick={() => actions.current.join(typed)}>
                Join
              </button>
            </div>
          )}
          {phase === "connecting" && <p>Connecting to the game server…</p>}
          {error && <p className="lobby-error" data-testid="lobby-error">{error}</p>}
          {code && phase === "lobby" && (
            <div className="lobby-room">
              <p className="room-line">
                Room <b data-testid="room-code" id="room-code">{code}</b>
                <button
                  type="button"
                  className="copy-btn"
                  data-testid="copy-code"
                  aria-label={`Copy room code ${code}`}
                  onClick={async () => setCopied((await copyText(code, "room-code")) ? "code" : "manual-code")}
                >
                  {copied === "code" ? "Copied!" : "Copy"}
                </button>
                <span className="copy-note" role="status" aria-live="polite" data-testid="copy-status">
                  {copied === "code" ? "Room code copied" : copied === "manual-code" ? "Press Ctrl/⌘+C to copy" : ""}
                </span>
              </p>
              <p className="share">
                Send your friend this link: <code data-testid="share-url" id="share-url">{share}</code>{" "}
                <button
                  type="button"
                  className="copy-btn"
                  data-testid="copy-link"
                  aria-label="Copy the invite link"
                  onClick={async () => setCopied((await copyText(share, "share-url")) ? "link" : "manual-link")}
                >
                  {copied === "link" ? "Copied!" : "Copy link"}
                </button>
                {copied === "manual-link" && <span className="copy-note"> Press Ctrl/⌘+C to copy</span>}
              </p>
              <ul className="seats" data-testid="seats">
                {(lobby?.seats ?? [null, null]).map((s, i) => (
                  <li key={i} data-filled={s ? "true" : "false"}>
                    P{i + 1}: {s ? `${s.name}${lobby?.you === i ? " (you)" : ""} — ${s.kind}` : "waiting for a friend…"}
                  </li>
                ))}
              </ul>
              {lobby?.you === 0 && ask && lobby.seats[1] && !lobby.accepted && (
                <div className="ask-box" role="alertdialog" aria-label="A friend wants to fight" data-testid="accept-prompt">
                  {ask.strokes && <RivalThumb strokes={ask.strokes as Stroke[]} className="ask-thumb" />}
                  <p className="ask-text">
                    <b data-testid="ask-name">{ask.name}</b> joined with a {ask.kind}. Fight them?
                  </p>
                  <div className="ask-buttons">
                    <button type="button" className="accept-btn" data-testid="accept-join" onClick={() => actions.current.accept()}>
                      Accept ✓
                    </button>
                    <button type="button" className="decline-btn" data-testid="decline-join" onClick={() => actions.current.decline()}>
                      Decline
                    </button>
                  </div>
                </div>
              )}
              {lobby?.you === 1 && lobby.seats[0] && !lobby.accepted && (
                <p className="waiting-accept" data-testid="waiting-accept" role="status">
                  Waiting for host to accept…
                </p>
              )}
              {lobby?.seats[0] && lobby?.seats[1] && lobby.accepted && <p data-testid="accepted">Accepted! Both drawings are in — measuring the connection, then FIGHT!</p>}
            </div>
          )}
          <p className="lobby-foot">
            <Link href="/">← notebook</Link> · <Link href="/play">practice vs CPU</Link>
          </p>
        </section>
      )}
      {pad && (
        <SketchModal
          title="Your fighter"
          strokes={[]}
          pen={pen}
          onPen={setPen}
          onCancel={() => setPad(false)}
          onDone={(next) => {
            setPad(false);
            if (!hasInk(next)) return;
            actions.current.drawn(next);
            const want = needDraw;
            setNeedDraw(null);
            if (want?.mode === "join" && want.code) actions.current.join(want.code);
            else if (want) actions.current.create();
          }}
        />
      )}
      <RotateButton />
      <div className="banner" ref={bannerRef} data-testid="banner" data-kind="">
        <p className="banner-text" />
        <p className="banner-sub" />
      </div>
      {peerNote && <p className="peer-note" data-testid="peer-note">{peerNote}</p>}
      <div className="overlay" hidden={phase !== "fight"}>
        <div className="topbar">
          <Link className="back" href="/">
            ← notebook
          </Link>
          <div className="bars" aria-label="Health">
            {[0, 1].map((i) => (
              <div key={i}>
                <div className="bar-label">
                  <span>{names[i]}</span>
                  <span ref={nums[i]}>100</span>
                </div>
                <div className="track">
                  <div className={i ? "fill bag" : "fill"} ref={fills[i]} />
                </div>
                <div className="meter" ref={meters[i]} data-testid={`meter-${i}`} data-state="none">
                  <span className="meter-fill" />
                  <span className="meter-label" />
                </div>
              </div>
            ))}
            <div className="round-row">
              <span ref={roundRef} data-testid="round">Round 1 · 0–0 · best of 3</span>
              <span className="levels">online · room {code}</span>
            </div>
          </div>
        </div>
        <div />
        <div className="bottombar">
          <p className="hint">
            <span className="net-hud" ref={netRef} data-testid="net-hud" data-sync="ok" />
            <span className="keys-legend" data-testid="keys-legend">
              <br />
              <kbd>A</kbd> <kbd>D</kbd> walk · <kbd>F</kbd> punch · <kbd>G</kbd> kick · <kbd>Space</kbd> jump · <kbd>H</kbd> block · <kbd>S</kbd> crouch · <kbd>E</kbd> special
            </span>
          </p>
          <TouchPad map={KEYS_1P} keys={keysRef} taps={tapsRef} punch="Punch" kick="Kick" />
        </div>
      </div>
    </main>
  );
}

/**
 * Copies text: the async Clipboard API first, then the old execCommand("copy") on a hidden
 * textarea (http pages, older browsers, embedded webviews). If both fail, the text in the page
 * (element `selectId`) is selected so the player can copy it by hand; returns false then.
 */
async function copyText(text: string, selectId: string): Promise<boolean> {
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
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  return false;
}
