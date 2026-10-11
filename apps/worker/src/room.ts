/**
 * Room: one online 1v1, one Durable Object per room code (idFromName(code)).
 *
 * The fight is deterministic lockstep on the two clients, so the room only:
 *  · seats two players and holds their drawings (authoritative for the lobby → fight phase),
 *  · lets the host (seat 0) accept or decline the friend who sat down (the fight waits for "accept";
 *    "decline" closes the friend's socket with 4403 and frees the seat for someone else),
 *  · collects each client's measured round trip and picks the input delay,
 *  · relays input frames and keeps the full input log of both seats (a reconnecting or reloaded
 *    client fast-forwards from it),
 *  · compares the clients' checksums and flags a desync,
 *  · holds a dropped player's seat for 60 s (an alarm frees it).
 *
 * WebSocket Hibernation API: sockets are accepted with ctx.acceptWebSocket, the seat rides on the
 * socket (serializeAttachment), there are no timers — only alarms — and the keepalive "ping" text is
 * answered by the runtime, so a room waiting for a friend costs no duration. Storage (SQLite backend)
 * holds only what a reconnect needs: the room meta (seats, drawings, start message) and, whenever a
 * player drops, the input logs.
 */
import { DurableObject } from "cloudflare:workers";
import { inferRig } from "@nf/sim/rig";
import {
  CLOSE,
  MAX_DELAY,
  SEAT_HOLD_MS,
  pickDelay,
  type InkStroke,
  type AskMsg,
  type JoinMsg,
  type LobbyMsg,
  type SeatInfo,
  type StartMsg,
  type WelcomeMsg,
} from "@nf/shared";

type SeatNo = 0 | 1;
type Seat = {
  name: string;
  kind: string;
  strokes: InkStroke[] | null;
  token: string;
  /** id of the socket currently holding the seat */
  cid: string;
  connected: boolean;
  gone: boolean;
  heldUntil: number;
  rtts: number[];
};
type Stats = { inputs: number; checksums: number; desyncs: number; reconnects: number; messages: number };
type Meta = {
  code: string;
  physics: "rapier" | "classic";
  phase: "lobby" | "fight";
  /** the host accepted the friend in seat 1 (reset whenever a lobby seat changes) */
  accepted?: boolean;
  start: StartMsg | null;
  seats: [Seat | null, Seat | null];
  stats: Stats;
  createdAt: number;
  /** when the room last had nobody connected (0 = someone is here) */
  idleSince: number;
};
type Attachment = { cid: string; seat: SeatNo | -1 };

/** a room nobody is connected to is deleted after this long */
const IDLE_MS = 10 * 60_000;
const MAX_STROKES = 400;

