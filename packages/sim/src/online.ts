/**
 * Client side of an online duel, shared by the browser (/online) and the headless Node test.
 * Wraps a NetRoom (anything with send / onMessage, ideally sendBatch), optionally behind a simulated
 * lossy link (?lag=100&jitter=30: 100 ms extra round trip, ±30 ms per message, still in order like
 * TCP), builds the lockstep sim when the server says "start", and fast-forwards after a reconnect.
 *
 * Request budget (Durable Objects bill incoming WebSocket messages 20:1): inputs go several frames
 * per message (Lockstep batching), and checksums and fight-time pings never get a message of their
 * own — they ride along with the next input batch (or go after at most 250 ms when stalled).
 */
import { MAX_INPUT_BATCH, type AskMsg, type DesyncMsg, type InputMsg, type LobbyMsg, type LogMsg, type PeerMsg, type PlayerInput, type StartMsg, type SumMsg } from "@nf/shared";
import { Lockstep } from "./lockstep";
import { createSim, type FxEvent, type NotebookSim } from "./sim";

export type RoomLike = {
  send(type: string, msg?: unknown): void;
  sendBatch?(list: [string, unknown][]): void;
  onMessage(type: string, cb: (m: any) => void): unknown;
};
type Outgoing = [string, unknown | (() => unknown)];

/** an in-order delayed pipe: each call lands lag/2 ± jitter later, never before the previous one */
export class LagPipe {
  private last = 0;
  constructor(
    public oneWay: number,
    public jitter: number,
    private now: () => number = () => Date.now(),
    private rand: () => number = Math.random,
  ) {}
  run(fn: () => void) {
    if (this.oneWay <= 0 && this.jitter <= 0) return fn();
    const t = Math.max(this.last, this.now() + this.oneWay + (this.rand() * 2 - 1) * this.jitter);
    this.last = t;
    setTimeout(fn, Math.max(0, t - this.now()));
  }
}

export type SessionOpts = {
  lag?: number;
  jitter?: number;
  now?: () => number;
  /** most frames per input message (1 = no batching, the old one-message-per-frame behaviour) */
  batch?: number;
};

export class OnlineSession {
  room: RoomLike | null = null;
  lobby: LobbyMsg | null = null;
  /** the host's pending question: this friend sat down, accept or decline? (null once answered / the seat emptied) */
  ask: AskMsg | null = null;
  start: StartMsg | null = null;
  lock: Lockstep | null = null;
  sim: NotebookSim | null = null;
  seat: 0 | 1 = 0;
  rtt = 0;
  rtts: [number, number] = [0, 0];
  peer: { connected: boolean; gone: boolean } = { connected: true, gone: false };
  serverDesyncs: DesyncMsg[] = [];
  rebuilt = 0;
  fastForwarded = 0;
  connected = true;
  /** WebSocket messages sent (each one is 1/20 of a billed request) */
  sentMsgs = 0;
  /** of which carried inputs */
  inputMsgs = 0;
  /** called whenever something the UI shows changes */
  onChange: () => void = () => {};
  private out: LagPipe;
  private inn: LagPipe;
  private queue: [string, any][] = [];
  private building = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private now: () => number;
  private batch: number;
  private outbox: Outgoing[] = [];
  private outboxSince = 0;
  private lastPing = -1e9;
  private measured = false;

  constructor(opts: SessionOpts = {}) {
    this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this.batch = Math.max(1, Math.round(opts.batch ?? MAX_INPUT_BATCH));
    const oneWay = (opts.lag ?? 0) / 2;
    this.out = new LagPipe(oneWay, opts.jitter ?? 0);
    this.inn = new LagPipe(oneWay, opts.jitter ?? 0);
  }

  /** bind to a (new, after a reconnect) room */
  attach(room: RoomLike) {
    this.room = room;
    this.connected = true;
    const on = (type: string) => room.onMessage(type, (m) => this.inn.run(() => this.handle(type, m)));
    for (const t of ["lobby", "ask", "start", "i", "log", "c", "desync", "peer", "pong", "rtt"]) on(t);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.outbox = [];
    this.pingTimer = setInterval(() => this.housekeeping(), 250);
    // after a reconnect: ask for what we missed
    if (this.lock) this.send("resync", {});
  }

  detach() {
    this.connected = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.onChange();
  }

  dispose() {
    this.detach();
    this.sim?.destroy();
    this.sim = null;
    this.lock = null;
  }

  /** send now, together with anything deferred (one WebSocket message) */
  send(type: string, msg: unknown) {
    this.outbox.push([type, msg]);
    this.flushOut();
  }

  /** send with the next message (checksums, fight-time pings): costs no message of its own */
  defer(type: string, msg: unknown | (() => unknown)) {
    if (!this.outbox.length) this.outboxSince = this.now();
    this.outbox.push([type, msg]);
  }

  private flushOut() {
    const room = this.room;
    if (!room || !this.outbox.length) return;
    // lazily built payloads (a ping's timestamp) are stamped when they actually leave
    const list = this.outbox.splice(0).map(([t, m]): [string, unknown] => [t, typeof m === "function" ? (m as () => unknown)() : m]);
    if (list.some(([t]) => t === "i")) this.inputMsgs++;
    this.sentMsgs++;
    this.out.run(() => {
      try {
        if (!this.connected) return;
        if (room.sendBatch) room.sendBatch(list);
        else for (const [t, m] of list) room.send(t, m);
      } catch {
        // socket closed under us: the reconnect resends
      }
    });
  }

