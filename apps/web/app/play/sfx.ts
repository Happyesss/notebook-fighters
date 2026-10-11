/**
 * Fight sounds. Recorded CC0 samples (Kenney sound packs, see public/sfx/CREDITS.md) are layered per event:
 * a swish on the swing start, an impact body on the contact frame (heavier for kicks, deeper for the hulk),
 * a clack on blocks, a big hit + boom + bell on a K.O., a thud on landing, one sound per drawn power, and a tick /
 * bell / jingle for the countdown, FIGHT! and the round win. Variants are picked at random (never the same one
 * twice in a row) with a little pitch and volume jitter. Everything is fetched at page load and decoded into
 * WebAudio buffers when the context unlocks, so playback is a buffer-source start (no decode latency).
 * If the files fail to load or decode, the procedural notebook sounds below (pencil whooshes, paper thwacks,
 * desk bell…) play instead. The AudioContext is only created/resumed after a user gesture (autoplay rules).
 */
import type { FxEvent, PowerKind } from "@nf/sim";

export const MUTE_KEY = "nf:mute";

/** sample groups: the files in public/sfx (each as .ogg and .m4a) */
export const SFX_GROUPS = {
  punch: ["punch_1", "punch_2", "punch_3", "punch_4", "punch_5"],
  kick: ["kick_1", "kick_2", "kick_3", "kick_4", "kick_5"],
  heavy: ["heavy_1", "heavy_2", "heavy_3", "heavy_4"],
  swish: ["swish_1", "swish_2", "swish_3", "swish_4"],
  swishHeavy: ["swish_heavy_1", "swish_heavy_2", "swish_heavy_3", "swish_heavy_4"],
  block: ["block_1", "block_2", "block_3"],
  land: ["land_1", "land_2", "land_3"],
  jump: ["jump_1", "jump_2"],
  koBell: ["ko_bell"],
  koBoom: ["ko_boom"],
  fightBell: ["fight_bell"],
  tick: ["tick_1", "tick_2"],
  roundWin: ["round_win_1", "round_win_2"],
  clash: ["clash"],
  fire: ["fire_1", "fire_2"],
  water: ["water_1", "water_2"],
  lightning: ["zap_1", "zap_2"],
  ice: ["ice_1", "ice_2"],
  wings: ["wings_1", "wings_2"],
  shield: ["shield_1", "shield_2"],
  spikes: ["spikes_1", "spikes_2"],
  // the rivals' own specials reuse sounds already in the packs (no new files)
  pumpkin: ["water_1", "swish_heavy_2"],
  bones: ["block_2", "block_3"],
  quake: ["land_3", "ko_boom"],
  leap: ["jump_2", "wings_1"],
} as const;
export type SfxGroup = keyof typeof SFX_GROUPS;
export const SFX_FILES: string[] = [...new Set(Object.values(SFX_GROUPS).flat())];
/** the format this browser decodes: Ogg Vorbis everywhere but older Safari, which gets AAC (.m4a) */
export function sfxExt(): "ogg" | "m4a" {
  try {
    const a = document.createElement("audio");
    return a.canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "m4a";
  } catch {
    return "ogg";
  }
}
const HEAVY_SWING = new Set(["kick", "swing", "charge", "tailWhip", "slam", "ram", "flop", "pounce", "wheelie", "headbutt"]);

export class Sfx {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** a stream of everything played (for recording a clip with sound) */
  stream: MediaStreamAudioDestinationNode | null = null;
  muted = false;
  /** how many sounds were started, and any audio errors – read by tests */
  played = 0;
  errors: string[] = [];
  private last: Record<string, number> = {};
  /** decoded samples by file name; the raw bytes wait here until the context exists */
  private buffers = new Map<string, AudioBuffer>();
  private raw = new Map<string, Promise<ArrayBuffer | null>>();
  private lastPick: Record<string, string> = {};
  /** sample loading: how many decoded, which failed (read by tests) */
  sampleState = { ext: "ogg" as "ogg" | "m4a", fetched: 0, decoded: 0, failed: [] as string[], total: SFX_FILES.length };
  /** the last samples started (read by tests) */
  log: string[] = [];
  /** set false to hear only the procedural fallback */
  useSamples = true;

