"use client";
/**
 * "How to play": a paged guide with real screenshots of the game (public/guide/*.webp, precached by the
 * service worker so it works offline). Two versions: touch (phones and tablets: the joystick and the
 * on-screen buttons) and keyboard (desktop, with gamepad notes), picked by the same input-mode
 * detection as the fight's controls, and switchable at the top. Next / Back, swipe on touch, ← → keys,
 * Esc closes. Opens from the "?" button on the notebook and in fights, and by itself once on the
 * first visit to the notebook (localStorage).
 */
import { useEffect, useRef, useState } from "react";
import { POWER_INFO, ROSTER, type PowerKind } from "@nf/sim";
import { Dialog } from "./dialog";
import { MAX_FIGHTERS } from "./fighters";
import { initialInputMode, type InputMode } from "./play/input-mode";

export { GuideButton } from "./guide-button";
export const GUIDE_SEEN_KEY = "nf:guide-seen";

type Page = { id: string; title: string; img: string; alt: string; body: React.ReactNode };

const DRAWN: PowerKind[] = ["fire", "water", "lightning", "ice", "wings", "shield", "spikes"];
const DOODLE: Record<string, string> = { fire: "a flame", water: "water drops or a wave", lightning: "a zigzag bolt", ice: "an ice crystal", wings: "wings", shield: "a shield", spikes: "spikes" };
const K = ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>;

