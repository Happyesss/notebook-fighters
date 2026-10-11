/**
 * Online 1v1 protocol (plan §10): Colyseus room "duel", deterministic lockstep with input delay.
 * The server is authoritative for the room phase and the two drawings; it relays inputs, keeps a
 * full input log per seat (for reconnects) and compares checksums.
 */
import type { InkStroke, PlayerInput } from "./index";

export const ROOM_NAME = "duel";
export const DEFAULT_SERVER_PORT = 2567;
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
/** server → client */
export type LobbyMsg = { code: string; seats: [SeatInfo, SeatInfo]; you: 0 | 1 };
export type StartMsg = { code: string; drawings: [InkStroke[] | null, InkStroke[] | null]; names: [string, string]; delay: number; physics: "rapier" | "classic"; rtts: [number, number] };
export type InputMsg = { s: 0 | 1; f: number; b: number[] };
export type LogMsg = { logs: [number[], number[]] };
export type SumMsg = { s: 0 | 1; f: number; h: number };
export type DesyncMsg = { f: number; h: [number, number] };
export type PeerMsg = { seat: 0 | 1; connected: boolean; gone?: boolean };
