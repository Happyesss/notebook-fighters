/**
 * Phones and tablets frame the arena differently: in landscape the canvas fills the whole screen and the
 * ground sits above the thumb controls, so the fighters are big and nothing covers them; in portrait the
 * arena sits above the controls and keeps less side room (the screen is narrow).
 */
type Framed = { layout: { ground: number; fill: number; margin: number } };

export type ArenaFit = "phone-landscape" | "phone-portrait" | "tablet" | "desktop";

export function arenaFit(): ArenaFit {
  if (typeof window === "undefined") return "desktop";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  // an upright phone playing sideways (Rotate on iOS): frame it as landscape
  const turned = document.documentElement.dataset.rotated === "1" && window.innerHeight > window.innerWidth;
  const w = turned ? window.innerHeight : window.innerWidth;
  const h = turned ? window.innerWidth : window.innerHeight;
  if (coarse && h <= 520 && w > h) return "phone-landscape";
  if (coarse && w <= 600) return "phone-portrait";
  if (coarse) return "tablet";
  return "desktop";
}

const LAYOUTS: Record<ArenaFit, Framed["layout"]> = {
  "phone-landscape": { ground: 0.75, fill: 0.47, margin: 1.9 },
  "phone-portrait": { ground: 0.9, fill: 0.5, margin: 1.4 },
  tablet: { ground: 0.8, fill: 0.4, margin: 2.2 },
  desktop: { ground: 0.8, fill: 0.36, margin: 2.6 },
};

/** keep the view's framing in step with the screen (rotating a phone); returns the cleanup */
export function fitArena(view: Framed): () => void {
  const apply = () => {
    const fit = arenaFit();
    view.layout = { ...LAYOUTS[fit] };
    document.documentElement.dataset.fit = fit;
  };
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
  };
}
