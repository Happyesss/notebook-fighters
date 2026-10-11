// Headless online test against a running Worker (`pnpm worker:dev`, or BASE=https://… for a deploy):
// two NetRoom clients over real WebSockets running the same OnlineSession code the browser uses.
// Full best-of-3 matches with scripted fighters:
//   A) no added latency   B) 100 ms extra round trip + ±30 ms jitter   C) a dropped socket mid-match
//   that reconnects (token)   D) a "page reload": a fresh client rebuilds from the room's input log.
//   E) the host's accept step: no fight before "accept"; "decline" closes the friend (4403) and frees
//   the seat; the next friend is accepted and the fight starts.
// In every match the host sees the friend's drawing ("ask") and accepts before the fight can start.
// Pass = both clients see the same rounds/winners, every checksum both computed matches, 0 desyncs
// (client and room). Also prints WebSocket messages per player per second (the request budget).
import WebSocket from "ws";
import { NetRoom, OnlineSession, type NotebookSim, type WsCtor } from "@nf/sim";
import type { PlayerInput } from "@nf/shared";
import { DRAWINGS, POWERED } from "../../../packages/sim/test/drawings";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const Ws = WebSocket as unknown as WsCtor;
const BATCH = process.env.BATCH ? Number(process.env.BATCH) : undefined;
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
async function until(fn: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(25);
  }
  return fn();
}

/** E: decline frees the seat (the friend is closed with 4403), the next friend is accepted and the fight starts */
async function declineScenario() {
  const sa = new OnlineSession();
  const host = await NetRoom.create(BASE, { name: "Host", strokes: POWERED.fire.strokes as never, physics: "rapier" }, Ws);
  sa.attach(host);
  codes.push(host.roomId);
  const sb = new OnlineSession();
  const guest = await NetRoom.join(BASE, host.roomId, { name: "Pest", strokes: DRAWINGS[0].strokes as never }, Ws);
  sb.attach(guest);
  let closed = 0;
  guest.onLeave((code) => (closed = code));
  check(await until(() => !!sa.ask, 5000), `E: host asked about "${sa.ask?.name}"`);
  await wait(800);
  check(!sa.start && !sb.start, "E: no fight while the host hasn't answered (both round trips already measured)");
  sa.decline();
  check(await until(() => closed !== 0, 5000) && closed === 4403, `E: decline → the friend's socket closed with ${closed} (4403)`);
  check(await until(() => !!sa.lobby && !sa.lobby.seats[1], 3000) && !sa.ask, "E: seat 1 is free again on the host's lobby");
  const sc = new OnlineSession();
  const friend = await NetRoom.join(BASE, host.roomId, { name: "Friend", strokes: DRAWINGS[0].strokes as never }, Ws);
  sc.attach(friend);
  check(friend.seat === 1 && (await until(() => sa.ask?.name === "Friend", 5000)), `E: the next friend takes seat ${friend.seat} and the host is asked again`);
  sa.accept();
  check((await until(() => !!sa.lock && !!sc.lock, 8000)) && sa.lobby?.accepted === true, `E: accepted → the fight starts on both (delay ${sa.start?.delay}f)`);
  for (const [s, r] of [[sa, host], [sb, guest], [sc, friend]] as const) {
    s.dispose();
    r.leave();
  }
}

