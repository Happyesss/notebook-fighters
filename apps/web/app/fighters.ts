/**
 * The notebook's saved fighters (localStorage "nf:fighters"): every drawing on the home page, with its
 * colours, plus which one you play with (p1) and which one player 2 uses in a local duel (p2).
 *
 * The fight pages read the plain "nf:fighter" / "nf:fighter2" keys, so saving the book also mirrors
 * the selected drawings there (or removes them when the selected box is empty).
 */
import { STORAGE_KEY, STORAGE_KEY_P2 } from "@nf/shared";
import { hasInk, type Stroke } from "./ink";

export const FIGHTERS_KEY = "nf:fighters";
/** at most this many drawings on the page */
export const MAX_FIGHTERS = 8;

export type SavedFighter = { id: string; strokes: Stroke[] };
export type FighterBook = { fighters: SavedFighter[]; p1: string; p2: string };

let seq = 0;
export const newId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

function cleanStrokes(v: unknown): Stroke[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is Stroke => !!s && typeof s === "object" && Array.isArray((s as Stroke).points)).map((s) => ({ ...s, color: typeof s.color === "string" ? s.color : "#2a241c" }));
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
      .map((f) => ({ id: f.id, strokes: cleanStrokes(f.strokes) }));
    if (fighters.length) {
      const has = (id: unknown) => typeof id === "string" && fighters.some((f) => f.id === id);
      const p1 = has(saved.p1) ? (saved.p1 as string) : fighters[0].id;
      const p2 = has(saved.p2) ? (saved.p2 as string) : (fighters[1] ?? fighters[0]).id;
      return { fighters, p1, p2 };
    }
  }
  const book = emptyBook();
  book.fighters[0].strokes = cleanStrokes(readJson(STORAGE_KEY));
  book.fighters[1].strokes = cleanStrokes(readJson(STORAGE_KEY_P2));
  return book;
}

export const strokesOf = (book: FighterBook, id: string) => book.fighters.find((f) => f.id === id)?.strokes ?? [];

/** save the book and mirror the selected drawings for the fight pages */
export function saveBook(book: FighterBook) {
  try {
    window.localStorage.setItem(FIGHTERS_KEY, JSON.stringify(book));
    for (const [key, id] of [[STORAGE_KEY, book.p1], [STORAGE_KEY_P2, book.p2]] as const) {
      const strokes = strokesOf(book, id);
      if (hasInk(strokes)) window.localStorage.setItem(key, JSON.stringify(strokes));
      else window.localStorage.removeItem(key);
    }
  } catch {
    // storage full or blocked: the drawings live until the page closes
  }
}

/** the drawing you fight with: the plain key first (what /play reads), else the book's selection */
export function myFighter(): Stroke[] | null {
  const plain = cleanStrokes(readJson(STORAGE_KEY));
  if (hasInk(plain)) return plain;
  try {
    const book = loadBook();
    const mine = strokesOf(book, book.p1);
    return hasInk(mine) ? mine : null;
  } catch {
    return null;
  }
}

/** a drawing made somewhere else (the online page's "draw first"): into the selected box if it is empty, else an empty box, else a new one; it becomes the selection */
export function adoptFighter(strokes: Stroke[]) {
  const book = loadBook();
  const sel = book.fighters.find((f) => f.id === book.p1);
  const empty = sel && !hasInk(sel.strokes) ? sel : book.fighters.find((f) => !hasInk(f.strokes));
  if (empty) {
    empty.strokes = strokes;
    book.p1 = empty.id;
  } else if (book.fighters.length < MAX_FIGHTERS) {
    const id = newId();
    book.fighters.push({ id, strokes });
    book.p1 = id;
  } else if (sel) sel.strokes = strokes; // a full book: the selected drawing is replaced
  saveBook(book);
}
