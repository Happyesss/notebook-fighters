"use client";
/**
 * "Rotate" for phones held upright during a fight (and in the online lobby): Android goes full screen
 * and locks landscape (Screen Orientation API); iOS can't lock, so the fight view itself turns sideways
 * in CSS (html[data-rotated="1"], see globals.css) with a short "turn your phone sideways" hint, and
 * the touch joystick maps the finger through the same turn (see rotatedView()).
 * The button only shows on touch screens in portrait.
 */
import { useEffect, useState } from "react";

/** the CSS-rotated fight view is active (the phone is upright and the game plays sideways) */
export function rotatedView(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.rotated === "1" && (window.matchMedia?.("(orientation: portrait)").matches ?? window.innerHeight > window.innerWidth);
}

type Orient = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

function relayout() {
  // the arena framing (play/arena.ts) and the renderer pick up the new shape
  window.dispatchEvent(new Event("resize"));
}

export function RotateButton() {
  const [mode, setMode] = useState<"off" | "locked" | "css">("off");
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 2600);
    return () => clearTimeout(t);
  }, [hint]);
  useEffect(() => {
    // leaving the page: nothing stays rotated or locked
    return () => {
      delete document.documentElement.dataset.rotated;
      try {
        (screen.orientation as Orient | undefined)?.unlock?.();
      } catch {
        // ignore
      }
    };
  }, []);
  useEffect(() => {
    // the player left full screen (Android back gesture): the lock is gone too
    const onFs = () => {
      if (!document.fullscreenElement && mode === "locked") setMode("off");
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [mode]);

  async function rotate() {
    if (mode === "css") {
      delete document.documentElement.dataset.rotated;
      setMode("off");
      relayout();
      return;
    }
    if (mode === "locked") {
      try {
        (screen.orientation as Orient).unlock?.();
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
        // ignore
      }
      setMode("off");
      return;
    }
    const orient = screen.orientation as Orient | undefined;
    if (orient?.lock && document.documentElement.requestFullscreen) {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        await orient.lock("landscape");
        setMode("locked");
        return;
      } catch {
        // no lock here (iOS, or a browser that refuses): rotate the view instead
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      }
    }
    document.documentElement.dataset.rotated = "1";
    setMode("css");
    setHint("Turn your phone sideways ↻");
    relayout();
  }

  return (
    <>
      <button type="button" className="rotate-btn" data-testid="rotate" data-mode={mode} aria-pressed={mode !== "off"} onClick={() => void rotate()} aria-label={mode === "off" ? "Rotate to landscape" : "Back to portrait"}>
        <span aria-hidden="true">⟳</span> {mode === "off" ? "Rotate" : "Portrait"}
      </button>
      {hint && (
        <p className="rotate-hint" role="status" data-testid="rotate-hint">
          {hint}
        </p>
      )}
    </>
  );
}
