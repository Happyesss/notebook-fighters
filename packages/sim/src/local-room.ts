/**
 * "Play nearby": an online room with no server. The host's own device plays the room (what the
 * Cloudflare Durable Object does for online rooms), and the friend talks to it over any reliable,
 * ordered text pipe — in the browser a WebRTC data channel paired by QR codes, in tests an
 * in-memory pair. Both players run the unchanged OnlineSession / Lockstep code:
 *
 *   const room = new HostRoom({ name, strokes, physics });  // host
 *   hostSession.attach(room.host);                           // the host's seat, in-process
 *   room.attachGuest(pipe);                                  // the friend's seat, over the pipe
 *
 *   const r = await PipeRoom.join(pipe, { name, strokes });  // friend
 *   guestSession.attach(r);
 *
 * Same protocol as the Worker room (see @nf/shared net.ts): lobby → "ask" the host with the
 * friend's drawing → accept / decline → round trips measured → input delay picked → "start" →
 * inputs relayed and logged, checksums compared every CHECKSUM_EVERY frames, desyncs flagged.
 * There is nothing to reconnect to: if the pipe closes, the friend's seat is gone.
 */
import { CLOSE, MAX_DELAY, pickDelay, type AskMsg, type InkStroke, type JoinMsg, type LobbyMsg, type SeatInfo, type StartMsg, type WelcomeMsg } from "@nf/shared";
import type { RoomLike } from "./online";
import { inferRig } from "./rig";

/** the transport under a nearby room: a reliable, ordered text channel (WebRTC data channel, test pair) */
export type Pipe = {
  send(text: string): void;
  onMessage(cb: (text: string) => void): void;
  /** fires once when the link is gone (closed, failed, or silent too long) */
  onClose(cb: (why: string) => void): void;
  close(): void;
};

type SeatNo = 0 | 1;
type Seat = { name: string; kind: string; strokes: InkStroke[] | null; connected: boolean; gone: boolean; rtts: number[] };
type Handlers = Map<string, ((m: any) => void)[]>;

const MAX_STROKES = 400;

function kindOf(strokes: InkStroke[] | null): string {
  try {
    if (strokes) return inferRig(strokes)?.kind ?? "sketch fighter";
  } catch {
    // unreadable drawing: the sketch
  }
  return "sketch fighter";
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
}

function parseBatch(text: string): [string, any][] {
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is [string, any] => Array.isArray(x) && typeof x[0] === "string").slice(0, 16);
}

/** a RoomLike whose messages are dispatched by type; queues messages that arrive before a listener */
class Endpoint implements RoomLike {
  private handlers: Handlers = new Map();
  private pending = new Map<string, any[]>();
  constructor(private out: (list: [string, unknown][]) => void) {}
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
  send(type: string, msg?: unknown) {
    this.out([[type, msg ?? {}]]);
  }
  sendBatch(list: [string, unknown][]) {
    if (list.length) this.out(list);
  }
  dispatch(type: string, m: any) {
    const hs = this.handlers.get(type);
    if (hs?.length) for (const h of hs) h(m);
    else {
      const q = this.pending.get(type) ?? [];
      q.push(m);
      this.pending.set(type, q);
    }
  }
}

export type HostRoomOpts = { name?: string; strokes: InkStroke[] | null; physics?: "rapier" | "classic"; code?: string };

/** the room, run on the host's device */
export class HostRoom {
  /** the host's seat (seat 0): hand it to OnlineSession.attach */
  readonly host: Endpoint;
  readonly code: string;
  phase: "lobby" | "fight" = "lobby";
  accepted = false;
  start: StartMsg | null = null;
  seats: [Seat | null, Seat | null];
  logs: [number[], number[]] = [[], []];
  stats = { inputs: 0, checksums: 0, desyncs: 0, messages: 0 };
  /** the friend's latest measured round trip to this device (ms) */
  guestRtt = 0;
  /** called when the friend's link goes away (after the host has been told) */
  onGuestGone: (why: string) => void = () => {};
  private physics: "rapier" | "classic";
  private sums: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  private guest: Pipe | null = null;
  private hostInbox: [string, unknown][] = [];
  private hostFlush = false;