  /** every 250 ms: pings (fast in the lobby to pick the input delay, 1/s riding along in the fight), stale deferred messages */
  private housekeeping() {
    if (!this.connected) return;
    const t = this.now();
    if (this.lock) {
      if (t - this.lastPing >= 1000) {
        this.lastPing = t;
        this.defer("ping", () => ({ t: this.now() }));
      }
    } else if (!this.start && this.lobby?.seats[0] && this.lobby.seats[1]) {
      // both seated: measure the round trip; each ping reports the last one so the room can pick the delay
      this.lastPing = t;
      this.send("ping", { t, r: this.measured ? this.rtt : undefined });
    }
    if (this.outbox.length && t - this.outboxSince >= 250) this.flushOut();
  }

  private handle(type: string, m: any) {
    if (type === "pong") {
      if (typeof m?.t !== "number") return;
      this.rtt = Math.round(this.now() - m.t);
      this.measured = true;
      return this.onChange();
    }
    if (type === "rtt") {
      this.rtts = m.r;
      return;
    }
    if (type === "lobby") {
      this.lobby = m as LobbyMsg;
      this.seat = this.lobby.you;
      // the friend left, was declined, or was accepted: nothing left to answer
      if (!this.lobby.seats[1] || this.lobby.accepted) this.ask = null;
      return this.onChange();
    }
    if (type === "ask") {
      this.ask = m as AskMsg;
      return this.onChange();
    }
    if (type === "peer") {
      const p = m as PeerMsg;
      if (p.seat !== this.seat) this.peer = { connected: p.connected, gone: !!p.gone };
      return this.onChange();
    }
    if (type === "desync") {
      this.serverDesyncs.push(m as DesyncMsg);
      return this.onChange();
    }
    if (type === "start") {
      if (this.start || this.building) return;
      this.start = m as StartMsg;
      void this.build();
      return;
    }
    if (!this.lock) {
      this.queue.push([type, m]);
      return;
    }
    this.apply(type, m);
  }

  private apply(type: string, m: any) {
    const lock = this.lock!;
    if (type === "i") {
      const x = m as InputMsg;
      lock.receive(x.s, x.f, x.b);
    } else if (type === "c") {
      const x = m as SumMsg;
      lock.receiveSum(x.f, x.h);
    } else if (type === "log") {
      lock.receiveLog((m as LogMsg).logs);
      // a rebuilt client (page reload) catches up at once
      const n = lock.fastForward(lock.frame === 0 ? Infinity : 0);
      if (n > 0) this.fastForwarded += n;
    }
  }

  private async build() {
    this.building = true;
    const st = this.start!;
    if (this.lobby) this.seat = this.lobby.you;
    const sim = await createSim({ player: st.drawings[0], rival: st.drawings[1], ai: "versus", countdown: 3, physics: st.physics });
    this.sim = sim;
    // frames an input needs to reach the peer: A → room → B ≈ (rttA + rttB) / 2
    const need = Math.ceil((st.rtts[0] + st.rtts[1]) / 2 / (1000 / 60));
    this.lock = new Lockstep(
      sim,
      this.seat,
      st.delay,
      {
        input: (f, b) => this.send("i", { f, b }),
        checksum: (f, h) => this.defer("c", { f, h }),
      },
      this.batch > 1 ? { need, maxBatch: this.batch } : null,
    );
    this.building = false;
    for (const [t, m] of this.queue.splice(0)) this.apply(t, m);
    this.onChange();
  }

  /** host: let the friend who sat down play (the fight starts once both round trips are measured) */
  accept() {
    this.ask = null;
    this.send("accept", {});
    this.onChange();
  }

  /** host: send the friend away (their socket closes with 4403) and wait for someone else */
  decline() {
    this.ask = null;
    this.send("decline", {});
    this.onChange();
  }

  /** a reconnect after a page reload: we know our seat but must rebuild from the server's log */
  expectRebuild(seat: 0 | 1) {
    this.seat = seat;
    this.rebuilt++;
  }

  /**
   * one fixed 60 Hz tick of real time: schedule our input (unless we're a full delay ahead of the
   * peer), then simulate one frame (up to three when inputs piled up while we were behind)
   */
  tick(input: PlayerInput): { sampled: boolean; steps: number; events: FxEvent[]; impact: number } {
    const lock = this.lock;
    const out = { sampled: false, steps: 0, events: [] as FxEvent[], impact: 0 };
    if (!lock) return out;
    out.sampled = this.connected && lock.sample(input);
    if (!out.sampled && this.connected) lock.maybeFlush();
    const allow = lock.catchUp();
    for (let k = 0; k < allow; k++) {
      const fx = lock.step();
      if (!fx) break;
      out.steps++;
      out.events.push(...fx.events);
      out.impact += fx.impact;
    }
    if (!out.steps) {
      lock.stalls++;
      if (this.connected) lock.flushPending();
    }
    return out;
  }
}
