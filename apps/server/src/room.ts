/**
 * DuelRoom — one online 1v1 (plan §10). Colyseus is used for rooms, matchmaking by code and
 * reconnection; the fight itself is deterministic lockstep on the clients, so the server only:
 *  · seats two players and holds their drawings (authoritative for the lobby → fight phase),
 *  · measures each client's round trip and picks the input delay,
 *  · relays input frames and keeps the full input log of both seats (a reconnecting client
 *    fast-forwards from it),
 *  · compares the clients' checksums and flags a desync.
 */
import { Room, type Client } from "@colyseus/core";
import { inferRig } from "@nf/sim";
import {
  MAX_DELAY,
  ROOM_NAME,
  isRoomCode,
  makeRoomCode,
  pickDelay,
  type InkStroke,
  type JoinOptions,
  type LobbyMsg,
  type SeatInfo,
  type StartMsg,
} from "@nf/shared";

type Seat = { sessionId: string; client: Client; name: string; kind: string; strokes: InkStroke[] | null; connected: boolean; rtts: number[] };

export const stats = { rooms: 0, matches: 0, inputs: 0, checksums: 0, desyncs: 0, reconnects: 0 };
const usedCodes = new Set<string>();

export class DuelRoom extends Room {
  maxClients = 2;
  private seats: [Seat | null, Seat | null] = [null, null];
  private phase: "lobby" | "fight" = "lobby";
  private start: StartMsg | null = null;
  private logs: [number[], number[]] = [[], []];
  private sums: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  private physics: "rapier" | "classic" = "rapier";
  private pingSeq = 0;
  private pings = new Map<string, number>();

  onCreate(options: JoinOptions & { code?: string }) {
    let code = options.code && isRoomCode(options.code) && !usedCodes.has(options.code) ? options.code : makeRoomCode();
    while (usedCodes.has(code)) code = makeRoomCode();
    usedCodes.add(code);
    this.roomId = code;
    this.physics = options.physics === "classic" ? "classic" : "rapier";
    this.setMetadata({ code });
    stats.rooms++;

    this.onMessage("i", (client, m: { f: number; b: number[] }) => {
      const s = this.seatOf(client);
      if (s === -1 || this.phase !== "fight" || !Array.isArray(m?.b) || !Number.isInteger(m.f) || m.f < 0) return;
      const log = this.logs[s];
      // frames are final once logged: only append (the redundant copies of old frames are ignored)
      let fresh = 0;
      for (let k = 0; k < m.b.length; k++) {
        const f = m.f + k;
        if (f === log.length) {
          log.push(m.b[k] & 255);
          fresh++;
        }
      }
      if (!fresh) return;
      stats.inputs += fresh;
      const other = this.seats[1 - s];
      // relay the last few frames (redundancy) to the other player
      const from = Math.max(0, log.length - 8);
      if (other?.connected) other.client.send("i", { s, f: from, b: log.slice(from) });
    });
    this.onMessage("c", (client, m: { f: number; h: number }) => {
      const s = this.seatOf(client);
      if (s === -1) return;
      stats.checksums++;
      this.sums[s].set(m.f, m.h);
      const theirs = this.sums[1 - s].get(m.f);
      this.seats[1 - s]?.client.send("c", { s, f: m.f, h: m.h });
      if (theirs !== undefined && theirs !== m.h) {
        stats.desyncs++;
        const h: [number, number] = s === 0 ? [m.h, theirs] : [theirs, m.h];
        console.warn(`[${this.roomId}] DESYNC at frame ${m.f}: ${h.map((x) => x.toString(16)).join(" vs ")}`);
        this.broadcast("desync", { f: m.f, h });
      }
      // keep memory bounded
      if (this.sums[s].size > 400) this.sums[s].delete(this.sums[s].keys().next().value!);
    });
    this.onMessage("ping", (client, m: { t: number }) => client.send("pong", { t: m?.t }));
    this.onMessage("spong", (client, m: { n: number }) => {
      const s = this.seatOf(client);
      const sent = this.pings.get(`${client.sessionId}:${m?.n}`);
      if (s === -1 || sent === undefined) return;
      this.pings.delete(`${client.sessionId}:${m.n}`);
      const seat = this.seats[s]!;
      seat.rtts.push(Date.now() - sent);
      if (seat.rtts.length > 10) seat.rtts.shift();
      this.broadcast("rtt", { r: this.seats.map((x) => (x ? median(x.rtts) : 0)) });
      this.maybeStart();
    });
    this.onMessage("resync", (client) => this.sendLog(client));
    // the server's own pings (for the input delay): a few a second in the lobby, slower in the fight
    this.clock.setInterval(() => {
      for (const seat of this.seats) {
        if (!seat?.connected) continue;
        const n = ++this.pingSeq;
        this.pings.set(`${seat.sessionId}:${n}`, Date.now());
        seat.client.send("sping", { n });
      }
    }, 250);
  }