  constructor(opts: HostRoomOpts) {
    this.code = opts.code ?? "NEARBY";
    this.physics = opts.physics ?? "rapier";
    const strokes = opts.strokes?.length ? opts.strokes.slice(0, MAX_STROKES) : null;
    this.seats = [{ name: (opts.name ?? "").trim().slice(0, 24) || "Host", kind: kindOf(strokes), strokes, connected: true, gone: false, rtts: [] }, null];
    // the host's messages to the room: handled on a microtask, like a message off a socket
    this.host = new Endpoint((list) => queueMicrotask(() => list.forEach(([t, m]) => this.handle(0, t, m ?? {}))));
    queueMicrotask(() => this.sendLobby());
  }

  /** the friend's link is up: their first message must be "join" */
  attachGuest(pipe: Pipe) {
    if (this.guest) {
      pipe.close();
      return;
    }
    this.guest = pipe;
    pipe.onMessage((text) => {
      if (this.guest !== pipe || text === "hb") return;
      this.stats.messages++;
      for (const [t, m] of parseBatch(text)) {
        if (t === "join") this.join(m as JoinMsg);
        else if (this.seats[1]) this.handle(1, t, m ?? {});
      }
    });
    pipe.onClose((why) => this.guestClosed(pipe, why));
  }

  /** the host leaves (page closed, Back): tell the friend, drop the link */
  close() {
    const g = this.guest;
    this.guest = null;
    if (g) {
      this.sendRaw(g, [["closed", { code: CLOSE.left }]]);
      setTimeout(() => g.close(), 50);
    }
  }

  private join(msg: JoinMsg) {
    if (this.seats[1] || this.phase !== "lobby" || !this.guest) return;
    const strokes = Array.isArray(msg?.strokes) && msg.strokes.length ? msg.strokes.slice(0, MAX_STROKES) : null;
    const name = String(msg?.name ?? "").trim().slice(0, 24) || "P2";
    this.seats[1] = { name, kind: kindOf(strokes), strokes, connected: true, gone: false, rtts: [] };
    this.accepted = false;
    this.sendTo(1, "welcome", { code: this.code, seat: 1, token: "", rejoined: false } satisfies WelcomeMsg);
    this.sendLobby();
    this.askHost();
  }

