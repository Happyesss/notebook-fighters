// Play nearby with no server: the host's device runs the room (HostRoom), the friend talks to it over
// a Pipe (a WebRTC data channel in the browser; an in-memory pair here). Same OnlineSession and
// Lockstep code as online rooms.
//   A) no lag  B) 50 ms each way (100 ms round trip)  C) decline closes the friend's link
//   D) the link drops mid-match: the host sees the friend gone, the friend's room reports the close
// Pass = full best-of-3 on both, same rounds/winners, identical checksums, 0 desyncs.
import { HostRoom, OnlineSession, PipeRoom, pipePair, type NotebookSim } from "../src/index";
import type { PlayerInput } from "@nf/shared";
import { DRAWINGS, POWERED } from "./drawings";

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
    const toward = sim.fighters[1 - me].x > sim.fighters[me].x ? 1 : -1;
    const v = r();
    return { ...IDLE, x: v < 0.55 ? toward : v < 0.62 ? -toward : 0, punch: r() < 0.12, kick: r() < 0.08, jump: r() < 0.01, block: r() < 0.01, special: r() < 0.02 };
  };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(20);
  }
  return fn();
}
const host = POWERED.fire.strokes as never;
const friend = DRAWINGS.find((d) => d.name === "quadruped")!.strokes as never;

async function pair(oneWay: number) {
  const [hp, gp] = pipePair(oneWay);
  const room = new HostRoom({ name: "Host", strokes: host, physics: "rapier" });
  const a = new OnlineSession();
  a.attach(room.host);
  room.attachGuest(hp);
  const b = new OnlineSession();
  const guest = await PipeRoom.join(gp, { name: "Friend", strokes: friend });
  b.attach(guest);
  return { room, a, b, guest, hp, gp };
}

async function match(name: string, oneWay: number, drop = false) {
  const { room, a, b, guest, gp } = await pair(oneWay);
  let left = 0;
  guest.onLeave((code) => {
    left = code || 1;
    b.detach();
  });
  check(await until(() => !!a.ask, 3000), `${name}: host asked about ${a.ask?.name} (${a.ask?.kind}, ${a.ask?.strokes?.length} strokes)`);
  await wait(500);
  check(!a.start && !b.start && b.lobby?.you === 1 && b.lobby.accepted === false, `${name}: no fight before the host accepts; friend waits in seat ${b.lobby?.you}`);
  a.accept();
  check(await until(() => !!a.lock && !!b.lock, 5000), `${name}: accepted → fight on both, delay ${a.start?.delay}f, friend rtt ${a.start?.rtts[1]} ms`);
  const ba = bot(7);
  const bb = bot(99);
  const timer = setInterval(() => {
    if (a.lock) a.tick(ba(a.sim, a.seat));
    if (b.lock && b.connected) b.tick(bb(b.sim, b.seat));
  }, 8);
  const deadline = Date.now() + 240_000;
  let dropped = false;
  while (Date.now() < deadline) {
    await wait(50);
    if (drop && !dropped && (a.lock?.frame ?? 0) > 600) {
      dropped = true;
      gp.close();
      check(await until(() => a.peer.gone && left !== 0, 2000), `${name}: link dropped at frame ${a.lock?.frame} → host sees "${a.peer.gone ? "friend gone" : "?"}", friend's room closed (${left})`);
      break;
    }
    if ((a.lock?.matches ?? 0) >= 1 && (b.lock?.matches ?? 0) >= 1) break;
  }
  clearInterval(timer);
  if (!drop) {
    await wait(300 + oneWay * 2);
    const A = a.lock!;
    const B = b.lock!;
    const fmt = (l: typeof A) => l.results.slice(0, 3).map((r) => `R${r.round}:${r.winner === null ? "draw" : "P" + (r.winner + 1)}@${r.frame}`).join(" ");
    const common = [...A.sums.keys()].filter((f) => B.sums.has(f));
    check(A.matches >= 1 && B.matches >= 1, `${name}: full best-of-3 on both (frames ${A.frame} / ${B.frame})`);
    check(fmt(A) === fmt(B) && A.results.length >= 2, `${name}: same rounds — host: ${fmt(A)} | friend: ${fmt(B)}`);
    check(common.length > 20 && common.every((f) => A.sums.get(f) === B.sums.get(f)), `${name}: ${common.length} shared checksums identical`);
    check(!A.desyncs.length && !B.desyncs.length && !a.serverDesyncs.length && room.stats.desyncs === 0, `${name}: 0 desyncs (${A.desyncs.length}/${B.desyncs.length}, room ${room.stats.desyncs}); ${room.stats.checksums} checksums compared`);
    check(a.rtt >= oneWay * 2 - 5 && b.rtt >= oneWay * 2 - 5, `${name}: ping shown — host ${a.rtt} ms, friend ${b.rtt} ms`);
    console.log(`     stalls host ${A.stalls} friend ${B.stalls} · friend sent ${guest.sent} messages`);
  }
  a.dispose();
  b.dispose();
  room.close();
}

async function decline() {
  const { room, a, b, guest } = await pair(5);
  let closed = 0;
  guest.onLeave((code) => (closed = code));
  check(await until(() => !!a.ask, 3000), "C: host asked");
  a.decline();
  check(await until(() => closed !== 0, 2000) && closed === 4403, `C: decline → the friend's link closed with ${closed} (4403)`);
  check(await until(() => !!a.lobby && !a.lobby.seats[1], 1000) && !a.ask, "C: the host's seat 1 is empty again");
  // the host's room takes a new friend over a new link
  const [hp2, gp2] = pipePair(5);
  room.attachGuest(hp2);
  const c = new OnlineSession();
  c.attach(await PipeRoom.join(gp2, { name: "Next", strokes: friend }));
  check(await until(() => a.ask?.name === "Next", 2000), "C: a new link → the host is asked about the next friend");
  a.accept();
  check(await until(() => !!a.lock && !!c.lock, 5000), "C: accepted → fight starts");
  for (const s of [a, b, c]) s.dispose();
  room.close();
}

await match("A no lag", 0);
await match("B 100 ms round trip", 50);
await decline();
await match("D link drops", 10, true);
console.log(bad ? `${bad} FAIL` : "NEARBY OK");
process.exit(bad);
