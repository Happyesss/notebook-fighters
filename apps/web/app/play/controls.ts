/** keyboard readers, HUD meters and the round banner, shared by /play and /online */
import type { PlayerInput } from "@nf/shared";
import type { FighterSnap, PowerKind, SimState } from "@nf/sim";

/** keys per player. 1P: either hand; 2P: P1 on the left of the keyboard, P2 on the right */
export type KeyMap = Record<"left" | "right" | "punch" | "kick" | "jump" | "block" | "crouch" | "special", string[]>;
export const KEYS_1P: KeyMap = { left: ["a", "arrowleft"], right: ["d", "arrowright"], punch: ["f", "j"], kick: ["g", "k"], jump: [" ", "w", "arrowup"], block: ["h", "shift"], crouch: ["s", "arrowdown"], special: ["e", "l"] };
export const KEYS_P1: KeyMap = { left: ["a"], right: ["d"], punch: ["f"], kick: ["g"], jump: ["w", " "], block: ["h"], crouch: ["s"], special: ["e"] };
export const KEYS_P2: KeyMap = { left: ["arrowleft"], right: ["arrowright"], punch: ["j"], kick: ["k"], jump: ["arrowup"], block: ["l"], crouch: ["arrowdown"], special: [";", "/"] };

/** turns held keys + latched taps into one player's input; presses wait in `carry` until a sim step uses them */
export function makeReader(map: KeyMap) {
  let prev = { punch: false, kick: false, jump: false, special: false };
  const carry = { punch: false, kick: false, jump: false, special: false };
  return {
    read(keys: Set<string>, taps: Set<string>): PlayerInput {
      const held = (k: keyof KeyMap) => map[k].some((key) => keys.has(key));
      const tapped = (k: keyof KeyMap) => map[k].some((key) => taps.has(key));
      const now = { punch: held("punch"), kick: held("kick"), jump: held("jump"), special: held("special") };
      for (const k of ["punch", "kick", "jump", "special"] as const) carry[k] ||= (now[k] && !prev[k]) || tapped(k);
      prev = now;
      const raw = (held("right") ? 1 : 0) - (held("left") ? 1 : 0);
      return { x: raw, punch: carry.punch, kick: carry.kick, jump: carry.jump, special: carry.special, block: held("block"), crouch: held("crouch") };
    },
    used() {
      carry.punch = carry.kick = carry.jump = carry.special = false;
    },
  };
}

export const POWER_NAMES: Record<PowerKind, string> = { fire: "Fireball", water: "Water wave", lightning: "Lightning dash", ice: "Ice shard", wings: "Dive", shield: "Shield bash", spikes: "Spike burst" };

/** the special's cooldown meter under a health bar */
export function paintMeter(el: HTMLElement | null, f: FighterSnap | undefined) {
  if (!el || !f) return;
  const ready = !!f.special && f.cool <= 0;
  const text = f.special ? (ready ? `${POWER_NAMES[f.special]} ready` : `${POWER_NAMES[f.special]} ${f.cool.toFixed(1)}s`) : "no power drawn";
  const fill = el.firstElementChild as HTMLElement | null;
  const label = el.lastElementChild as HTMLElement | null;
  const k = f.special ? 1 - f.cool / Math.max(0.01, f.coolMax) : 0;
  if (fill) fill.style.transform = `scaleX(${k})`;
  if (label && label.textContent !== text) label.textContent = text;
  const state = !f.special ? "none" : ready ? "ready" : "cooling";
  if (el.dataset.state !== state) el.dataset.state = state;
  if (el.dataset.power !== (f.special ?? "")) el.dataset.power = f.special ?? "";
}

/** the big centre banner: 3-2-1-FIGHT!, then the round result and what to press */
export function bannerFor(st: SimState, twoP = false): { text: string; sub: string; kind: string } {
  if (st.countdown > 0) return { text: String(Math.ceil(st.countdown)), sub: `Round ${st.round}`, kind: "count" };
  if (!st.over && st.sinceStart < 0.7) return { text: "FIGHT!", sub: "", kind: "fight" };
  if (st.over) {
    const who = st.winner === 0 ? (twoP ? "P1 wins" : "You win") : st.winner === 1 ? (twoP ? "P2 wins" : "Rival wins") : "Double K.O.";
    if (st.matchWinner !== null)
      return { text: twoP ? `P${st.matchWinner + 1} wins the match!` : st.matchWinner === 0 ? "You win the match!" : "Rival wins the match", sub: `${st.wins[0]}–${st.wins[1]} · Press R or tap for a rematch`, kind: "match" };
    return { text: `K.O.! ${who} round ${st.round}`, sub: `${st.wins[0]}–${st.wins[1]} · Press R or tap for round ${st.round + 1}`, kind: "ko" };
  }
  return { text: "", sub: "", kind: "" };
}

