/**
 * NetRoom: the client end of an online room on the Notebook Fighters Worker (Cloudflare Durable
 * Object), over one native WebSocket. Shared by the browser (/online) and the headless Node test
 * (which passes the `ws` package's WebSocket).
 *
 *   const room = await NetRoom.create(base, { name, strokes, physics })   // POST /api/rooms + join
 *   const room = await NetRoom.join(base, code, { name, strokes, token }) // join / take a seat back
 *
 * Wire format: every WebSocket message is a JSON array of [type, payload] pairs (see
 * @nf/shared net.ts), so one message can carry an input batch, a checksum and a ping together.
 */
import { BUSY_MESSAGE, CLOSE, type JoinMsg, type WelcomeMsg } from "@nf/shared";

type WsLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: any) => void) | null;
};
export type WsCtor = new (url: string) => WsLike;

/** http(s)://host or ws(s)://host → both forms */
export function serverBases(base: string) {
  const b = base.replace(/\/+$/, "");
  const http = b.replace(/^ws(s?):\/\//, "http$1://");
  const ws = http.replace(/^http(s?):\/\//, "ws$1://");
  return { http, ws };
}

/** an Error from NetRoom that means "the server is busy or out of reach" (not "no such room") */
export type NetError = Error & { code?: number; status?: number; busy?: boolean };
const busyError = (detail: string, extra: { code?: number; status?: number } = {}): NetError =>
  Object.assign(new Error(BUSY_MESSAGE), { busy: true, detail }, extra);
export const isBusyError = (e: unknown): boolean => !!(e && typeof e === "object" && (e as NetError).busy);

/** close codes after which reconnecting is pointless */
export const FINAL_CLOSE = new Set<number>([CLOSE.left, CLOSE.replaced, CLOSE.declined, CLOSE.notFound, CLOSE.full, CLOSE.expired]);

export class NetRoom {
  roomId = "";
  seat: 0 | 1 = 0;
  reconnectionToken = "";
  rejoined = false;
  /** WebSocket messages sent (for the request budget: each one is a billed request / 20) */
  sent = 0;
  private handlers = new Map<string, ((m: any) => void)[]>();
  private pending = new Map<string, any[]>();
  private leaveCbs: ((code: number, reason: string) => void)[] = [];
  private keepalive: ReturnType<typeof setInterval> | null = null;

  private constructor(public connection: WsLike) {}

  static async create(base: string, opts: JoinMsg & { physics?: "rapier" | "classic" }, Ws?: WsCtor): Promise<NetRoom> {
    const { http } = serverBases(base);
    let res: Response;
    try {
      res = await fetch(`${http}/api/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ physics: opts.physics }) });
    } catch {
      // offline, DNS, CORS-blocked error page, connection reset…
      throw busyError(`Couldn't reach the game server (${http}).`);
    }
    // 429 / 5xx (Cloudflare's "1027 exceeded" pages, Durable Object overload, the Worker's {error:"busy"})
    if (res.status === 429 || res.status >= 500) throw busyError(`The game server is busy (${res.status}).`, { status: res.status });
    if (!res.ok) throw Object.assign(new Error(`The game server couldn't make a room (${res.status}).`), { status: res.status });
    let code = "";
    try {
      code = ((await res.json()) as { code?: string }).code ?? "";
    } catch {
      // an HTML error page with a 200: treat as busy
    }
    if (!code) throw busyError("The game server answered without a room code.");
    return NetRoom.join(base, code, { name: opts.name, strokes: opts.strokes }, Ws);
  }

  static join(base: string, code: string, opts: JoinMsg, Ws?: WsCtor): Promise<NetRoom> {
    const Ctor = Ws ?? (globalThis as unknown as { WebSocket: WsCtor }).WebSocket;
    const url = `${serverBases(base).ws}/api/rooms/${encodeURIComponent(code)}/ws`;
    return new Promise((resolve, reject) => {
      let ws: WsLike;
      try {
        ws = new Ctor(url);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const room = new NetRoom(ws);
      let welcomed = false;
      ws.onopen = () => room.sendBatch([["join", opts]]);
      ws.onerror = () => {};
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string" || ev.data === "pong") return;
        let list: unknown;
        try {
          list = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!Array.isArray(list)) return;
        for (const item of list) {
          if (!Array.isArray(item) || typeof item[0] !== "string") continue;
          if (item[0] === "welcome" && !welcomed) {
            const w = item[1] as WelcomeMsg;
            welcomed = true;
            room.roomId = w.code;
            room.seat = w.seat;
            room.reconnectionToken = w.token;
            room.rejoined = w.rejoined;
            // keepalive for a quiet lobby: answered by the runtime, never wakes the room
            room.keepalive = setInterval(() => {
              if (ws.readyState === 1) ws.send("ping");
            }, 30_000);
            resolve(room);
            continue;
          }
          room.dispatch(item[0], item[1]);
        }
      };
      ws.onclose = (ev) => {
        if (room.keepalive) clearInterval(room.keepalive);
        if (!welcomed) {
          const why: Record<number, string> = { [CLOSE.declined]: "The host declined. Ask them for a new invite.", [CLOSE.notFound]: "No room with that code.", [CLOSE.full]: "That room is full or its match already started.", [CLOSE.expired]: "Your seat in that match has expired." };
          // a known room answer (declined / not found / full / expired) is final; anything else (the
          // upgrade refused with 429/503, 1006 abnormal close, 1011/1013 overload) means "busy"
          if (why[ev.code]) reject(Object.assign(new Error(why[ev.code]), { code: ev.code }));
          else reject(busyError(`Couldn't reach the game server (${serverBases(base).http}), close ${ev.code}.`, { code: ev.code }));
          return;
        }
        for (const cb of room.leaveCbs) cb(ev.code, ev.reason);
      };
    });
  }

  private dispatch(type: string, m: any) {
    const hs = this.handlers.get(type);
    if (hs?.length) for (const h of hs) h(m);
    else {
      // nobody listening yet (between "welcome" and attach): keep it for the first listener
      const q = this.pending.get(type) ?? [];
      q.push(m);
      this.pending.set(type, q);
    }
  }

  onMessage(type: string, cb: (m: any) => void) {
    const hs = this.handlers.get(type) ?? [];
    hs.push(cb);
    this.handlers.set(type, hs);
    const q = this.pending.get(type);
    if (q) {
      this.pending.delete(type);
      for (const m of q) cb(m);
    }
  }

  onLeave(cb: (code: number, reason: string) => void) {
    this.leaveCbs.push(cb);
  }

  send(type: string, msg?: unknown) {
    this.sendBatch([[type, msg ?? {}]]);
  }

  /** several messages in one WebSocket frame (= one billed request / 20) */
  sendBatch(list: [string, unknown][]) {
    if (this.connection.readyState !== 1 || !list.length) return;
    this.connection.send(JSON.stringify(list));
    this.sent++;
  }

  /** leave on purpose: the server frees the seat at once */
  leave() {
    if (this.keepalive) clearInterval(this.keepalive);
    try {
      this.connection.close(CLOSE.left, "left");
    } catch {
      // already closed
    }
  }

  /** pull the cable (tests): close without leaving, so the server holds the seat */
  drop() {
    try {
      this.connection.close(3001, "dropped");
    } catch {
      // already closed
    }
  }
}
