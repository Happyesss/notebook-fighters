/**
 * Deterministic lockstep with input delay (plan §10, step 1). Transport-agnostic: the browser
 * wires it to a Colyseus room, the headless test to colyseus.js in Node.
 *
 *  · Your input sampled now is scheduled for frame (current + delay) and sent at once, with the
 *    previous few frames again (redundancy).
 *  · Frame f is simulated only when both seats' inputs for f are known; otherwise the game waits
 *    (a "stall") — both clients therefore run exactly the same frames with the same inputs.
 *  · Rounds advance on a fixed frame count after a K.O., so no "next round" message can race.
 *  · Every CHECKSUM_EVERY frames each client reports the sim's FNV-1a checksum; a mismatch is a desync.
 */
import { CHECKSUM_EVERY, DEFAULT_TUNING, MATCH_GAP_FRAMES, REDUNDANCY, ROUND_GAP_FRAMES, packInput, unpackInput, type PlayerInput } from "@nf/shared";
import type { FxEvent, NotebookSim } from "./sim";

export type LockstepSend = {
  input(f: number, bits: number[]): void;
  checksum(f: number, h: number): void;
};

export class Lockstep {
  /** per seat: input byte per frame (undefined = not known yet) */
  inputs: [number[], number[]] = [[], []];
  /** the next frame we have not sampled our own input for */
  nextLocal: number;
  /** frames simulated so far (= the next frame to simulate) */
  frame = 0;
  overFor = 0;
  stalls = 0;
  stalledNow = false;
  sums = new Map<number, number>();
  remoteSums = new Map<number, number>();
  desyncs: number[] = [];
  matches = 0;
  results: { round: number; winner: number | null; frame: number; wins: [number, number] }[] = [];
  private scored = false;

  constructor(
    public sim: NotebookSim,
    public seat: 0 | 1,
    public delay: number,
    private send: LockstepSend,
  ) {
    // the first `delay` frames have no input from anyone
    for (let f = 0; f < delay; f++) this.inputs[0][f] = this.inputs[1][f] = 0;
    this.nextLocal = delay;
  }

  /** can we still schedule an input without running ahead of the delay window? */
  get canSample() {
    return this.nextLocal <= this.frame + this.delay;
  }

  /** schedule this tick's input; returns false if we're too far ahead (stalled waiting for the peer) */
  sample(input: PlayerInput): boolean {
    if (!this.canSample) return false;
    const mine = this.inputs[this.seat];
    mine[this.nextLocal] = packInput(input);
    this.nextLocal++;
    this.flush();
    return true;
  }

  /** (re)send our last few frames */
  flush(all = false) {
    const mine = this.inputs[this.seat];
    // everything never sent yet (the first send carries the delay's empty frames), plus the redundant tail
    const from = all ? 0 : Math.max(0, Math.min(this.unsent, this.nextLocal - REDUNDANCY));
    this.send.input(from, mine.slice(from, this.nextLocal));
    this.unsent = this.nextLocal;
  }
  private unsent = 0;

  /** inputs from the server: frames f.. for seat s (redundant copies are fine; known frames never change) */
  receive(s: 0 | 1, f: number, bits: number[]) {
    const log = this.inputs[s];
    for (let k = 0; k < bits.length; k++) if (log[f + k] === undefined) log[f + k] = bits[k];
  }

  /** a full log from the server (after a reconnect) */
  receiveLog(logs: [number[], number[]]) {
    this.receive(0, 0, logs[0]);
    this.receive(1, 0, logs[1]);
    // anything we scheduled but the server never got (sent while the socket was down) goes again
    const known = logs[this.seat].length;
    if (this.nextLocal < known) this.nextLocal = known;
    if (known < this.nextLocal) this.send.input(known, this.inputs[this.seat].slice(known, this.nextLocal));
  }

  receiveSum(f: number, h: number) {
    this.remoteSums.set(f, h);
    this.compare(f);
  }

  ready() {
    return this.inputs[0][this.frame] !== undefined && this.inputs[1][this.frame] !== undefined;
  }

  /** frames both inputs are known beyond the current one (how far behind we are) */
  backlog() {
    let n = 0;
    while (this.inputs[0][this.frame + n] !== undefined && this.inputs[1][this.frame + n] !== undefined) n++;
    return n;
  }

  /** simulate one frame if both inputs are in; returns its effects, or null on a stall */
  step(): { events: FxEvent[]; impact: number } | null {
    if (!this.ready()) {
      this.stalledNow = true;
      return null;
    }
    this.stalledNow = false;
    const sim = this.sim;
    const f = this.frame;
    // between rounds: the next one starts a fixed number of frames after the K.O. (deterministic)
    if (sim.curr.over) {
      this.overFor++;
      if (!this.scored) {
        this.scored = true;
        this.results.push({ round: sim.curr.round, winner: sim.curr.winner, frame: f, wins: [...sim.curr.wins] as [number, number] });
      }
      const gap = sim.matchWinner !== null ? MATCH_GAP_FRAMES : ROUND_GAP_FRAMES;
      if (this.overFor >= gap) {
        if (sim.matchWinner !== null) this.matches++;
        sim.rematch();
        this.overFor = 0;
        this.scored = false;
      }
    }
    sim.step(unpackInput(this.inputs[0][f]), DEFAULT_TUNING, unpackInput(this.inputs[1][f]));
    this.frame++;
    const fx = sim.drainFx();
    if (this.frame % CHECKSUM_EVERY === 0) {
      const h = sim.checksum();
      this.sums.set(this.frame, h);
      this.send.checksum(this.frame, h);
      this.compare(this.frame);
      if (this.sums.size > 600) this.sums.delete(this.sums.keys().next().value!);
    }
    return fx;
  }

  /** run every frame whose inputs are already known (a rebuilt client fast-forwarding) */
  fastForward(limit = Infinity) {
    let n = 0;
    while (n < limit && this.ready()) {
      this.step();
      n++;
    }
    // our own inputs must not fall behind the frame we're on: fill the gap with "nothing pressed"
    const from = this.nextLocal;
    while (this.nextLocal < this.frame + this.delay) {
      this.inputs[this.seat][this.nextLocal] ??= 0;
      this.nextLocal++;
    }
    if (this.nextLocal > from) this.send.input(from, this.inputs[this.seat].slice(from, this.nextLocal));
    return n;
  }

  private compare(f: number) {
    const a = this.sums.get(f);
    const b = this.remoteSums.get(f);
    if (a !== undefined && b !== undefined && a !== b && !this.desyncs.includes(f)) this.desyncs.push(f);
  }
}
