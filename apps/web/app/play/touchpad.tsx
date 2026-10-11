"use client";
/**
 * On-screen touch controls for every fight page: a virtual joystick (drag: left/right walk, up jump,
 * down crouch) and big attack buttons. Each control follows its own finger (pointer capture), so
 * walking and punching at the same time works (multi-touch). They press the same keys as the keyboard.
 */
import { useRef } from "react";
import type { KeyMap } from "./controls";
import { rotatedView } from "./rotate";

type Props = {
  map: KeyMap;
  keys: React.MutableRefObject<Set<string>>;
  taps: React.MutableRefObject<Set<string>>;
  punch?: string;
  kick?: string;
  /** "P1" / "P2" in a 2P duel (aria labels and colour); empty for one player */
  who?: string;
  /** hide the crouch button (the stick's down does it too) */
  compact?: boolean;
};

export function TouchPad({ map, keys, taps, punch = "Punch", kick = "Kick", who = "", compact = false }: Props) {
  const knob = useRef<HTMLSpanElement>(null);
  const held = useRef(new Set<string>());
  const centre = useRef<{ x: number; y: number; r: number } | null>(null);
  const k = (a: keyof KeyMap) => map[a][0];

  const set = (key: string, on: boolean) => {
    if (on && !held.current.has(key)) {
      held.current.add(key);
      keys.current.add(key);
      taps.current.add(key);
    } else if (!on && held.current.has(key)) {
      held.current.delete(key);
      keys.current.delete(key);
    }
  };
  const stick = (sx: number, sy: number) => {
    const c = centre.current;
    if (!c) return;
    // the view turned sideways in CSS (rotate 90° clockwise): the game's right is the screen's down
    const [dx, dy] = rotatedView() ? [sy, -sx] : [sx, sy];
    const nx = Math.max(-1, Math.min(1, dx / c.r));
    const ny = Math.max(-1, Math.min(1, dy / c.r));
    // (the knob moves inside the turned view, so it follows the game's axes)
    if (knob.current) knob.current.style.transform = `translate(${nx * c.r * 0.55}px, ${ny * c.r * 0.55}px)`;
    set(k("left"), nx < -0.35);
    set(k("right"), nx > 0.35);
    set(k("jump"), ny < -0.6);
    set(k("crouch"), ny > 0.6);
  };
  const stickEnd = () => {
    centre.current = null;
    if (knob.current) knob.current.style.transform = "";
    for (const a of ["left", "right", "jump", "crouch"] as const) set(k(a), false);
  };

  const btn = (label: string, action: keyof KeyMap, cls: string) => (
    <button
      type="button"
      className={`tp-btn ${cls}`}
      aria-label={`${who ? who + " " : ""}${label}`}
      data-testid={`tp-${who ? who.toLowerCase() + "-" : ""}${action}`}
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // capture keeps the press if the finger slides off
        }
        set(k(action), true);
      }}
      onPointerUp={() => set(k(action), false)}
      onPointerCancel={() => set(k(action), false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );

  return (
    <div className={`touchpad${who ? ` tp-${who.toLowerCase()}` : ""}`} data-testid={`touchpad${who ? "-" + who.toLowerCase() : ""}`}>
      <div
        className="tp-stick"
        data-testid={`tp-${who ? who.toLowerCase() + "-" : ""}stick`}
        aria-label={`${who ? who + " " : ""}joystick: drag to walk, up to jump, down to crouch`}
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          const r = e.currentTarget.getBoundingClientRect();
          centre.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
          stick(e.clientX - centre.current.x, e.clientY - centre.current.y);
        }}
        onPointerMove={(e) => centre.current && stick(e.clientX - centre.current.x, e.clientY - centre.current.y)}
        onPointerUp={stickEnd}
        onPointerCancel={stickEnd}
      >
        <span className="tp-knob" ref={knob} />
      </div>
      <div className="tp-buttons">
        {btn(punch, "punch", "tp-punch")}
        {btn(kick, "kick", "tp-kick")}
        {btn("Jump", "jump", "tp-jump")}
        {btn("Block", "block", "tp-block")}
        {!compact && btn("Crouch", "crouch", "tp-crouch")}
        {btn("★", "special", "tp-special")}
      </div>
    </div>
  );
}
