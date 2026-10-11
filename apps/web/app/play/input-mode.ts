/**
 * Which controls a fight page shows: the on-screen touch pads ("touch") or the keyboard legend ("keys").
 * It starts from the primary pointer (a phone/tablet's finger → touch, a mouse/trackpad → keys; set before
 * first paint by the inline script in layout.tsx) and follows the player on hybrid devices: the first real
 * touch shows the pads, a key press brings the legend back. Gamepads work with either.
 * The mode lives on <html data-input="touch|keys">; globals.css hides the other set of controls.
 */
export type InputMode = "touch" | "keys";

/** the inline <head> script: runs before paint so the wrong controls never flash */
export const INPUT_MODE_SCRIPT = `(function(){try{var d=document.documentElement;var c=window.matchMedia&&matchMedia("(pointer: coarse)").matches;d.setAttribute("data-input",c?"touch":"keys");}catch(e){}})();`;

export function initialInputMode(): InputMode {
  if (typeof window === "undefined") return "keys";
  return window.matchMedia?.("(pointer: coarse)").matches ? "touch" : "keys";
}

export function setInputMode(m: InputMode) {
  const d = document.documentElement;
  if (d.dataset.input !== m) d.dataset.input = m;
}

/** follow the player's hands; returns the cleanup */
export function watchInputMode(): () => void {
  if (!document.documentElement.dataset.input) setInputMode(initialInputMode());
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.pointerType === "pen") setInputMode("touch");
  };
  const onTouch = () => setInputMode("touch");
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    setInputMode("keys");
  };
  window.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
  window.addEventListener("touchstart", onTouch, { capture: true, passive: true });
  window.addEventListener("keydown", onKey, { capture: true });
  return () => {
    window.removeEventListener("pointerdown", onPointer, { capture: true });
    window.removeEventListener("touchstart", onTouch, { capture: true });
    window.removeEventListener("keydown", onKey, { capture: true });
  };
}
