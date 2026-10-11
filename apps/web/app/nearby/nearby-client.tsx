"use client";

/**
 * Play nearby, no internet: two phones on one hotspot (or one Wi-Fi with no internet) fight over a
 * direct WebRTC data channel. No server at all: the host's phone runs the room (HostRoom) and the
 * friend joins it over the channel (PipeRoom); the fight is the same lockstep as online rooms.
 *
 *   host: Create nearby room → shows a QR (offer) ─┐
 *   friend: Join nearby → scans it → shows a QR (answer) ─┐
 *   host: scans the answer → channel opens → sees the friend's drawing → Accept → FIGHT
 *
 * Every QR also has a copy / paste fallback. ?lag=100&jitter=30 simulates a slow link,
 * ?autoplay=SEED lets a scripted fighter play (tests, demos), ?name= sets your name.
 */
import type { AskMsg, InkStroke, LobbyMsg } from "@nf/shared";
import type { HostRoom, OnlineSession, Pipe, PipeRoom } from "@nf/sim";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { pickPhysics } from "../play/renderer-pref";
import { RotateButton } from "../play/rotate";
import { adoptFighter, myFighter } from "../fighters";
import { PENCILS, hasInk, type Stroke } from "../ink";
import { RivalThumb } from "../rivals";
import { SketchModal } from "../sketch-modal";
import { OfflineHint } from "../offline";
import { DuelOverlay, copyText, startDuel, useDuelHud, type DuelRun } from "../online/duel";
import { QrCode, QrScanner } from "./qr";

export const HOTSPOT_HINT = "One phone: turn on Hotspot. Other phone: join it. Mobile data not needed.";

type Role = "host" | "guest";
type Step = "menu" | "making" | "host-offer" | "host-scan" | "guest-scan" | "guest-answer" | "connecting" | "lobby" | "fight" | "lost";