  onJoin(client: Client, options: JoinOptions = {}) {
    const s = this.seats[0] ? 1 : 0;
    if (this.seats[s] || this.phase !== "lobby") throw new Error("room full");
    const strokes = Array.isArray(options.strokes) && options.strokes.length ? options.strokes.slice(0, 400) : null;
    let kind = "sketch fighter";
    try {
      if (strokes) kind = inferRig(strokes)?.kind ?? kind;
    } catch {
      // unreadable drawing: the sketch
    }
    this.seats[s] = { sessionId: client.sessionId, client, name: String(options.name ?? "").trim().slice(0, 24) || `P${s + 1}`, kind, strokes, connected: true, rtts: [] };
    console.log(`[${this.roomId}] seat ${s} joined (${kind})`);
    this.sendLobby();
  }

  async onLeave(client: Client, consented: boolean) {
    const s = this.seatOf(client);
    if (s === -1) return;
    const seat = this.seats[s]!;
    if (this.phase === "lobby") {
      this.seats[s] = null;
      this.sendLobby();
      return;
    }
    seat.connected = false;
    if (consented) {
      // left on purpose (closed the match): no seat holding
      console.log(`[${this.roomId}] seat ${s} left`);
      this.broadcast("peer", { seat: s, connected: false, gone: true });
      return;
    }
    this.broadcast("peer", { seat: s, connected: false });
    console.log(`[${this.roomId}] seat ${s} dropped (${consented ? "left" : "connection lost"}), holding the seat 60 s`);
    try {
      const back = await this.allowReconnection(client, 60);
      seat.client = back;
      seat.sessionId = back.sessionId;
      seat.connected = true;
      stats.reconnects++;
      console.log(`[${this.roomId}] seat ${s} reconnected`);
      this.broadcast("peer", { seat: s, connected: true });
      this.sendLobby();
      back.send("start", this.start);
      this.sendLog(back);
    } catch {
      console.log(`[${this.roomId}] seat ${s} gone`);
      this.broadcast("peer", { seat: s, connected: false, gone: true });
    }
  }

  onDispose() {
    usedCodes.delete(this.roomId);
    console.log(`[${this.roomId}] closed`);
  }

  private seatOf(client: Client): 0 | 1 | -1 {
    return this.seats[0]?.sessionId === client.sessionId ? 0 : this.seats[1]?.sessionId === client.sessionId ? 1 : -1;
  }

  private sendLobby() {
    const seats = this.seats.map((x): SeatInfo => (x ? { name: x.name, kind: x.kind, connected: x.connected } : null)) as [SeatInfo, SeatInfo];
    for (const [i, seat] of this.seats.entries()) seat?.client.send("lobby", { code: this.roomId, seats, you: i as 0 | 1 } satisfies LobbyMsg);
  }

  private sendLog(client: Client) {
    client.send("log", { logs: this.logs });
  }

  /** both seated and each round trip measured (3 samples) → pick the delay, fight */
  private maybeStart() {
    if (this.phase !== "lobby") return;
    const [a, b] = this.seats;
    if (!a || !b || a.rtts.length < 3 || b.rtts.length < 3) return;
    const ra = median(a.rtts);
    const rb = median(b.rtts);
    const spread = Math.max(...a.rtts, ...b.rtts) - Math.min(ra, rb);
    const delay = Math.min(MAX_DELAY, pickDelay(ra, rb, spread / 2));
    this.phase = "fight";
    this.lock();
    stats.matches++;
    this.start = { code: this.roomId, drawings: [a.strokes, b.strokes], names: [a.name, b.name], delay, physics: this.physics, rtts: [ra, rb] };
    console.log(`[${this.roomId}] fight! rtt ${ra}/${rb} ms → input delay ${delay} frames, ${this.physics} KO physics`);
    this.broadcast("start", this.start);
  }
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
}

export { ROOM_NAME };