  private handle(s: SeatNo, type: string, msg: any) {
    const seat = this.seats[s];
    if (!seat) return;
    switch (type) {
      case "i": {
        if (this.phase !== "fight" || !Array.isArray(msg?.b) || !Number.isInteger(msg.f) || msg.f < 0) return;
        const log = this.logs[s];
        const first = log.length;
        const b = msg.b as unknown[];
        for (let k = 0; k < b.length && k < 1200; k++) if (msg.f + k === log.length) log.push(Number(b[k]) & 255);
        if (log.length === first) return;
        this.stats.inputs += log.length - first;
        this.sendTo((1 - s) as SeatNo, "i", { s, f: first, b: log.slice(first) });
        return;
      }
      case "c": {
        if (!Number.isInteger(msg?.f) || typeof msg?.h !== "number") return;
        this.stats.checksums++;
        this.sums[s].set(msg.f, msg.h);
        const theirs = this.sums[1 - s].get(msg.f);
        this.sendTo((1 - s) as SeatNo, "c", { s, f: msg.f, h: msg.h });
        if (theirs !== undefined && theirs !== msg.h) {
          this.stats.desyncs++;
          const h: [number, number] = s === 0 ? [msg.h, theirs] : [theirs, msg.h];
          this.broadcast("desync", { f: msg.f, h });
        }
        if (this.sums[s].size > 400) this.sums[s].delete(this.sums[s].keys().next().value!);
        return;
      }
      case "ping": {
        if (s === 1) {
          // the friend reports its last round trip (lobby and fight): that IS the link between the phones
          if (typeof msg?.r === "number" && msg.r >= 0) {
            this.guestRtt = Math.min(2000, Math.round(msg.r));
            if (this.phase === "lobby") {
              seat.rtts.push(this.guestRtt);
              if (seat.rtts.length > 10) seat.rtts.shift();
            }
          }
          this.sendTo(1, "pong", { t: msg?.t });
        } else {
          // the host's seat is in-process (0 ms); its ping shows the round trip to the friend instead
          if (typeof msg?.t === "number") this.sendTo(0, "pong", { t: msg.t - this.guestRtt });
          if (this.phase === "lobby") seat.rtts.push(0);
        }
        if (this.phase === "lobby") {
          this.broadcast("rtt", { r: [0, this.seats[1] ? median(this.seats[1].rtts) : 0] });
          this.maybeStart();
        }
        return;
      }
      case "resync":
        return this.sendTo(s, "log", { logs: this.logs });
      case "accept":
        if (s !== 0 || this.phase !== "lobby" || !this.seats[1] || this.accepted) return;
        this.accepted = true;
        this.sendLobby();
        return this.maybeStart();
      case "decline": {
        if (s !== 0 || this.phase !== "lobby" || !this.seats[1]) return;
        const g = this.guest;
        this.seats[1] = null;
        this.accepted = false;
        this.guest = null;
        if (g) {
          this.sendRaw(g, [["closed", { code: CLOSE.declined }]]);
          setTimeout(() => g.close(), 50);
        }
        this.sendLobby();
        return;
      }
      case "leave":
        if (s === 1 && this.guest) {
          const g = this.guest;
          this.guestClosed(g, "left");
          g.close();
        }
        return;
    }
  }

  private askHost() {
    const guest = this.seats[1];
    if (this.phase !== "lobby" || !guest || this.accepted) return;
    this.sendTo(0, "ask", { name: guest.name, kind: guest.kind, strokes: guest.strokes } satisfies AskMsg);
  }

  /** accepted and the friend's round trip measured (3 samples) → pick the input delay, fight */
  private maybeStart() {
    if (this.phase !== "lobby" || !this.accepted) return;
    const [a, b] = this.seats;
    if (!a || !b || b.rtts.length < 3) return;
    const rb = median(b.rtts);
    const spread = Math.max(...b.rtts) - Math.min(...b.rtts);
    // A → room is free (the room is on A): an input travels about rb / 2 to the friend
    const delay = Math.min(MAX_DELAY, pickDelay(0, rb, spread / 2));
    this.phase = "fight";
    this.start = { code: this.code, drawings: [a.strokes, b.strokes], names: [a.name, b.name], delay, physics: this.physics, rtts: [0, rb] };
    this.logs = [[], []];
    this.broadcast("start", this.start);
  }

  private guestClosed(pipe: Pipe, why: string) {
    if (this.guest !== pipe && this.guest !== null) return;
    const wasGuest = this.guest === pipe;
    this.guest = null;
    const seat = this.seats[1];
    if (!wasGuest || !seat) return;
    if (this.phase === "lobby") {
      this.seats[1] = null;
      this.accepted = false;
      this.sendLobby();
    } else {
      seat.connected = false;
      seat.gone = true;
      this.sendTo(0, "peer", { seat: 1, connected: false, gone: true });
    }
    this.onGuestGone(why);
  }

  private sendRaw(pipe: Pipe, list: [string, unknown][]) {
    try {
      pipe.send(JSON.stringify(list));
    } catch {
      // closing
    }
  }