export class Room extends DurableObject {
  private meta: Meta | null = null;
  private logs: [number[], number[]] = [[], []];
  private sums: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
  /** socket id → socket (rebuilt from ctx.getWebSockets() after hibernation) */
  private sockets = new Map<string, WebSocket>();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    // keepalive answered by the runtime itself: doesn't wake the room or count as a message
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    void ctx.blockConcurrencyWhile(async () => {
      const got = await ctx.storage.get<unknown>(["meta", "log0", "log1"]);
      this.meta = (got.get("meta") as Meta | undefined) ?? null;
      this.logs = [toArr(got.get("log0")), toArr(got.get("log1"))];
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (a) this.sockets.set(a.cid, ws);
      }
    });
  }

  // ---- RPC from the Worker -------------------------------------------------------------------

  /** take this code for a new room; false if it's already in use */
  async claim(code: string, physics: "rapier" | "classic"): Promise<boolean> {
    if (this.meta) return false;
    const now = Date.now();
    this.meta = {
      code,
      physics,
      phase: "lobby",
      accepted: false,
      start: null,
      seats: [null, null],
      stats: { inputs: 0, checksums: 0, desyncs: 0, reconnects: 0, messages: 0 },
      createdAt: now,
      idleSince: now,
    };
    this.logs = [[], []];
    await this.save();
    await this.ctx.storage.setAlarm(now + IDLE_MS);
    return true;
  }

  async info() {
    const m = this.meta;
    if (!m) return { exists: false };
    return {
      exists: true,
      code: m.code,
      phase: m.phase,
      physics: m.physics,
      delay: m.start?.delay ?? null,
      accepted: !!m.accepted,
      seats: m.seats.map((s) => (s ? { name: s.name, kind: s.kind, connected: s.connected, gone: s.gone } : null)),
      frames: [this.logs[0].length, this.logs[1].length],
      ...m.stats,
    };
  }

  /** the WebSocket upgrade (the Worker already checked the header and the code) */
  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const cid = crypto.randomUUID();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ cid, seat: -1 } satisfies Attachment);
    this.sockets.set(cid, server);
    if (!this.meta) this.reject(server, CLOSE.notFound, "no such room");
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- hibernatable WebSocket handlers -------------------------------------------------------

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || !this.meta) return;
    let list: unknown;
    try {
      list = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    this.meta.stats.messages++;
    const att = ws.deserializeAttachment() as Attachment;
    for (const item of list.slice(0, 16)) {
      if (!Array.isArray(item) || typeof item[0] !== "string") continue;
      await this.handle(ws, att, item[0], item[1] ?? {});
      if (!this.meta) return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    await this.closed(ws, code);
  }

  async webSocketError(ws: WebSocket) {
    await this.closed(ws, 1006);
  }

  async alarm() {
    const m = this.meta;
    if (!m) return;
    const now = Date.now();
    let next = Infinity;
    if (m.phase === "fight") {
      m.seats.forEach((seat, s) => {
        if (!seat || seat.connected || seat.gone || !seat.heldUntil) return;
        if (seat.heldUntil <= now + 50) {
          seat.gone = true;
          console.log(`[${m.code}] seat ${s} gone (held 60 s)`);
          this.broadcast("peer", { seat: s, connected: false, gone: true });
        } else next = Math.min(next, seat.heldUntil);
      });
    }
    if (!m.seats.some((x) => x?.connected)) {
      const over = m.phase === "fight" && m.seats.every((x) => !x || x.gone);
      if (over || (m.idleSince && now - m.idleSince >= IDLE_MS - 1000)) return this.wipe();
      next = Math.min(next, (m.idleSince || now) + IDLE_MS);
    }
    await this.save();
    if (next < Infinity) await this.ctx.storage.setAlarm(next);
  }

  // ---- protocol ------------------------------------------------------------------------------

  private async handle(ws: WebSocket, att: Attachment, type: string, msg: any) {
    const m = this.meta!;
    if (type === "join") return this.join(ws, att, msg as JoinMsg);
    const s = att.seat;
    if (s === -1) return;
    const seat = m.seats[s];
    if (!seat || seat.cid !== att.cid) return;

    switch (type) {
      case "i": {
        if (m.phase !== "fight" || !Array.isArray(msg?.b) || !Number.isInteger(msg.f) || msg.f < 0) return;
        const log = this.logs[s];
        // frames are final once logged: only append (redundant copies of old frames are ignored)
        const first = log.length;
        const b = msg.b as unknown[];
        for (let k = 0; k < b.length && k < 1200; k++) if (msg.f + k === log.length) log.push(Number(b[k]) & 255);
        if (log.length === first) return;
        m.stats.inputs += log.length - first;
        // relay exactly the new frames (the socket is reliable and ordered)
        this.sendTo((1 - s) as SeatNo, "i", { s, f: first, b: log.slice(first) });
        return;
      }
      case "c": {
        if (!Number.isInteger(msg?.f) || typeof msg?.h !== "number") return;
        m.stats.checksums++;
        this.sums[s].set(msg.f, msg.h);
        const theirs = this.sums[1 - s].get(msg.f);
        this.sendTo((1 - s) as SeatNo, "c", { s, f: msg.f, h: msg.h });
        if (theirs !== undefined && theirs !== msg.h) {
          m.stats.desyncs++;
          const h: [number, number] = s === 0 ? [msg.h, theirs] : [theirs, msg.h];
          console.warn(`[${m.code}] DESYNC at frame ${msg.f}: ${h.map((x) => x.toString(16)).join(" vs ")}`);
          this.broadcast("desync", { f: msg.f, h });
        }
        if (this.sums[s].size > 400) this.sums[s].delete(this.sums[s].keys().next().value!);
        return;
      }
      case "ping": {
        this.send(ws, "pong", { t: msg?.t });
        // in the lobby each client reports its last measured round trip → the input delay
        if (m.phase === "lobby" && typeof msg?.r === "number" && msg.r >= 0) {
          seat.rtts.push(Math.min(2000, Math.round(msg.r)));
          if (seat.rtts.length > 10) seat.rtts.shift();
          this.broadcast("rtt", { r: m.seats.map((x) => (x ? median(x.rtts) : 0)) });
          await this.maybeStart();
        }
        return;
      }
      case "resync":
        return this.send(ws, "log", { logs: this.logs });
      case "accept": {
        // only the host, only in the lobby, only with a friend seated
        if (s !== 0 || m.phase !== "lobby" || !m.seats[1] || m.accepted) return;
        m.accepted = true;
        console.log(`[${m.code}] host accepted ${m.seats[1].name}`);
        await this.save();
        this.sendLobby();
        return this.maybeStart();
      }
      case "decline": {
        const guest = m.seats[1];
        if (s !== 0 || m.phase !== "lobby" || !guest) return;
        m.seats[1] = null;
        m.accepted = false;
        const gws = this.sockets.get(guest.cid);
        if (gws) {
          // the socket no longer speaks for the seat, so its close is a no-op in closed()
          gws.serializeAttachment({ cid: guest.cid, seat: -1 } satisfies Attachment);
          this.sockets.delete(guest.cid);
          this.reject(gws, CLOSE.declined, "the host declined");
        }
        console.log(`[${m.code}] host declined ${guest.name}; seat 1 is free again`);
        await this.save();
        this.sendLobby();
        return;
      }
      case "leave":
        try {
          ws.close(CLOSE.left, "left");
        } catch {
          // already closing
        }
        return this.closed(ws, CLOSE.left);
    }
  }

  private async join(ws: WebSocket, att: Attachment, msg: JoinMsg) {
    const m = this.meta!;
    if (att.seat !== -1) return;
    // a returning player (dropped socket, page reload): the token takes the seat back
    if (typeof msg?.token === "string" && msg.token) {
      const s = m.seats.findIndex((x) => x?.token === msg.token);
      if (s !== -1) {
        const seat = m.seats[s]!;
        if (seat.gone) return this.reject(ws, CLOSE.expired, "seat expired");
        const old = this.sockets.get(seat.cid);
        if (old && old !== ws) {
          this.sockets.delete(seat.cid);
          this.reject(old, CLOSE.replaced, "seat taken over");
        }
        const wasDown = !seat.connected;
        seat.cid = att.cid;
        seat.connected = true;
        seat.heldUntil = 0;
        m.idleSince = 0;
        ws.serializeAttachment({ cid: att.cid, seat: s as SeatNo } satisfies Attachment);
        if (m.phase === "fight") m.stats.reconnects++;
        console.log(`[${m.code}] seat ${s} back${wasDown ? "" : " (replaced its socket)"}`);
        await this.save();
        this.send(ws, "welcome", { code: m.code, seat: s as SeatNo, token: seat.token, rejoined: true } satisfies WelcomeMsg);
        this.broadcast("peer", { seat: s, connected: true });
        this.sendLobby();
        if (s === 0) this.askHost();
        if (m.start) {
          this.send(ws, "start", m.start);
          this.send(ws, "log", { logs: this.logs });
        }
        return;
      }
      if (m.phase !== "lobby") return this.reject(ws, CLOSE.expired, "seat expired");
    }
    if (m.phase !== "lobby") return this.reject(ws, CLOSE.full, "the match already started");
    const s: SeatNo | -1 = !m.seats[0] ? 0 : !m.seats[1] ? 1 : -1;
    if (s === -1) return this.reject(ws, CLOSE.full, "room full");
    const strokes = Array.isArray(msg?.strokes) && msg.strokes.length ? msg.strokes.slice(0, MAX_STROKES) : null;
    let kind = "sketch fighter";
    try {
      if (strokes) kind = inferRig(strokes)?.kind ?? kind;
    } catch {
      // unreadable drawing: the sketch
    }
    const name = String(msg?.name ?? "").trim().slice(0, 24) || `P${s + 1}`;
    m.seats[s] = { name, kind, strokes, token: crypto.randomUUID(), cid: att.cid, connected: true, gone: false, heldUntil: 0, rtts: [] };
    m.idleSince = 0;
    ws.serializeAttachment({ cid: att.cid, seat: s } satisfies Attachment);
    console.log(`[${m.code}] seat ${s} joined (${kind})`);
    await this.save();
    this.send(ws, "welcome", { code: m.code, seat: s, token: m.seats[s]!.token, rejoined: false } satisfies WelcomeMsg);
    this.sendLobby();
    this.askHost();
  }

  /** both seats taken in the lobby and not yet accepted: show the host who wants to play (with the drawing) */
  private askHost() {
    const m = this.meta!;
    const guest = m.seats[1];
    if (m.phase !== "lobby" || !m.seats[0] || !guest || m.accepted) return;
    this.sendTo(0, "ask", { name: guest.name, kind: guest.kind, strokes: guest.strokes } satisfies AskMsg);
  }

  /** both seated, the host accepted, and each round trip measured (3 samples) → pick the delay, fight */
  private async maybeStart() {
    const m = this.meta!;
    if (m.phase !== "lobby" || !m.accepted) return;
    const [a, b] = m.seats;
    if (!a || !b || a.rtts.length < 3 || b.rtts.length < 3) return;
    const ra = median(a.rtts);
    const rb = median(b.rtts);
    const spread = Math.max(...a.rtts, ...b.rtts) - Math.min(ra, rb);
    const delay = Math.min(MAX_DELAY, pickDelay(ra, rb, spread / 2));
    m.phase = "fight";
    m.start = { code: m.code, drawings: [a.strokes, b.strokes], names: [a.name, b.name], delay, physics: m.physics, rtts: [ra, rb] };
    this.logs = [[], []];
    console.log(`[${m.code}] fight! rtt ${ra}/${rb} ms → input delay ${delay} frames, ${m.physics} KO physics`);
    await this.save();
    this.broadcast("start", m.start);
  }

  private async closed(ws: WebSocket, code: number) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    if (this.sockets.get(att.cid) === ws) this.sockets.delete(att.cid);
    try {
      ws.close(1000, "bye");
    } catch {
      // already closed
    }
    const m = this.meta;
    if (!m || att.seat === -1) return;
    const s = att.seat;
    const seat = m.seats[s];
    // a socket that was replaced by a newer one (reload) no longer speaks for the seat
    if (!seat || seat.cid !== att.cid || !seat.connected) return;
    ws.serializeAttachment({ cid: att.cid, seat: -1 } satisfies Attachment);
    const now = Date.now();
    if (m.phase === "lobby") {
      m.seats[s] = null;
      // a new pairing needs a new "accept"
      m.accepted = false;
      console.log(`[${m.code}] seat ${s} left the lobby`);
      this.sendLobby();
    } else {
      seat.connected = false;
      if (code === CLOSE.left) {
        seat.gone = true;
        console.log(`[${m.code}] seat ${s} left`);
        this.broadcast("peer", { seat: s, connected: false, gone: true });
      } else {
        seat.heldUntil = now + SEAT_HOLD_MS;
        console.log(`[${m.code}] seat ${s} dropped (${code}), holding the seat 60 s`);
        this.broadcast("peer", { seat: s, connected: false });
        // the only time the logs are written: a reconnect may come after the room hibernated
        await this.ctx.storage.put({ log0: Uint8Array.from(this.logs[0]), log1: Uint8Array.from(this.logs[1]) });
      }
    }
    if (!m.seats.some((x) => x?.connected)) {
      if (m.phase === "fight" && m.seats.every((x) => !x || x.gone)) return this.wipe();
      m.idleSince = now;
    }
    await this.save();
    const holds = m.seats.filter((x): x is Seat => !!x && !x.connected && !x.gone && x.heldUntil > 0).map((x) => x.heldUntil);
    const next = Math.min(...holds, m.idleSince ? m.idleSince + IDLE_MS : Infinity);
    if (next < Infinity) await this.ctx.storage.setAlarm(next);
  }

  // ---- helpers -------------------------------------------------------------------------------

  private async save() {
    if (this.meta) await this.ctx.storage.put("meta", this.meta);
  }

  /** the match is over or the room was abandoned: forget everything (the code becomes free again) */
  private async wipe() {
    console.log(`[${this.meta?.code}] closed`);
    for (const ws of this.sockets.values()) this.reject(ws, CLOSE.left, "room closed");
    this.sockets.clear();
    this.meta = null;
    this.logs = [[], []];
    this.sums = [new Map(), new Map()];
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private reject(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  private send(ws: WebSocket, type: string, msg: unknown) {
    try {
      ws.send(JSON.stringify([[type, msg]]));
    } catch {
      // closing: the reconnect resends
    }
  }

  private sendTo(s: SeatNo, type: string, msg: unknown) {
    const seat = this.meta?.seats[s];
    if (!seat?.connected) return;
    const ws = this.sockets.get(seat.cid);
    if (ws) this.send(ws, type, msg);
  }

  private broadcast(type: string, msg: unknown) {
    this.sendTo(0, type, msg);
    this.sendTo(1, type, msg);
  }

  private sendLobby() {
    const m = this.meta!;
    const seats = m.seats.map((x): SeatInfo => (x ? { name: x.name, kind: x.kind, connected: x.connected } : null)) as [SeatInfo, SeatInfo];
    for (const s of [0, 1] as const) this.sendTo(s, "lobby", { code: m.code, seats, you: s, accepted: !!m.accepted } satisfies LobbyMsg);
  }
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((p, q) => p - q);
  return s[Math.floor(s.length / 2)];
}

function toArr(v: unknown): number[] {
  if (v instanceof Uint8Array) return Array.from(v);
  if (Array.isArray(v)) return v as number[];
  return [];
}
