/**
 * Online 1v1 protocol (plan §10): one Cloudflare Durable Object per 6-char room code, native
 * WebSocket, deterministic lockstep with input delay. The room is authoritative for the phase and
 * the two drawings; it relays inputs, keeps a full input log per seat (for reconnects) and
 * compares checksums.
 *
 * Wire format, both directions: one JSON array of [type, payload] pairs per WebSocket message, so
 * several messages (an input batch + a checksum + a ping) cost one billed request. The bare text
 * "ping" is answered with "pong" by the runtime itself (keepalive; never wakes the room).
 *
 *   client → room   join {name, strokes, token?} · i {f, b[]} · c {f, h} · ping {t, r?} · resync · leave
 *   room → client   welcome {code, seat, token} · lobby · rtt {r} · start · i {s, f, b[]} · c {s, f, h}
 *                   · desync {f, h} · peer {seat, connected, gone?} · log {logs} · pong {t}
 *   close codes     4000 left on purpose · 4001 seat taken over by a newer connection
 *                   · 4404 no such room · 4409 room full / already fighting · 4410 seat expired
 */
import type { InkStroke, PlayerInput } from "./index";

export const ROOM_NAME = "duel";
/** `wrangler dev` default port (local online play) */
export const DEFAULT_SERVER_PORT = 8787;
/** a dropped player's seat is held this long (ms) */
export const SEAT_HOLD_MS = 60_000;
/** an input message carries at most this many new frames (sent earlier when the peer would need them) */
export const MAX_INPUT_BATCH = 4;
export const CLOSE = { left: 4000, replaced: 4001, notFound: 4404, full: 4409, expired: 4410 } as const;
/** inputs are sent with the last few frames again (cheap insurance, plan §10) */
export const REDUNDANCY = 8;
/** clients report a checksum every this many frames */
export const CHECKSUM_EVERY = 60;
/** frames a finished round lingers before the next starts (both clients count the same frames) */
export const ROUND_GAP_FRAMES = 180;
export const MATCH_GAP_FRAMES = 300;
export const MIN_DELAY = 3;
export const MAX_DELAY = 12;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}
export const isRoomCode = (s: string) => /^[A-Z2-9]{6}$/.test(s);

/**
 * input delay (frames) from the two players' round trips to the server: an input travels
 * A → server → B, about (rttA + rttB) / 2, plus a margin for jitter.
 */
export function pickDelay(rttA: number, rttB: number, jitter = 0): number {
  const oneWay = (rttA + rttB) / 2 + Math.max(16, jitter * 2);
  return Math.max(MIN_DELAY, Math.min(MAX_DELAY, Math.ceil(oneWay / (1000 / 60)) + 1));
}

/** PlayerInput ⇄ one byte: bit0 left, bit1 right, 2 punch, 3 kick, 4 jump, 5 block, 6 crouch, 7 special */
export function packInput(i: PlayerInput): number {
  return (i.x < 0 ? 1 : 0) | (i.x > 0 ? 2 : 0) | (i.punch ? 4 : 0) | (i.kick ? 8 : 0) | (i.jump ? 16 : 0) | (i.block ? 32 : 0) | (i.crouch ? 64 : 0) | (i.special ? 128 : 0);
}
export function unpackInput(b: number): PlayerInput {
  return { x: (b & 2 ? 1 : 0) - (b & 1 ? 1 : 0), punch: !!(b & 4), kick: !!(b & 8), jump: !!(b & 16), block: !!(b & 32), crouch: !!(b & 64), special: !!(b & 128) };
}

export type SeatInfo = { name: string; kind: string; connected: boolean } | null;
export type JoinOptions = { name?: string; strokes?: InkStroke[] | null; physics?: "rapier" | "classic" };
/** client → room, first message on a socket; a `token` from an earlier welcome takes that seat back */
export type JoinMsg = { name?: string; strokes?: InkStroke[] | null; token?: string };
export type WelcomeMsg = { code: string; seat: 0 | 1; token: string; rejoined: boolean };
/** server → client */
export type LobbyMsg = { code: string; seats: [SeatInfo, SeatInfo]; you: 0 | 1 };
export type StartMsg = { code: string; drawings: [InkStroke[] | null, InkStroke[] | null]; names: [string, string]; delay: number; physics: "rapier" | "classic"; rtts: [number, number] };
export type InputMsg = { s: 0 | 1; f: number; b: number[] };
export type LogMsg = { logs: [number[], number[]] };
export type SumMsg = { s: 0 | 1; f: number; h: number };
export type DesyncMsg = { f: number; h: [number, number] };
export type PeerMsg = { seat: 0 | 1; connected: boolean; gone?: boolean };