  private sendTo(s: SeatNo, type: string, msg: unknown) {
    if (s === 0) {
      this.hostInbox.push([type, msg]);
      if (this.hostFlush) return;
      this.hostFlush = true;
      queueMicrotask(() => {
        this.hostFlush = false;
        for (const [t, m] of this.hostInbox.splice(0)) this.host.dispatch(t, m);
      });
      return;
    }
    if (this.guest && this.seats[1]?.connected) this.sendRaw(this.guest, [[type, msg]]);
  }

  private broadcast(type: string, msg: unknown) {
    this.sendTo(0, type, msg);
    this.sendTo(1, type, msg);
  }

  private sendLobby() {
    const seats = this.seats.map((x): SeatInfo => (x ? { name: x.name, kind: x.kind, connected: x.connected } : null)) as [SeatInfo, SeatInfo];
    for (const s of [0, 1] as const) this.sendTo(s, "lobby", { code: this.code, seats, you: s, accepted: this.accepted } satisfies LobbyMsg);
  }
}

/** the friend's end of a nearby room: a RoomLike over a Pipe (the NetRoom of play nearby) */
export class PipeRoom extends Endpoint {
  seat: 0 | 1 = 1;
  sent = 0;
  private leaveCbs: ((code: number, reason: string) => void)[] = [];
  private closed = false;

  private constructor(public pipe: Pipe) {
    super((list) => {
      if (this.closed) return;
      try {
        pipe.send(JSON.stringify(list));
        this.sent++;
      } catch {
        // closing: onClose reports it
      }
    });
  }

  /** sit down in the host's room; resolves on "welcome", rejects if the link closes first */
  static join(pipe: Pipe, opts: JoinMsg): Promise<PipeRoom> {
    return new Promise((resolve, reject) => {
      const room = new PipeRoom(pipe);
      let welcomed = false;
      let closeCode = 0;
      pipe.onMessage((text) => {
        if (text === "hb") return;
        for (const [t, m] of parseBatch(text)) {
          if (t === "welcome" && !welcomed) {
            welcomed = true;
            room.seat = (m as WelcomeMsg).seat;
            resolve(room);
          } else if (t === "closed") closeCode = Number(m?.code) || CLOSE.left;
          else room.dispatch(t, m);
        }
      });
      pipe.onClose((why) => {
        if (room.closed) return;
        room.closed = true;
        const code = closeCode || 1006;
        if (!welcomed) reject(Object.assign(new Error(code === CLOSE.declined ? "The host declined." : "The link to the host closed."), { code }));
        else for (const cb of room.leaveCbs) cb(code, why);
      });
      try {
        pipe.send(JSON.stringify([["join", opts]]));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  onLeave(cb: (code: number, reason: string) => void) {
    this.leaveCbs.push(cb);
  }

  leave() {
    if (this.closed) return;
    this.send("leave", {});
    this.closed = true;
    setTimeout(() => this.pipe.close(), 50);
  }
}

/** two Pipes joined back to back in memory (tests), optionally with a one-way delay in ms */
export function pipePair(oneWay = 0): [Pipe, Pipe] {
  type End = { msg: ((t: string) => void)[]; close: ((w: string) => void)[]; open: boolean };
  const ends: [End, End] = [
    { msg: [], close: [], open: true },
    { msg: [], close: [], open: true },
  ];
  const make = (i: 0 | 1): Pipe => {
    const me = ends[i];
    const other = ends[1 - i];
    let last = 0;
    return {
      send(text) {
        if (!me.open) throw new Error("closed");
        const at = Math.max(last, Date.now() + oneWay);
        last = at;
        setTimeout(() => other.open && other.msg.forEach((cb) => cb(text)), Math.max(0, at - Date.now()));
      },
      onMessage: (cb) => void me.msg.push(cb),
      onClose: (cb) => void me.close.push(cb),
      close() {
        if (!me.open) return;
        me.open = other.open = false;
        setTimeout(() => {
          me.close.forEach((cb) => cb("closed"));
          other.close.forEach((cb) => cb("closed"));
        }, 0);
      },
    };
  };
  return [make(0), make(1)];
}