type Player = { room: NetRoom; s: OnlineSession; brain: ReturnType<typeof bot>; ticks: number };
function wire(p: Player, room: NetRoom) {
  p.room = room;
  p.s.attach(room);
  room.onLeave(() => {
    if (p.room === room) p.s.detach();
  });
}
const codes: string[] = [];
const rates: number[] = [];
async function scenario(name: string, lag: number, jitter: number, opts: { drop?: boolean; reload?: boolean; realtime?: boolean } = {}) {
  const t0 = Date.now();
  const mk = async (strokes: unknown, code?: string): Promise<Player> => {
    const s = new OnlineSession({ lag, jitter, batch: BATCH });
    const room = code ? await NetRoom.join(BASE, code, { name: "B", strokes: strokes as never }, Ws) : await NetRoom.create(BASE, { name: "A", strokes: strokes as never, physics: "rapier" }, Ws);
    const p: Player = { room, s, brain: bot(code ? 99 : 7), ticks: 0 };
    wire(p, room);
    return p;
  };
  const a = await mk(POWERED.fire.strokes);
  const b = await mk(DRAWINGS.find((d) => d.name === "quadruped")!.strokes, a.room.roomId);
  codes.push(a.room.roomId);
  // the host is asked (with the friend's drawing) and accepts; nothing starts before that
  const asked = await until(() => !!a.s.ask, 5000);
  await wait(600);
  check(asked && !!a.s.ask?.strokes?.length && /four-legged|quadruped/.test(a.s.ask.kind) && !a.s.start && !b.s.start, `${name}: host asked about ${a.s.ask?.name} (${a.s.ask?.kind}, ${a.s.ask?.strokes?.length} strokes); no fight before accept`);
  a.s.accept();
  const players = [a, b];
  let dropped = false;
  let reloaded = false;
  let fightT0 = 0;
  // real time (16.7 ms ticks) for the message-rate scenario; otherwise a bit faster (lockstep doesn't care)
  const timer = setInterval(
    () => {
      for (const p of players) {
        if (!p.s.lock) continue;
        if (!fightT0) fightT0 = Date.now();
        p.s.tick(p.brain(p.s.sim, p.s.seat));
        p.ticks++;
      }
    },
    opts.realtime ? 1000 / 60 : 8,
  );
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    await wait(50);
    const la = a.s.lock;
    const lb = players[1].s.lock;
    if (!la || !lb) continue;
    if (opts.drop && !dropped && la.frame > 700) {
      dropped = true;
      const token = b.room.reconnectionToken;
      b.room.drop();
      await wait(1500);
      check(!a.s.peer.connected, `${name}: A sees B drop (A stalls at frame ${la.frame}, stalls ${la.stalls})`);
      wire(b, await NetRoom.join(BASE, a.room.roomId, { token }, Ws));
    }
    if (opts.reload && !reloaded && la.frame > 900) {
      reloaded = true;
      const token = b.room.reconnectionToken;
      const seat = b.s.seat;
      b.room.drop();
      b.s.dispose();
      await wait(800);
      // a brand-new client (as after F5): no sim, rebuilds from the room's logs
      const fresh: Player = { room: b.room, s: new OnlineSession({ lag, jitter, batch: BATCH }), brain: bot(1234), ticks: 0 };
      fresh.s.expectRebuild(seat);
      wire(fresh, await NetRoom.join(BASE, a.room.roomId, { token }, Ws));
      players[1] = fresh;
    }
    if (la.matches >= 1 && (players[1].s.lock?.matches ?? 0) >= 1) break;
  }
  clearInterval(timer);
  const secs = (Date.now() - fightT0) / 1000;
  await wait(400 + lag + jitter * 2);
  const A = a.s.lock!;
  const B = players[1].s.lock!;
  const fmt = (l: typeof A) => l.results.slice(0, 3).map((r) => `R${r.round}:${r.winner === null ? "draw" : "P" + (r.winner + 1)}@${r.frame}`).join(" ");
  const common = [...A.sums.keys()].filter((f) => B.sums.has(f));
  const same = common.every((f) => A.sums.get(f) === B.sums.get(f));
  check(A.matches >= 1 && B.matches >= 1, `${name}: full best-of-3 played on both (A frame ${A.frame}, B frame ${B.frame}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check(fmt(A) === fmt(B) && A.results.length >= 2, `${name}: same rounds on both — A: ${fmt(A)} | B: ${fmt(B)}`);
  check(same && common.length > 20, `${name}: ${common.length} shared checksums identical`);
  check(!A.desyncs.length && !B.desyncs.length && !a.s.serverDesyncs.length, `${name}: 0 desyncs (client-side ${A.desyncs.length}/${B.desyncs.length}, room ${a.s.serverDesyncs.length})`);
  const rate = a.s.sentMsgs / secs;
  if (opts.realtime) rates.push(rate);
  console.log(
    `     delay ${a.s.start?.delay}f · rtt A ${a.s.rtt} ms B ${players[1].s.rtt} ms · stalls A ${A.stalls} B ${B.stalls}${players[1].s.fastForwarded ? ` · B fast-forwarded ${players[1].s.fastForwarded} frames` : ""}` +
      ` · A sent ${a.s.sentMsgs} WS messages (${a.s.inputMsgs} with inputs) for ${A.frame} frames → ${((A.frame / Math.max(1, a.s.inputMsgs)) || 0).toFixed(2)} frames/message${opts.realtime ? `, ${rate.toFixed(1)} msg/s` : ""}`,
  );
  for (const p of players) {
    p.s.dispose();
    p.room.leave();
  }
  return { A, B };
}
const only = process.env.ONLY?.split(",");
const run = (k: string) => !only || only.includes(k);
const health = (await (await fetch(`${BASE}/api/health`)).json()) as { ok: boolean };
check(health.ok === true, `GET /api/health → ${JSON.stringify(health)}`);
if (run("A")) await scenario("A no lag (real time)", 0, 0, { realtime: true });
if (run("B")) await scenario("B lag 100+jitter 30 (real time)", 100, 30, { realtime: true });
if (run("C")) await scenario("C drop+reconnect", 40, 10, { drop: true });
if (run("D")) await scenario("D reload+fast-forward", 40, 10, { reload: true });
if (run("E")) await declineScenario();
await wait(500);
for (const code of codes) {
  const info = (await (await fetch(`${BASE}/api/rooms/${code}`)).json()) as Record<string, unknown>;
  check(!info.exists || info.desyncs === 0, `room ${code}: ${JSON.stringify(info)}`);
}
console.log(bad ? `${bad} FAIL` : "ONLINE OK");
process.exit(bad);
