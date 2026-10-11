/**
 * Gamepad API: a controller drives a player exactly like their keys. Each frame `pollPads` reads the
 * connected pads and adds/removes that player's key names in the shared held-keys set (and latches
 * presses as taps), so the keyboard readers need no changes. Standard mapping:
 * left stick / d-pad move (up = jump, down = crouch) · A jump · X punch · Y kick · B or LB block · RB / RT special.
 */
import type { KeyMap } from "./controls";

const DEAD = 0.45;
type Want = Partial<Record<keyof KeyMap, boolean>>;

function wantOf(pad: Gamepad): Want {
  const b = (i: number) => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value ?? 0) > 0.5;
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  return {
    left: ax < -DEAD || b(14),
    right: ax > DEAD || b(15),
    jump: b(0) || ay < -0.75 || b(12),
    crouch: ay > 0.75 || b(13),
    punch: b(2),
    kick: b(3),
    block: b(1) || b(4) || b(6),
    special: b(5) || b(7),
  };
}

export function makePads() {
  // keys each pad is holding down right now (so a pad never releases a key the keyboard holds)
  const owned: Set<string>[] = [];
  return {
    /** call once per animation frame; maps[i] is the key map pad i plays with */
    poll(keys: Set<string>, taps: Set<string>, maps: KeyMap[]): number {
      const pads = typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()].filter((p): p is Gamepad => !!p && p.connected) : [];
      maps.forEach((map, i) => {
        const mine = (owned[i] ??= new Set());
        const pad = pads[i];
        const want = pad ? wantOf(pad) : {};
        for (const action of Object.keys(map) as (keyof KeyMap)[]) {
          const key = map[action][0];
          if (want[action]) {
            if (!mine.has(key)) {
              mine.add(key);
              keys.add(key);
              taps.add(key);
            }
          } else if (mine.has(key)) {
            mine.delete(key);
            keys.delete(key);
          }
        }
      });
      return pads.length;
    },
  };
}