function pages(mode: InputMode): Page[] {
  const touch = mode === "touch";
  const tap = touch ? "Tap" : "Click";
  const signature = ROSTER.filter((r) => r.signature);
  return [
    {
      id: "draw",
      title: "1 · Draw your fighter",
      img: "draw",
      alt: "A drawing box on the notebook with its buttons labelled",
      body: (
        <ul>
          <li>{touch ? "Draw with your finger" : "Draw with the mouse (or a pen)"} in a box: a head, a body, two arms and two legs. Any shape works, even a dog or a car.</li>
          <li><b>Colours</b>: pick a pencil above the boxes. The colour stays on your fighter in the fight.</li>
          <li><b>⤢ expand</b> opens a big drawing pad with line weights, an eraser, undo and redo. <b>clear</b> wipes the box.</li>
          <li><b>+ new fighter</b> adds another page (up to {MAX_FIGHTERS}). <b>play this</b> picks the fighter you play, <b>P2</b> picks player 2&apos;s, <b>🗑</b> deletes (tap twice).</li>
        </ul>
      ),
    },
    {
      id: "ink",
      title: "2 · What your drawing does",
      img: "ink",
      alt: "Two fighters: a plain one and one with a dark, scribbled arm and a flame, with their stats",
      body: (
        <ul>
          <li><b>Darker = stronger.</b> Go over an arm or a leg again and its hits get harder; the numbers under the box change as you draw. A neat, closed, even drawing gets a small bonus.</li>
          <li><b>Long legs</b> walk faster, <b>long arms</b> reach further, a <b>big body</b> takes more hits.</li>
          <li>
            <b>Powers</b>: doodle one on your fighter for a special move:
            <span className="guide-powers" data-testid="guide-powers">
              {DRAWN.map((k) => (
                <span key={k}>
                  {DOODLE[k]} → <b>{POWER_INFO[k].special}</b> ({POWER_INFO[k].passive})
                </span>
              ))}
            </span>
          </li>
          <li>Some rivals bring their own: {signature.map((r) => `${r.name} (${POWER_INFO[r.signature!].special})`).join(", ")}.</li>
        </ul>
      ),
    },
    {
      id: "cpu",
      title: "3 · Play with the computer",
      img: "cpu",
      alt: "The rival picker with the rivals, the difficulty and the Fight button labelled",
      body: (
        <ul>
          <li>{tap} <b>Play with computer</b>, then pick a rival (or let the computer pick one for your level).</li>
          <li><b>Easy / Normal / Hard</b>: how sharp the computer is, and which rivals it picks for you.</li>
          <li><b>ⓘ</b> opens a rival&apos;s card: its HP, moves, speed, reach and special. {tap} <b>Fight!</b> to start.</li>
        </ul>
      ),
    },
    {
      id: "duo",
      title: "4 · Two players, one device",
      img: "duo",
      alt: "A two-player fight with each player's controls labelled",
      body: touch ? (
        <ul>
          <li>Pick a fighter for each player (<b>play this</b> and <b>P2</b>), then {tap.toLowerCase()} <b>2 players</b>.</li>
          <li>Hold the phone or tablet sideways between you: P1 plays the left set of buttons, P2 the right one.</li>
        </ul>
      ) : (
        <ul>
          <li>Pick a fighter for each player (<b>play this</b> and <b>P2</b>), then click <b>2 players</b>.</li>
          <li><b>P1</b>: <K>A</K> <K>D</K> walk, <K>W</K> jump, <K>S</K> crouch, <K>F</K> punch, <K>G</K> kick, <K>H</K> block, <K>E</K> special.</li>
          <li><b>P2</b>: <K>←</K> <K>→</K> walk, <K>↑</K> jump, <K>↓</K> crouch, <K>J</K> punch, <K>K</K> kick, <K>L</K> block, <K>;</K> special.</li>
          <li>Two game controllers work too: pad 1 is P1, pad 2 is P2.</li>
        </ul>
      ),
    },
    {
      id: "room",
      title: "5 · Fight a friend online",
      img: "room",
      alt: "A room with its code, the Copy and Copy link buttons and the Accept / Decline prompt labelled",
      body: (
        <ul>
          <li>{tap} <b>Create a room</b>: you get a short <b>code</b>. <b>Copy</b> copies the code, <b>Copy link</b> a link your friend can open.</li>
          <li>Your friend opens the link, or taps <b>join a friend&apos;s room with a code</b> and types it in.</li>
          <li>You see their drawing first: <b>Accept</b> starts the fight, <b>Decline</b> sends them away.</li>
        </ul>
      ),
    },
    {
      id: "nearby",
      title: "6 · Play nearby, no internet",
      img: "nearby",
      alt: "The nearby page with the QR code labelled",
      body: (
        <ul>
          <li>Both phones join one <b>hotspot</b> (one phone can make it). No internet needed, just the game opened once before.</li>
          <li>One phone taps <b>Create nearby room</b> and shows a <b>QR code</b>; the other taps <b>Join</b> and scans it, then shows its own QR back.</li>
          <li>No camera? Copy and paste the codes instead.</li>
        </ul>
      ),
    },
    {
      id: "controls",
      title: "7 · Fight controls",
      img: "controls",
      alt: touch ? "The fight on a phone with the joystick and every button labelled" : "The fight on a computer with every key labelled",
      body: touch ? (
        <ul>
          <li><b>Joystick</b> (left thumb): drag left / right to walk, up to jump, down to crouch.</li>
          <li><b>Punch</b> (a dog bites, a car rams…), <b>Kick</b>, <b>Jump</b>, <b>Block</b> (takes most of a hit), <b>Crouch</b> (ducks under), <b>★</b> fires your special when its bar is full.</li>
          <li>Holding a phone upright? {tap} <b>⟳ Rotate</b> to play sideways.</li>
        </ul>
      ) : (
        <ul>
          <li><K>A</K> <K>D</K> walk · <K>Space</K> jump · <K>S</K> crouch</li>
          <li><K>F</K> punch · <K>G</K> kick · <K>H</K> block · <K>E</K> special (when its bar is full)</li>
          <li><K>R</K> restarts the round (or starts the next one) · the arrow keys and <K>J</K> <K>K</K> <K>L</K> work too · <b>?</b> (top left) opens this guide and pauses.</li>
          <li><b>Gamepad</b>: stick or d-pad to move (up jumps, down crouches) · A jump · X punch · Y kick · B or LB block · RB or RT special.</li>
        </ul>
      ),
    },
    {
      id: "hud",
      title: "8 · Reading the fight",
      img: "hud",
      alt: "The fight's health bars, special meter and round counter labelled",
      body: (
        <ul>
          <li><b>HP bars</b>: yours on top, the rival&apos;s below. At zero it&apos;s a K.O.</li>
          <li><b>Special bar</b> under each: it fills up, then says <i>ready</i>.</li>
          <li><b>Rounds</b>: best of three. The <b>K.O.</b> replays in slow motion; {tap.toLowerCase()} the banner (or {touch ? "wait" : <K>R</K>}) for the next round.</li>
          <li><b>Fighter card</b> shows why your drawing has its numbers. <b>?</b> brings this guide back (it pauses the fight).</li>
        </ul>
      ),
    },
  ];
}

