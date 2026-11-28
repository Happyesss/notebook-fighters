/**
 * The notebook's saved fighters (localStorage "nf:fighters"): every drawing on the home page, with its
 * colours, plus which one you play with (p1) and which one player 2 uses in a local duel (p2).
 *
 * The fight pages read the plain "nf:fighter" / "nf:fighter2" keys, so saving the book also mirrors
 * the selected drawings there (or removes them when the selected box is empty).
 */
import { STORAGE_KEY, STORAGE_KEY_P2, readTag, withTag, type InkStroke } from "@nf/shared";
import { ROSTER, isPickable } from "@nf/sim";
import { hasInk, type Stroke } from "./ink";

export const FIGHTERS_KEY = "nf:fighters";
/** at most this many drawings on the page */
export const MAX_FIGHTERS = 8;

/**
 * One page of the notebook: your own drawing, or a ready-made fighter from the roster (`preset`, read-only:
 * its strokes come from the roster, never stored), plus an optional special move picked on the drawing pad.
 */
export type SavedFighter = { id: string; strokes: Stroke[]; special?: string; preset?: string };
export type FighterBook = { fighters: SavedFighter[]; p1: string; p2: string };

let seq = 0;
export const newId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

function cleanStrokes(v: unknown): Stroke[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is Stroke => !!s && typeof s === "object" && Array.isArray((s as Stroke).points) && (s as Stroke).points.length > 0).map((s) => ({ ...s, color: typeof s.color === "string" ? s.color : "#2a241c" }));
}

/** the roster fighter a page picked (null: its own drawing) */
export const presetOf = (f: Pick<SavedFighter, "preset"> | null | undefined) => (f?.preset ? ROSTER.find((r) => r.id === f.preset) ?? null : null);
/** what a page shows and fights with: the roster's strokes for a ready-made fighter, else the drawing */
export const inkOf = (f: SavedFighter | null | undefined): Stroke[] => (f ? (presetOf(f)?.strokes as Stroke[] | undefined) ?? f.strokes : []);
/** a page's special move: a ready-made fighter's own, else the one picked for the drawing (null: from the doodles) */
export const specialOf = (f: SavedFighter | null | undefined): string | null => presetOf(f)?.signature ?? (f && isPickable(f.special) ? f.special : null);
/** a page as the fight pages read it: the ink with its tag (picked special / ready-made fighter) in front */
export function fightStrokes(f: SavedFighter | null | undefined): InkStroke[] {
  if (!f) return [];
  const preset = presetOf(f);
  return withTag(inkOf(f), preset ? { preset: preset.id } : isPickable(f.special) ? { special: f.special } : null);
}
/** what the big pad hands back (a drawing plus its picks), as the fight pages read it */
export const padToFight = (strokes: Stroke[], x: { special: string | null; preset: string | null }): InkStroke[] =>
  fightStrokes({ id: "", strokes, ...(x.preset ? { preset: x.preset } : {}), ...(x.special ? { special: x.special } : {}) });
/** a stored fight drawing back into a page (its tag becomes the page's fields) */
function fromFight(strokes: InkStroke[]): Omit<SavedFighter, "id"> {
  const { ink, tag } = readTag(strokes);
  if (tag?.preset && ROSTER.some((r) => r.id === tag.preset)) return { strokes: [], preset: tag.preset };
  return { strokes: cleanStrokes(ink), ...(isPickable(tag?.special) ? { special: tag!.special } : {}) };
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** two empty boxes: you and player 2 */
export function emptyBook(): FighterBook {
  const a = newId();
  const b = newId();
  return { fighters: [{ id: a, strokes: [] }, { id: b, strokes: [] }], p1: a, p2: b };
}

/** the saved book; first visit after an update: the old two drawings move in */
export function loadBook(): FighterBook {
  const saved = readJson(FIGHTERS_KEY) as Partial<FighterBook> | null;
  if (saved && Array.isArray(saved.fighters) && saved.fighters.length) {
    const fighters = saved.fighters
      .filter((f) => f && typeof f.id === "string")
      .slice(0, MAX_FIGHTERS)
      .map((f) => ({
        id: f.id,
        strokes: cleanStrokes(f.strokes),
        ...(typeof f.preset === "string" && ROSTER.some((r) => r.id === f.preset) ? { preset: f.preset } : {}),
        ...(isPickable(f.special) ? { special: f.special } : {}),
      }));
    if (fighters.length) {
      const has = (id: unknown) => typeof id === "string" && fighters.some((f) => f.id === id);
      const p1 = has(saved.p1) ? (saved.p1 as string) : fighters[0].id;
      const p2 = has(saved.p2) ? (saved.p2 as string) : (fighters[1] ?? fighters[0]).id;
      return { fighters, p1, p2 };
    }
  }
  const book = emptyBook();
  for (const [i, key] of [[0, STORAGE_KEY], [1, STORAGE_KEY_P2]] as const) {
    const raw = readJson(key);
    if (Array.isArray(raw)) Object.assign(book.fighters[i], fromFight(raw as InkStroke[]));
  }
  return book;
}

export const fighterOf = (book: FighterBook, id: string) => book.fighters.find((f) => f.id === id) ?? null;
/** a page's ink (a ready-made fighter's strokes, or the drawing) */
export const strokesOf = (book: FighterBook, id: string) => inkOf(fighterOf(book, id));

/** save the book and mirror the selected drawings for the fight pages */
export function saveBook(book: FighterBook) {
  try {
    window.localStorage.setItem(FIGHTERS_KEY, JSON.stringify(book));
    for (const [key, id] of [[STORAGE_KEY, book.p1], [STORAGE_KEY_P2, book.p2]] as const) {
      const f = fighterOf(book, id);
      if (hasInk(inkOf(f))) window.localStorage.setItem(key, JSON.stringify(fightStrokes(f)));
      else window.localStorage.removeItem(key);
    }
  } catch {
    // storage full or blocked: the drawings live until the page closes
  }
}

/** the drawing you fight with (with its tag): the plain key first (what /play reads), else the book's selection */
export function myFighter(): InkStroke[] | null {
  const raw = readJson(STORAGE_KEY);
  if (Array.isArray(raw)) {
    const page = fromFight(raw as InkStroke[]);
    if (hasInk(inkOf({ id: "", ...page }))) return fightStrokes({ id: "", ...page });
  }
  try {
    const book = loadBook();
    const mine = fighterOf(book, book.p1);
    return hasInk(inkOf(mine)) ? fightStrokes(mine) : null;
  } catch {
    return null;
  }
}

/** a drawing made somewhere else (the online page's "draw first"): into the selected box if it is empty, else an empty box, else a new one; it becomes the selection */
export function adoptFighter(strokes: InkStroke[]) {
  const book = loadBook();
  const page = fromFight(strokes);
  const sel = book.fighters.find((f) => f.id === book.p1);
  const empty = sel && !hasInk(inkOf(sel)) ? sel : book.fighters.find((f) => !hasInk(inkOf(f)));
  const put = (f: SavedFighter) => {
    f.strokes = page.strokes;
    if (page.preset) f.preset = page.preset;
    else delete f.preset;
    if (page.special) f.special = page.special;
    else delete f.special;
  };
  if (empty) {
    put(empty);
    book.p1 = empty.id;
  } else if (book.fighters.length < MAX_FIGHTERS) {
    const id = newId();
    book.fighters.push({ id, ...page });
    book.p1 = id;
  } else if (sel) put(sel); // a full book: the selected drawing is replaced
  saveBook(book);
}
