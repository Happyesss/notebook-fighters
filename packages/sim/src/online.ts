/**
 * Client side of an online duel, shared by the browser (/online) and the headless Node test.
 * Wraps a Colyseus room (anything with send / onMessage), optionally behind a simulated lossy link
 * (?lag=100&jitter=30: 100 ms extra round trip, ±30 ms per message, still in order like TCP),
 * builds the lockstep sim when the server says "start", and fast-forwards after a reconnect.
 */
import type { DesyncMsg, InputMsg, LobbyMsg, LogMsg, PeerMsg, PlayerInput, StartMsg, SumMsg } from "@nf/shared";
import { Lockstep } from "./lockstep";
import { createSim, type FxEvent, type NotebookSim } from "./sim";

export type RoomLike = { send(type: string, msg?: unknown): void; onMessage(type: string, cb: (m: any) => void): unknown };

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

export type SessionOpts = { lag?: number; jitter?: number; now?: () => number };

export class OnlineSession {
  room: RoomLike | null = null;
  lobby: LobbyMsg | null = null;
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
  /** called whenever something the UI shows changes */
  onChange: () => void = () => {};
  private out: LagPipe;
  private inn: LagPipe;
  private queue: [string, any][] = [];
  private building = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private now: () => number;

  constructor(opts: SessionOpts = {}) {
    this.now = opts.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    const oneWay = (opts.lag ?? 0) / 2;
    this.out = new LagPipe(oneWay, opts.jitter ?? 0);
    this.inn = new LagPipe(oneWay, opts.jitter ?? 0);
  }

  /** bind to a (new, after a reconnect) room */
  attach(room: RoomLike) {
    this.room = room;
    this.connected = true;
    const on = (type: string) => room.onMessage(type, (m) => this.inn.run(() => this.handle(type, m)));
    for (const t of ["lobby", "start", "i", "log", "c", "desync", "peer", "pong", "sping", "rtt"]) on(t);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.send("ping", { t: this.now() }), 1000);
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

  send(type: string, msg: unknown) {
    const room = this.room;
    if (!room) return;
    this.out.run(() => {
      try {
        if (this.connected) room.send(type, msg);
      } catch {
        // socket closed under us: the reconnect resends
      }
    });
  }

  private handle(type: string, m: any) {
    if (type === "sping") return this.send("spong", { n: m.n });
    if (type === "pong") {
      this.rtt = Math.round(this.now() - m.t);
      return this.onChange();
    }
    if (type === "rtt") {
      this.rtts = m.r;
      return;
    }
    if (type === "lobby") {
      this.lobby = m as LobbyMsg;
      this.seat = this.lobby.you;
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
    this.lock = new Lockstep(sim, this.seat, st.delay, {
      input: (f, b) => this.send("i", { f, b }),
      checksum: (f, h) => this.send("c", { f, h }),
    });
    this.building = false;
    for (const [t, m] of this.queue.splice(0)) this.apply(t, m);
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
    const allow = lock.backlog() > 2 ? 3 : 1;
    for (let k = 0; k < allow; k++) {
      const fx = lock.step();
      if (!fx) break;
      out.steps++;
      out.events.push(...fx.events);
      out.impact += fx.impact;
    }
    if (!out.steps) lock.stalls++;
    return out;
  }
}