export function HowToPlay({ onClose, start = 0 }: { onClose: () => void; start?: number }) {
  const [mode, setMode] = useState<InputMode>(() => (typeof document !== "undefined" && (document.documentElement.dataset.input as InputMode)) || initialInputMode());
  const [i, setI] = useState(start);
  const list = pages(mode);
  const n = list.length;
  const page = list[Math.min(i, n - 1)];
  const go = (d: number) => setI((x) => Math.max(0, Math.min(n - 1, x + d)));
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  });

  return (
    <Dialog label="How to play" onClose={onClose} className="guide" testid="guide">
      <div className="guide-head">
        <h2 className="dlg-title">How to play</h2>
        <div className="guide-mode" role="group" aria-label="Controls shown">
          <button type="button" aria-pressed={mode === "touch"} data-testid="guide-mode-touch" onClick={() => setMode("touch")}>
            📱 Touch
          </button>
          <button type="button" aria-pressed={mode === "keys"} data-testid="guide-mode-keys" onClick={() => setMode("keys")}>
            ⌨️ Keyboard
          </button>
        </div>
      </div>
      <section
        className="guide-page"
        data-testid="guide-page"
        data-mode={mode}
        data-page={page.id}
        aria-live="polite"
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) go(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => (swipe.current = null)}
      >
        <h3 data-testid="guide-title">{page.title}</h3>
        <figure className="guide-shot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/guide/${mode}-${page.img}.webp`} alt={page.alt} data-testid="guide-img" draggable={false} />
        </figure>
        <div className="guide-text">{page.body}</div>
      </section>
      <nav className="guide-nav">
        <button type="button" className="text-btn" data-testid="guide-back" onClick={() => go(-1)} disabled={i === 0}>
          ← Back
        </button>
        <span className="guide-dots" aria-label={`Page ${i + 1} of ${n}`} data-testid="guide-count">
          {list.map((p, k) => (
            <button key={p.id} type="button" aria-label={`Page ${k + 1}: ${p.title}`} aria-current={k === i ? "step" : undefined} onClick={() => setI(k)} />
          ))}
        </span>
        {i < n - 1 ? (
          <button type="button" className="play-link" data-testid="guide-next" data-autofocus onClick={() => go(1)}>
            Next →
          </button>
        ) : (
          <button type="button" className="play-link" data-testid="guide-done" onClick={onClose}>
            Let&apos;s draw!
          </button>
        )}
      </nav>
    </Dialog>
  );
}

/**
 * Open the guide by itself on the first visit (once per browser). Automated browsers skip it so tests
 * and tools see the plain page, unless they set localStorage "nf:guide-auto" to test exactly this.
 */
export function useFirstVisitGuide(open: () => void) {
  useEffect(() => {
    try {
      if (localStorage.getItem(GUIDE_SEEN_KEY)) return;
      if (navigator.webdriver && localStorage.getItem("nf:guide-auto") !== "1") return;
      localStorage.setItem(GUIDE_SEEN_KEY, "1");
      open();
    } catch {
      // no storage: never auto-open
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
