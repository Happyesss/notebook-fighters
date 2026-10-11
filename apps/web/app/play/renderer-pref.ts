/** saved engine toggles: the fight renderer (PixiJS / Canvas2D) and the KO physics (Rapier / classic) */
export type RendererKind = "pixi" | "canvas";
export type PhysicsKind = "rapier" | "classic";
export const RENDERER_KEY = "nf:renderer";
export const PHYSICS_KEY = "nf:physics";
export const DEFAULT_RENDERER: RendererKind = "canvas";
export const DEFAULT_PHYSICS: PhysicsKind = "rapier";

function pick<T extends string>(params: URLSearchParams, param: string, key: string, allowed: readonly T[], dflt: T): T {
  const fromUrl = params.get(param) as T | null;
  if (fromUrl && allowed.includes(fromUrl)) {
    save(key, fromUrl);
    return fromUrl;
  }
  try {
    const saved = window.localStorage.getItem(key) as T | null;
    if (saved && allowed.includes(saved)) return saved;
  } catch {
    // storage blocked
  }
  return dflt;
}
export function save(key: string, v: string) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    // ignore
  }
}
/** ?renderer=pixi|canvas, else the saved choice, else Canvas2D (Pixi stays opt-in: slower than Canvas2D where measured, see ITERATIONS phase 5B) */
export const pickRenderer = (params: URLSearchParams) => pick<RendererKind>(params, "renderer", RENDERER_KEY, ["pixi", "canvas"], DEFAULT_RENDERER);
/** ?physics=rapier|classic, else the saved choice, else Rapier (classic verlet stays as ?physics=classic) */
export const pickPhysics = (params: URLSearchParams) => pick<PhysicsKind>(params, "physics", PHYSICS_KEY, ["rapier", "classic"], DEFAULT_PHYSICS);
/** did the player ask for Pixi themselves (URL or the toggle)? Then it runs even on a software WebGL */
export function chosePixi(params: URLSearchParams) {
  if (params.get("renderer") === "pixi") return true;
  try {
    return window.localStorage.getItem(RENDERER_KEY) === "pixi";
  } catch {
    return false;
  }
}