  constructor() {
    try {
      this.muted = window.localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      this.muted = false;
    }
    this.prefetch();
  }

  /** fetch every sample at page load (bytes only; decoding needs the AudioContext) */
  private prefetch() {
    if (typeof window === "undefined" || typeof fetch === "undefined") return;
    const ext = (this.sampleState.ext = sfxExt());
    for (const name of SFX_FILES) {
      this.raw.set(
        name,
        fetch(`/sfx/${name}.${ext}`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
          .then((b) => {
            this.sampleState.fetched++;
            return b;
          })
          .catch(() => {
            this.sampleState.failed.push(name);
            return null;
          }),
      );
    }
  }

  /** decode the fetched samples into buffers (once the context exists) */
  private decodeAll() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const [name, p] of this.raw) {
      this.raw.delete(name);
      void p.then(async (bytes) => {
        if (!bytes) return;
        try {
          const buf = await new Promise<AudioBuffer>((ok, bad) => {
            const r = ctx.decodeAudioData(bytes, ok, bad);
            if (r && typeof r.then === "function") r.then(ok, bad);
          });
          this.buffers.set(name, buf);
          this.sampleState.decoded++;
        } catch {
          this.sampleState.failed.push(name);
        }
      });
    }
  }

  private has(group: SfxGroup) {
    return this.useSamples && (SFX_GROUPS[group] as readonly string[]).some((n) => this.buffers.has(n));
  }

  /** a random variant of a sample group (not the one played last), pitch/volume-jittered, `delay` seconds later.
   *  false when the group isn't loaded, so the caller can fall back to the synth */
  private sample(group: SfxGroup, vol = 1, rate = 1, delay = 0) {
    if (!this.useSamples || !this.ctx || !this.master) return false;
    const names = (SFX_GROUPS[group] as readonly string[]).filter((n) => this.buffers.has(n));
    if (!names.length) return false;
    const pool = names.length > 1 ? names.filter((n) => n !== this.lastPick[group]) : names;
    const name = pool[Math.floor(Math.random() * pool.length)];
    this.lastPick[group] = name;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(name)!;
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 0.08);
    const g = this.ctx.createGain();
    g.gain.value = Math.min(1.6, vol * (0.88 + Math.random() * 0.2));
    src.connect(g).connect(this.master);
    src.start(t);
    this.played++;
    this.log.push(name);
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
    return true;
  }

  /** call from a user gesture: creates or resumes the context */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
        try {
          this.stream = this.ctx.createMediaStreamDestination();
          this.master.connect(this.stream);
        } catch {
          this.stream = null;
        }
        const len = Math.floor(this.ctx.sampleRate * 1.5);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        let seed = 7;
        for (let i = 0; i < len; i++) {
          seed = (seed * 16807) % 2147483647;
          d[i] = (seed / 2147483647) * 2 - 1;
        }
        this.decodeAll();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume().catch((e) => this.errors.push(String(e)));
    } catch (e) {
      this.errors.push(String(e));
    }
  }

  get state() {
    return this.ctx?.state ?? "none";
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      // not saved
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.02);
  }

  private ready() {
    return !!(this.ctx && this.master && this.noise && this.ctx.state === "running");
  }

  /** a short envelope gain node into the master */
  private env(t0: number, peak: number, attack: number, decay: number) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private noiseSrc(t0: number, dur: number, rate = 1) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    s.start(t0, Math.random() * 0.5, dur + 0.05);
    return s;
  }

  private filter(type: BiquadFilterType, f: number, q = 1) {
    const b = this.ctx!.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  private osc(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, out: AudioNode) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    o.connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    return o;
  }

  /** pencil scratch: band-passed noise swept down */
  whoosh(big = false) {
    if (!this.gate("whoosh", 0.05)) return;
    const t = this.ctx!.currentTime;
    const dur = big ? 0.22 : 0.14;
    const bp = this.filter("bandpass", big ? 1400 : 2400, 1.8);
    bp.frequency.setValueAtTime(big ? 2200 : 3400, t);
    bp.frequency.exponentialRampToValueAtTime(big ? 500 : 900, t + dur);
    bp.connect(this.env(t, big ? 0.35 : 0.25, 0.02, dur));
    this.noiseSrc(t, dur, 1.3).connect(bp);
  }

  /** a paper-and-cardboard thwack, heavier with damage */
  thwack(power: number) {
    if (!this.gate("thwack", 0.03)) return;
    const t = this.ctx!.currentTime;
    const k = Math.min(1, power / 14);
    this.osc("sine", 160 + 60 * (1 - k), 50, t, 0.12 + 0.12 * k, this.env(t, 0.5 + 0.4 * k, 0.004, 0.14 + 0.15 * k));
    const lp = this.filter("lowpass", 1800 + 1500 * k, 0.7);
    lp.connect(this.env(t, 0.45 + 0.3 * k, 0.002, 0.08 + 0.06 * k));
    this.noiseSrc(t, 0.2, 0.8).connect(lp);
  }

  block() {
    if (!this.gate("block", 0.04)) return;
    const t = this.ctx!.currentTime;
    this.osc("square", 900, 700, t, 0.05, this.env(t, 0.12, 0.002, 0.06));
    const hp = this.filter("highpass", 2500);
    hp.connect(this.env(t, 0.2, 0.002, 0.05));
    this.noiseSrc(t, 0.08).connect(hp);
  }

  thud() {
    if (!this.gate("thud", 0.08)) return;
    const t = this.ctx!.currentTime;
    const lp = this.filter("lowpass", 500);
    lp.connect(this.env(t, 0.18, 0.004, 0.1));
    this.noiseSrc(t, 0.15, 0.6).connect(lp);
  }

  /** a desk bell: inharmonic partials, long ring */
  bell() {
    if (!this.gate("bell", 0.3)) return;
    const t = this.ctx!.currentTime;
    for (const [m, a, d] of [[1, 0.35, 2.2], [2.76, 0.18, 1.4], [5.4, 0.1, 0.8], [8.93, 0.05, 0.5]] as const) {
      const o = this.ctx!.createOscillator();
      o.frequency.value = 660 * m;
      o.connect(this.env(t, a, 0.003, d));
      o.start(t);
      o.stop(t + d + 0.1);
    }
  }

  /** the classroom clock tick (3-2-1) */
  tick() {
    if (this.has("tick")) {
      if (this.gate("tick", 0.2)) this.sample("tick", 0.9);
      return;
    }
    if (!this.gate("tick", 0.2)) return;
    const t = this.ctx!.currentTime;
    this.osc("triangle", 1500, 1100, t, 0.03, this.env(t, 0.3, 0.001, 0.05));
    const bp = this.filter("bandpass", 3000, 4);
    bp.connect(this.env(t, 0.2, 0.001, 0.03));
    this.noiseSrc(t, 0.05).connect(bp);
  }

  /** the school bell for FIGHT!: a fast-struck ringing bell */
  schoolBell() {
    if (this.has("fightBell")) {
      if (this.gate("school", 0.5)) this.sample("fightBell", 0.7);
      return;
    }
    if (!this.gate("school", 0.5)) return;
    const t = this.ctx!.currentTime;
    const g = this.env(t, 0.22, 0.01, 0.7);
    const trem = this.ctx!.createGain();
    trem.connect(g);
    const lfo = this.ctx!.createOscillator();
    const depth = this.ctx!.createGain();
    lfo.frequency.value = 22;
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(trem.gain);
    trem.gain.value = 0.5;
    lfo.start(t);
    lfo.stop(t + 0.8);
    for (const f of [988, 1480, 2637]) {
      const o = this.ctx!.createOscillator();
      o.frequency.value = f;
      o.connect(trem);
      o.start(t);
      o.stop(t + 0.8);
    }
  }

  power(kind: PowerKind) {
    if (!this.gate("power-" + kind, 0.1)) return;
    const t = this.ctx!.currentTime;
    if (kind === "fire") {
      // whoomph + crackle
      const lp = this.filter("lowpass", 700, 0.8);
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.exponentialRampToValueAtTime(1600, t + 0.25);
      lp.connect(this.env(t, 0.5, 0.03, 0.45));
      this.noiseSrc(t, 0.5, 0.7).connect(lp);
      for (let i = 0; i < 6; i++) {
        const c = t + 0.05 + Math.random() * 0.4;
        const hp = this.filter("highpass", 3000);
        hp.connect(this.env(c, 0.15, 0.001, 0.02));
        this.noiseSrc(c, 0.03).connect(hp);
      }
    } else if (kind === "water") {
      // a splash: noise swept up then down, with a gurgle
      const bp = this.filter("bandpass", 600, 1.2);
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(2200, t + 0.12);
      bp.frequency.exponentialRampToValueAtTime(500, t + 0.5);
      bp.connect(this.env(t, 0.45, 0.02, 0.5));
      this.noiseSrc(t, 0.55).connect(bp);
      this.osc("sine", 300, 700, t + 0.05, 0.15, this.env(t + 0.05, 0.12, 0.01, 0.15));
    } else if (kind === "lightning") {
      // zap: buzzy saw with jumping pitch
      const g = this.env(t, 0.22, 0.003, 0.32);
      const o = this.ctx!.createOscillator();
      o.type = "sawtooth";
      for (let i = 0; i < 10; i++) o.frequency.setValueAtTime(200 + Math.random() * 1400, t + i * 0.03);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.36);
      const hp = this.filter("highpass", 4000);
      hp.connect(this.env(t, 0.25, 0.001, 0.2));
      this.noiseSrc(t, 0.25).connect(hp);
    } else if (kind === "ice") {
      // glassy chime + crackle
      for (const [f, d] of [[2093, 0.5], [2637, 0.4], [3136, 0.3]] as const) this.osc("sine", f, f * 0.98, t, d, this.env(t, 0.12, 0.002, d));
      const hp = this.filter("highpass", 5000);
      hp.connect(this.env(t, 0.2, 0.001, 0.12));
      this.noiseSrc(t, 0.15).connect(hp);
    } else if (kind === "wings") {
      for (let i = 0; i < 2; i++) {
        const c = t + i * 0.12;
        const bp = this.filter("bandpass", 500, 1);
        bp.connect(this.env(c, 0.3, 0.03, 0.1));
        this.noiseSrc(c, 0.15, 0.6).connect(bp);
      }
    } else if (kind === "shield") {
      this.osc("triangle", 420, 380, t, 0.35, this.env(t, 0.25, 0.002, 0.35));
      this.osc("sine", 1130, 1100, t, 0.25, this.env(t, 0.1, 0.002, 0.25));
    } else if (kind === "spikes") {
      for (let i = 0; i < 5; i++) {
        const c = t + i * 0.035;
        this.osc("square", 1800 - i * 200, 900, c, 0.03, this.env(c, 0.1, 0.001, 0.03));
      }
    } else if (kind === "pumpkin") {
      // a whoosh up and over
      const bp = this.filter("bandpass", 500, 1);
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(900, t + 0.3);
      bp.connect(this.env(t, 0.3, 0.05, 0.25));
      this.noiseSrc(t, 0.35, 0.6).connect(bp);
    } else if (kind === "bones") {
      // a clatter of dry bones
      for (let i = 0; i < 7; i++) {
        const c = t + i * 0.045 + (i % 2) * 0.01;
        this.osc("square", 900 + (i % 3) * 350, 600, c, 0.025, this.env(c, 0.09, 0.001, 0.025));
      }
    } else if (kind === "quake" || kind === "leap") {
      // a deep thump with a rumble
      this.osc("sine", 110, 40, t, 0.5, this.env(t, 0.45, 0.005, 0.5));
      const lp = this.filter("lowpass", 250, 0.8);
      lp.connect(this.env(t, 0.4, 0.01, 0.6));
      this.noiseSrc(t, 0.6, 0.8).connect(lp);
    }
  }

  /** shots meeting in the air: a hiss */
  hiss() {
    if (!this.gate("hiss", 0.1)) return;
    const t = this.ctx!.currentTime;
    const hp = this.filter("highpass", 3500);
    hp.connect(this.env(t, 0.35, 0.01, 0.5));
    this.noiseSrc(t, 0.55).connect(hp);
  }

  /** the round is won: a short jingle */
  roundWin(delay = 0) {
    if (!this.gate("roundwin", 3)) return;
    this.sample("roundWin", 0.55, 1, delay);
  }

  /** layered samples for one event; false = not loaded, use the synth */
  private layered(e: FxEvent): boolean {
    if (!this.useSamples || !this.buffers.size) return false;
    // the event's main sample must be decoded, or the synth plays it (before any gate is taken)
    const main: SfxGroup | null =
      e.kind === "whoosh" ? (HEAVY_SWING.has(e.move) || e.heavy ? "swishHeavy" : "swish")
      : e.kind === "hit" ? (e.power >= 11 || HEAVY_SWING.has(e.move ?? "") ? "kick" : "punch")
      : e.kind === "block" ? "block" : e.kind === "ko" ? "kick" : e.kind === "land" ? "land" : e.kind === "jump" ? "jump"
      : e.kind === "special" ? (e.power as SfxGroup) : e.kind === "clash" ? "clash" : null;
    if (!main || !(SFX_GROUPS[main] as readonly string[]).some((n) => this.buffers.has(n))) return false;
    if (e.kind === "whoosh") {
      if (!this.gate("whoosh", 0.05)) return true;
      const big = HEAVY_SWING.has(e.move) || !!e.heavy;
      return this.sample(big ? "swishHeavy" : "swish", big ? 0.75 : 0.6, e.heavy ? 0.82 : 1);
    }
    if (e.kind === "hit") {
      if (!this.gate("thwack", 0.03)) return true;
      const k = Math.min(1, e.power / 14);
      const kick = e.power >= 11 || HEAVY_SWING.has(e.move ?? "");
      const deep = e.heavy ? 0.78 : 1;
      // the impact body, plus a low thump layer for the big ones (always for the hulk)
      const ok = this.sample(kick ? "kick" : "punch", 0.75 + 0.45 * k, deep);
      if (kick || e.heavy) this.sample("heavy", (e.heavy ? 0.9 : 0.45) * (0.6 + 0.4 * k), e.heavy ? 0.72 : 0.9);
      return ok;
    }
    if (e.kind === "block") {
      if (!this.gate("block", 0.04)) return true;
      return this.sample("block", 0.8, 1.1);
    }
    if (e.kind === "ko") {
      if (!this.gate("ko", 0.5)) return true;
      const ok = this.sample("kick", 1.3, 0.85);
      this.sample("heavy", 1.1, 0.7);
      this.sample("koBoom", 0.55);
      this.sample("koBell", 0.75, 1, 0.12);
      // the body hits the floor, then the round-win jingle
      this.sample("heavy", 0.7, 0.8, 0.55);
      this.roundWin(1.5);
      return ok;
    }
    if (e.kind === "land") {
      if (!this.gate("thud", 0.08)) return true;
      return this.sample("land", 0.7);
    }
    if (e.kind === "jump") {
      if (!this.gate("thud", 0.08)) return true;
      return this.sample("jump", 0.45);
    }
    if (e.kind === "special") {
      if (!this.gate("power-" + e.power, 0.1)) return true;
      return this.sample(e.power as SfxGroup, 0.8);
    }
    if (e.kind === "clash") {
      if (!this.gate("hiss", 0.1)) return true;
      return this.sample("clash", 0.6);
    }
    return false;
  }

  /** the sim's effect events, mapped to sounds */
  play(events: FxEvent[]) {
    if (!this.ready() || this.muted) return;
    try {
      for (const e of events) {
        if (this.layered(e)) continue;
        if (e.kind === "whoosh") this.whoosh(e.move === "kick" || e.move === "swing" || e.move === "charge" || e.move === "tailWhip");
        else if (e.kind === "hit") this.thwack(e.power);
        else if (e.kind === "block") this.block();
        else if (e.kind === "ko") {
          this.thwack(16);
          this.bell();
        } else if (e.kind === "land" || e.kind === "jump") this.thud();
        else if (e.kind === "special") this.power(e.power);
        else if (e.kind === "clash") this.hiss();
      }
    } catch (err) {
      this.errors.push(String(err));
    }
  }

  /** don't stack the same sound within `gap` seconds */
  private gate(name: string, gap: number) {
    if (!this.ready() || this.muted) return false;
    const now = this.ctx!.currentTime;
    if (now - (this.last[name] ?? -Infinity) < gap) return false;
    this.last[name] = now;
    this.played++;
    return true;
  }
}