export default function NearbyClient() {
  const hud = useDuelHud();
  const [step, setStep] = useState<Step>("menu");
  const [role, setRole] = useState<Role | null>(null);
  const [code, setCode] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lostWhy, setLostWhy] = useState("");
  const [lobby, setLobby] = useState<LobbyMsg | null>(null);
  const [ask, setAsk] = useState<AskMsg | null>(null);
  const [needDraw, setNeedDraw] = useState<Role | null>(null);
  const [mineStrokes, setMineStrokes] = useState<Stroke[] | null>(null);
  const [pad, setPad] = useState(false);
  const [pen, setPen] = useState(PENCILS[0].color);
  const [copied, setCopied] = useState<"" | "ok" | "manual">("");
  const [names, setNames] = useState<[string, string]>(["P1", "P2"]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), copied === "manual" ? 5000 : 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const actions = useRef({
    create: () => {},
    join: () => {},
    gotCode: (_c: string) => {},
    scanAnswer: () => {},
    accept: () => {},
    decline: () => {},
    rematch: () => {},
    drawn: (_s: Stroke[]) => {},
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let stop = false;
    let session: OnlineSession | null = null;
    let hostRoom: HostRoom | null = null;
    let guestRoom: PipeRoom | null = null;
    let pipe: Pipe | null = null;
    let cancelLink: (() => void) | null = null;
    let finishHost: ((answer: string) => Promise<Pipe>) | null = null;
    let myRole: Role | null = null;
    let stepNow: Step = "menu";
    let busy = false;
    const lag = Number(params.get("lag") ?? 0);
    const jitter = Number(params.get("jitter") ?? 0);
    const codes = { offer: "", answer: "" };
    const go = (s: Step) => {
      stepNow = s;
      setStep(s);
    };
    const duel: DuelRun = startDuel({
      hud,
      params,
      lag,
      jitter,
      getSession: () => session,
      onFight: (n) => {
        setNames(n);
        go("fight");
      },
    });
    let drawing: InkStroke[] | null = myFighter();
    setMineStrokes(drawing as Stroke[] | null);
    const name = (r: Role) => (params.get("name") ?? (r === "host" ? "Host" : "Friend")).slice(0, 24);

    const teardown = () => {
      cancelLink?.();
      cancelLink = null;
      finishHost = null;
      hostRoom?.close();
      hostRoom = null;
      guestRoom?.leave();
      guestRoom = null;
      pipe?.close();
      pipe = null;
      session?.dispose();
      session = null;
      setLobby(null);
      setAsk(null);
    };

    const lost = (why: string) => {
      if (stop || stepNow === "lost") return;
      setLostWhy(why);
      go("lost");
    };

    const newSession = async () => {
      const { OnlineSession } = await import("@nf/sim");
      const s = new OnlineSession({ lag, jitter });
      s.onChange = () => {
        if (s !== session) return;
        if (s.lobby) setLobby({ ...s.lobby });
        setAsk(s.ask ? { ...s.ask } : null);
        if (s.peer.gone) lost("Your friend's phone left or lost the link.");
      };
      return s;
    };

    const failed = (e: unknown) => {
      if (stop) return;
      teardown();
      setError(e instanceof Error ? e.message : String(e));
      go("menu");
    };

    const needsDrawing = () => !drawing || !hasInk(drawing as Stroke[]);

    // ---- host -------------------------------------------------------------------------------
    const create = async () => {
      if (needsDrawing()) {
        setNeedDraw("host");
        return;
      }
      if (busy) return;
      busy = true;
      setNeedDraw(null);
      setError(null);
      teardown();
      myRole = "host";
      setRole("host");
      go("making");
      try {
        const { hostOffer } = await import("./signal");
        const offer = await hostOffer();
        if (stop) return offer.cancel();
        cancelLink = offer.cancel;
        finishHost = offer.finish;
        codes.offer = offer.code;
        setCode(offer.code);
        setTyped("");
        go("host-offer");
      } catch (e) {
        failed(e);
      } finally {
        busy = false;
      }
    };

    const hostConnect = async (answer: string) => {
      if (!finishHost) return;
      const finish = finishHost;
      go("connecting");
      try {
        codes.answer = answer;
        const link = await finish(answer);
        if (stop) return link.close();
        const sim = await import("@nf/sim");
        pipe = link;
        hostRoom = new sim.HostRoom({ name: name("host"), strokes: drawing, physics: pickPhysics(params) });
        session = await newSession();
        session.attach(hostRoom.host);
        hostRoom.attachGuest(link);
        hostRoom.onGuestGone = () => {
          if (stepNow === "lobby" || stepNow === "connecting") lost("Your friend's phone left before the fight.");
          else lost("Your friend's phone left or lost the link.");
        };
        go("lobby");
      } catch (e) {
        // a bad / wrong code: stay on the offer, say why
        if (finishHost === finish && /code|answer/i.test(e instanceof Error ? e.message : "")) {
          setError(e instanceof Error ? e.message : String(e));
          go("host-offer");
        } else failed(e);
      }
    };

    // ---- friend -----------------------------------------------------------------------------
    const join = () => {
      if (needsDrawing()) {
        setNeedDraw("guest");
        return;
      }
      setNeedDraw(null);
      setError(null);
      teardown();
      myRole = "guest";
      setRole("guest");
      setTyped("");
      go("guest-scan");
    };

    const guestGotOffer = async (offerCode: string) => {
      if (busy) return;
      busy = true;
      go("making");
      try {
        const { guestAnswer } = await import("./signal");
        const ans = await guestAnswer(offerCode);
        if (stop) return ans.cancel();
        codes.offer = offerCode;
        codes.answer = ans.code;
        cancelLink = ans.cancel;
        setCode(ans.code);
        go("guest-answer");
        busy = false;
        const link = await ans.link;
        if (stop) return link.close();
        go("connecting");
        pipe = link;
        const sim = await import("@nf/sim");
        session = await newSession();
        const room = await sim.PipeRoom.join(link, { name: name("guest"), strokes: drawing });
        guestRoom = room;
        session.attach(room);
        room.onLeave((closeCode) => {
          session?.detach();
          if (stop || guestRoom !== room) return;
          if (closeCode === 4403) {
            teardown();
            setError("The host declined. Ask them to make a new nearby room.");
            go("menu");
          } else lost(closeCode === 4000 ? "The host closed the room." : "The link to the host's phone was lost.");
        });
        go("lobby");
      } catch (e) {
        busy = false;
        const msg = e instanceof Error ? e.message : String(e);
        if (/code/i.test(msg) && stepNow === "making") {
          setError(msg);
          go("guest-scan");
        } else failed(e);
      }
    };

    actions.current = {
      create: () => void create(),
      join,
      gotCode: (c: string) => {
        setError(null);
        const t = c.trim();
        if (!t) return;
        if (myRole === "host") void hostConnect(t);
        else void guestGotOffer(t);
      },
      scanAnswer: () => {
        setError(null);
        setTyped("");
        go("host-scan");
      },
      accept: () => session?.accept(),
      decline: () => {
        session?.decline();
      },
      rematch: () => {
        teardown();
        if (myRole === "guest") join();
        else void create();
      },
      drawn: (strokes: Stroke[]) => {
        drawing = strokes as InkStroke[];
        adoptFighter(strokes);
        setMineStrokes(strokes);
      },
    };

    const auto = setTimeout(() => {
      if (params.get("host") !== null) void create();
      else if (params.get("join") !== null) join();
    }, 0);

    const hook = {
      get session() {
        return session;
      },
      get sim() {
        return session?.sim ?? null;
      },
      get view() {
        return duel.view;
      },
      get room() {
        return hostRoom ?? guestRoom;
      },
      codes,
      stats: duel.stats,
      sfx: duel.sfx,
      keys: hud.keys.current,
      /** pull the cable: close the data channel (the other phone sees "Connection lost") */
      drop() {
        pipe?.close();
      },
    };
    (window as unknown as { __nf?: typeof hook }).__nf = hook;

    return () => {
      stop = true;
      clearTimeout(auto);
      duel.stop();
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the host declined: the link is gone, so offer a fresh room
  const declined = role === "host" && step === "lobby" && lobby && !lobby.seats[1];

  const codeBox = (kind: "offer" | "answer") => (
    <div className="nearby-code">
      <label htmlFor={`${kind}-code`}>Or send this code another way (copy):</label>
      <textarea id={`${kind}-code`} readOnly value={code} rows={3} data-testid={`${kind}-code`} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="copy-btn" data-testid={`copy-${kind}`} onClick={async () => setCopied((await copyText(code, `${kind}-code`)) ? "ok" : "manual")}>
        {copied === "ok" ? "Copied!" : "Copy code"}
      </button>
      {copied === "manual" && <span className="copy-note"> Press Ctrl/⌘+C to copy</span>}
    </div>
  );
  const pasteBox = (what: string) => (
    <div className="nearby-paste">
      <label htmlFor="paste-code">Or paste {what}:</label>
      <textarea id="paste-code" value={typed} rows={2} placeholder="NO1… / NA1…" data-testid="paste-code" onChange={(e) => setTyped(e.target.value)} />
      <button type="button" data-testid="paste-go" disabled={!typed.trim()} onClick={() => actions.current.gotCode(typed)}>
        Connect
      </button>
    </div>
  );

  return (
    <main className="stage online nearby" data-phase={step === "fight" ? "fight" : "lobby"} data-step={step} data-role={role ?? ""} data-testid="nearby">
      <div className="canvas-host" ref={hud.host} />
      {step !== "fight" && (
        <section className="lobby" data-testid="lobby">
          <h1>Play nearby</h1>
          <p className="nearby-sub">No internet needed: two phones, one hotspot, two QR codes.</p>
          <p className="lobby-mine">
            {mineStrokes && hasInk(mineStrokes) && <RivalThumb strokes={mineStrokes} className="mine-thumb" />}
            <span>{mineStrokes && hasInk(mineStrokes) ? "You fight with your fighter from the notebook." : "No fighter yet: draw one first."}</span>
          </p>
          <p className="hotspot-hint" data-testid="hotspot-hint">
            <span aria-hidden="true">📶 </span>
            {HOTSPOT_HINT}
          </p>
          {needDraw && (
            <div className="draw-first-online" role="alert" data-testid="draw-first">
              <p>
                <b>Draw your fighter first.</b> {needDraw === "guest" ? "The host will see it before the fight." : "Your friend will see it when they join."}
              </p>
              <button type="button" data-testid="online-draw" onClick={() => setPad(true)}>
                ✎ Draw my fighter
              </button>
            </div>
          )}
          {step === "menu" && !needDraw && (
            <div className="lobby-actions nearby-actions">
              <button type="button" className="big-btn" data-testid="nearby-create" onClick={() => actions.current.create()}>
                Create nearby room
              </button>
              <span className="or">or</span>
              <button type="button" className="big-btn alt" data-testid="nearby-join" onClick={() => actions.current.join()}>
                Join nearby
              </button>
            </div>
          )}
          {error && (
            <p className="lobby-error" data-testid="lobby-error" role="alert">
              {error}
            </p>
          )}
          {step === "making" && <p data-testid="making">{role === "host" ? "Making the room code…" : "Making your answer code…"}</p>}
          {step === "host-offer" && (
            <div className="nearby-step" data-testid="host-offer">
              <p className="nearby-say">
                <b>1.</b> Your friend taps <b>Join nearby</b> and scans this code.
              </p>
              <QrCode text={code} label="Nearby room code (QR)" testId="offer-qr" />
              {codeBox("offer")}
              <p className="nearby-say">
                <b>2.</b> Then scan the answer code on your friend&apos;s phone.
              </p>
              <button type="button" className="big-btn" data-testid="scan-answer" onClick={() => actions.current.scanAnswer()}>
                Scan friend&apos;s answer
              </button>
              {pasteBox("your friend's answer code")}
            </div>
          )}
          {step === "host-scan" && (
            <div className="nearby-step" data-testid="host-scan">
              <p className="nearby-say">Scan the answer code on your friend&apos;s phone.</p>
              <QrScanner testId="scanner" accept={(t) => t.startsWith("NA1")} onCode={(t) => actions.current.gotCode(t)} />
              {pasteBox("your friend's answer code")}
            </div>
          )}
          {step === "guest-scan" && (
            <div className="nearby-step" data-testid="guest-scan">
              <p className="nearby-say">
                <b>1.</b> Scan the room code on the host&apos;s phone.
              </p>
              <QrScanner testId="scanner" accept={(t) => t.startsWith("NO1")} onCode={(t) => actions.current.gotCode(t)} />
              {pasteBox("the host's room code")}
            </div>
          )}
          {step === "guest-answer" && (
            <div className="nearby-step" data-testid="guest-answer">
              <p className="nearby-say">
                <b>2.</b> Show this answer to the host: they tap <b>Scan friend&apos;s answer</b>.
              </p>
              <QrCode text={code} label="Your answer code (QR)" testId="answer-qr" />
              {codeBox("answer")}
              <p className="waiting-accept" role="status">
                Waiting for the host to scan it…
              </p>
            </div>
          )}
          {step === "connecting" && <p data-testid="connecting">Connecting the phones…</p>}
          {step === "lobby" && (
            <div className="lobby-room">
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
              {declined && (
                <p data-testid="declined">
                  You declined. <button type="button" onClick={() => actions.current.rematch()}>Make a new nearby room</button>
                </p>
              )}
              {lobby?.you === 1 && lobby.seats[0] && !lobby.accepted && (
                <p className="waiting-accept" data-testid="waiting-accept" role="status">
                  Connected! Waiting for host to accept…
                </p>
              )}
              {lobby?.seats[0] && lobby?.seats[1] && lobby.accepted && <p data-testid="accepted">Accepted! Measuring the link, then FIGHT!</p>}
            </div>
          )}
          {step === "lost" && (
            <div className="lost-box" role="alert" data-testid="lost">
              <p>
                <b>Connection lost.</b> {lostWhy}
              </p>
              <div className="online-busy-actions">
                <button type="button" className="big-btn" data-testid="lost-rematch" onClick={() => actions.current.rematch()}>
                  Rematch
                </button>
                <Link className="big-btn alt" href="/" data-testid="lost-back">
                  Back
                </Link>
              </div>
            </div>
          )}
          <OfflineHint compact />
          <p className="lobby-foot">
            <Link href="/">← notebook</Link> · <Link href="/online">online room</Link>
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
            if (want === "guest") actions.current.join();
            else if (want === "host") actions.current.create();
          }}
        />
      )}
      <RotateButton />
      <DuelOverlay hud={hud} names={names} hidden={step !== "fight"} tag="nearby · no internet" />
    </main>
  );
}
