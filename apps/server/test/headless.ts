// Headless online test: a real Colyseus server (in-process) and two colyseus.js clients running the
// same OnlineSession code the browser uses. Full best-of-3 matches with scripted fighters:
//   A) no added latency   B) 100 ms extra round trip + ±30 ms jitter   C) a dropped socket mid-match
//   that reconnects (token)   D) a "page reload": a fresh client rebuilds from the server's input log.
// Pass = both clients see the same rounds/winners, every checksum both computed matches, 0 desyncs.
import http from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client, type Room } from "colyseus.js";
import { OnlineSession, inferRig, type NotebookSim } from "@nf/sim";
import { ROOM_NAME, type PlayerInput } from "@nf/shared";
import { DRAWINGS, POWERED } from "../../../packages/sim/test/drawings";
import { DuelRoom, stats } from "../src/room";

const PORT = 2599;
const httpServer = http.createServer();
const server = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
server.define(ROOM_NAME, DuelRoom);
await server.listen(PORT);
const URL = `ws://localhost:${PORT}`;
let bad = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) bad++;
};
const IDLE: PlayerInput = { x: 0, punch: false, kick: false, jump: false, block: false, crouch: false, special: false };
function bot(seed: number) {
  let s = seed;
  const r = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
  return (sim: NotebookSim | null, me: 0 | 1): PlayerInput => {
    if (!sim) return IDLE;
    const self = sim.fighters[me];
    const foe = sim.fighters[1 - me];
    const toward = foe.x > self.x ? 1 : -1;
    const v = r();
    return { ...IDLE, x: v < 0.55 ? toward : v < 0.62 ? -toward : 0, punch: r() < 0.12, kick: r() < 0.08, jump: r() < 0.01, block: r() < 0.01, special: r() < 0.02 };
  };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Player = { client: Client; room: Room; s: OnlineSession; brain: ReturnType<typeof bot>; ticks: number };
function wire(p: Player, room: Room) {
  p.room = room;
  p.s.attach(room);
  room.onLeave(() => p.s.detach());
}
async function scenario(name: string, lag: number, jitter: number, opts: { drop?: boolean; reload?: boolean } = {}) {
  const t0 = Date.now();
  const mk = async (strokes: unknown, code?: string): Promise<Player> => {
    const client = new Client(URL);
    const s = new OnlineSession({ lag, jitter });
    const room = code ? await client.joinById(code, { name: "B", strokes }) : await client.create(ROOM_NAME, { name: "A", strokes, physics: "rapier" });
    const p: Player = { client, room, s, brain: bot(code ? 99 : 7), ticks: 0 };
    wire(p, room);
    return p;
  };
  const a = await mk(POWERED.fire.strokes);
  const b = await mk(DRAWINGS.find((d) => d.name === "quadruped")!.strokes, a.room.roomId);
  const players = [a, b];
  let dropped = false;
  let reloaded = false;
  // 60 Hz-ish ticks (a bit faster than real time so the test is quick; lockstep doesn't care)
  const timer = setInterval(() => {
    for (const p of players) {
      const lock = p.s.lock;
      if (!lock) continue;
      p.s.tick(p.brain(p.s.sim, p.s.seat));
      p.ticks++;
    }
  }, 8);
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await wait(50);
    const la = a.s.lock;
    const lb = players[1].s.lock;
    if (!la || !lb) continue;
    if (opts.drop && !dropped && la.frame > 700) {
      dropped = true;
      // pull B's cable: the socket closes without a "leave" → server holds the seat
      const token = b.room.reconnectionToken;
      (b.room.connection as unknown as { close(): void }).close();
      await wait(1500);
      check(!a.s.peer.connected, `${name}: A sees B drop (A stalls at frame ${la.frame}, stalls ${la.stalls})`);
      const room = await b.client.reconnect(token);
      wire(b, room);
    }
    if (opts.reload && !reloaded && la.frame > 900) {
      reloaded = true;
      const token = b.room.reconnectionToken;
      const seat = b.s.seat;
      (b.room.connection as unknown as { close(): void }).close();
      b.s.dispose();
      await wait(800);
      // a brand-new client (as after F5): no sim, rebuilds from the server's logs
      const fresh: Player = { client: new Client(URL), room: b.room, s: new OnlineSession({ lag, jitter }), brain: bot(1234), ticks: 0 };
      fresh.s.expectRebuild(seat);
      const room = await fresh.client.reconnect(token);
      wire(fresh, room);
      players[1] = fresh;
    }
    if (la.matches >= 1 && (players[1].s.lock?.matches ?? 0) >= 1) break;
  }
  clearInterval(timer);
  await wait(400 + lag + jitter * 2);
  const A = a.s.lock!;
  const B = players[1].s.lock!;
  const fmt = (l: typeof A) => l.results.slice(0, 3).map((r) => `R${r.round}:${r.winner === null ? "draw" : "P" + (r.winner + 1)}@${r.frame}`).join(" ");
  const common = [...A.sums.keys()].filter((f) => B.sums.has(f));
  const same = common.every((f) => A.sums.get(f) === B.sums.get(f));
  check(A.matches >= 1 && B.matches >= 1, `${name}: full best-of-3 played on both (A frame ${A.frame}, B frame ${B.frame}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check(fmt(A) === fmt(B) && A.results.length >= 2, `${name}: same rounds on both — A: ${fmt(A)} | B: ${fmt(B)}`);
  check(same && common.length > 20, `${name}: ${common.length} shared checksums identical`);
  check(!A.desyncs.length && !B.desyncs.length && !a.s.serverDesyncs.length, `${name}: 0 desyncs (client-side ${A.desyncs.length}/${B.desyncs.length}, server ${a.s.serverDesyncs.length})`);
  console.log(`     delay ${a.s.start?.delay}f · rtt A ${a.s.rtt} ms B ${players[1].s.rtt} ms · stalls A ${A.stalls} B ${B.stalls}${players[1].s.fastForwarded ? ` · B fast-forwarded ${players[1].s.fastForwarded} frames` : ""}`);
  for (const p of players) {
    p.s.dispose();
    await p.room.leave(true).catch(() => {});
  }
  return { A, B };
}
void inferRig;
const only = process.env.ONLY?.split(",");
const run = (k: string) => !only || only.includes(k);
if (run("A")) await scenario("A no lag", 0, 0);
if (run("B")) await scenario("B lag 100+jitter 30", 100, 30);
if (run("C")) await scenario("C drop+reconnect", 40, 10, { drop: true });
if (run("D")) await scenario("D reload+fast-forward", 40, 10, { reload: true });
check(stats.desyncs === 0, `server saw ${stats.checksums} checksums, ${stats.desyncs} desyncs, ${stats.reconnects} reconnects, ${stats.inputs} input frames`);
console.log(bad ? `${bad} FAIL` : "ONLINE OK");
await server.gracefullyShutdown(false).catch(() => {});
process.exit(bad);
