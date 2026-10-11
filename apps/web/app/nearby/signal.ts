/**
 * Play nearby, the link: a WebRTC data channel between two phones on the same hotspot / Wi-Fi, with
 * no internet and no server. There is no STUN/TURN (iceServers: []), so only host candidates are
 * used: the phones' addresses on the shared network. The "signalling" is two codes the players swap
 * by QR (or copy / paste):
 *
 *   host: offer code  ──QR──▶  friend      friend: answer code  ──QR──▶  host      → channel opens
 *
 * A code is the SDP after ICE gathering finished (so it carries every candidate), with lines a data
 * channel doesn't need stripped, deflated (CompressionStream "deflate-raw") and base64url-encoded,
 * behind a 3-letter header: "NO1" offer / "NA1" answer, then "z" (deflated) or "p" (plain, browsers
 * without CompressionStream).
 */
import type { Pipe } from "@nf/sim";

export type CodeKind = "offer" | "answer";
const HEAD: Record<CodeKind, string> = { offer: "NO1", answer: "NA1" };

/** drop what a data-channel-only session doesn't need (keeps the QR small) */
export function stripSdp(sdp: string): string {
  const keep: string[] = [];
  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^a=(extmap-allow-mixed|msid-semantic|ice-options)/.test(line)) continue;
    // the session id / version only matter for renegotiation, which a nearby room never does
    if (line.startsWith("o=")) {
      keep.push("o=- 1 1 IN IP4 0.0.0.0");
      continue;
    }
    if (line.startsWith("a=candidate:")) {
      // TCP candidates are never needed between two phones on one network
      if (/ tcp /i.test(line)) continue;
      // "generation 0 network-id 1 network-cost 10" and friends are optional extensions
      keep.push(line.replace(/ (generation|network-id|network-cost|ufrag) \S+/g, ""));
      continue;
    }
    keep.push(line);
  }
  return keep.join("\r\n") + "\r\n";
}

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function pump(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function packSdp(kind: CodeKind, sdp: string): Promise<string> {
  const bytes = new TextEncoder().encode(stripSdp(sdp));
  if (typeof CompressionStream === "function") {
    try {
      return `${HEAD[kind]}z${b64url(await pump(bytes, new CompressionStream("deflate-raw")))}`;
    } catch {
      // fall through to plain
    }
  }
  return `${HEAD[kind]}p${b64url(bytes)}`;
}

/** a code (scanned or pasted) back to SDP; throws a player-facing message if it isn't the right kind */
export async function unpackSdp(kind: CodeKind, code: string): Promise<string> {
  const c = code.replace(/\s+/g, "");
  const other: CodeKind = kind === "offer" ? "answer" : "offer";
  if (c.startsWith(HEAD[other])) throw new Error(kind === "offer" ? "That's an answer code. Scan the code on the host's phone." : "That's your own room code. Scan the answer on your friend's phone.");
  if (!c.startsWith(HEAD[kind]) || c.length < 20) throw new Error("That isn't a Notebook Fighters nearby code.");
  const mode = c[3];
  let bytes: Uint8Array;
  try {
    bytes = unb64url(c.slice(4));
  } catch {
    throw new Error("That code is damaged. Copy it again.");
  }
  if (mode === "z") {
    if (typeof DecompressionStream !== "function") throw new Error("This browser can't read compressed codes. Update it, or use Chrome / Safari 16.4+.");
    try {
      bytes = await pump(bytes, new DecompressionStream("deflate-raw"));
    } catch {
      throw new Error("That code is damaged. Copy it again.");
    }
  } else if (mode !== "p") throw new Error("That isn't a Notebook Fighters nearby code.");
  const sdp = new TextDecoder().decode(bytes);
  if (!sdp.startsWith("v=0")) throw new Error("That code is damaged. Copy it again.");
  return sdp;
}

/** wait until every ICE candidate is in the local description (no trickle: the code is the whole thing) */
function gathered(pc: RTCPeerConnection, ms = 4000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    // some browsers never report "complete" without a STUN server: what we have after 4 s is enough
    const t = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

const candidates = (sdp: string) => sdp.split(/\r?\n/).filter((l) => l.startsWith("a=candidate:")).length;

/** biggest data-channel message we send in one piece (a detailed drawing in "join" can be larger: it goes in chunks) */
const CHUNK = 16 * 1024;

/** a data channel as a Pipe: heartbeat every second, closed after 6 s of silence, a failed ICE link or a closed channel */
export function channelPipe(pc: RTCPeerConnection, dc: RTCDataChannel): Pipe {
  const msgCbs: ((t: string) => void)[] = [];
  let parts: string[] = [];
  const closeCbs: ((w: string) => void)[] = [];
  let lastRx = performance.now();
  let gone = false;
  const finish = (why: string) => {
    if (gone) return;
    gone = true;
    clearInterval(hb);
    try {
      dc.close();
      pc.close();
    } catch {
      // already closed
    }
    for (const cb of closeCbs) cb(why);
  };
  const hb = setInterval(() => {
    if (dc.readyState === "open") {
      try {
        dc.send("hb");
      } catch {
        // closing
      }
    }
    if (performance.now() - lastRx > 6000) finish("silent");
  }, 1000);
  dc.onmessage = (ev) => {
    lastRx = performance.now();
    if (typeof ev.data !== "string" || ev.data === "hb") return;
    // "\u0001" + piece: more to come; "\u0002" + piece: the last piece of a chunked message
    const tag = ev.data.charCodeAt(0);
    if (tag === 1) {
      parts.push(ev.data.slice(1));
      return;
    }
    let text = ev.data;
    if (tag === 2) {
      parts.push(ev.data.slice(1));
      text = parts.join("");
      parts = [];
    }
    for (const cb of msgCbs) cb(text);
  };
  dc.onclose = () => finish("closed");
  dc.onerror = () => finish("error");
  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") finish(pc.connectionState);
  });
  return {
    send(text) {
      if (dc.readyState !== "open") throw new Error("closed");
      if (text.length <= CHUNK) return dc.send(text);
      for (let i = 0; i < text.length; i += CHUNK) dc.send((i + CHUNK >= text.length ? "\u0002" : "\u0001") + text.slice(i, i + CHUNK));
    },
    onMessage: (cb) => void msgCbs.push(cb),
    onClose: (cb) => void closeCbs.push(cb),
    close: () => finish("closed"),
  };
}

const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

function opened(dc: RTCDataChannel, pc: RTCPeerConnection, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (dc.readyState === "open") return resolve();
    const t = setTimeout(() => reject(new Error("The phones couldn't reach each other. Are both on the same hotspot or Wi-Fi?")), ms);
    dc.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") {
        clearTimeout(t);
        reject(new Error("The phones couldn't reach each other. Are both on the same hotspot or Wi-Fi?"));
      }
    });
  });
}

/** host: make the offer code; later, finish(answerCode) resolves with the open link */
export async function hostOffer(): Promise<{ code: string; candidates: number; finish(answer: string): Promise<Pipe>; cancel(): void }> {
  if (typeof RTCPeerConnection !== "function") throw new Error("This browser can't do direct connections (WebRTC).");
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const dc = pc.createDataChannel("nf", { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const sdp = pc.localDescription!.sdp;
  return {
    code: await packSdp("offer", sdp),
    candidates: candidates(sdp),
    async finish(answer: string) {
      const remote = await unpackSdp("answer", answer);
      await pc.setRemoteDescription({ type: "answer", sdp: remote });
      await opened(dc, pc, 15000);
      return channelPipe(pc, dc);
    },
    cancel: () => pc.close(),
  };
}

/** friend: read the host's offer code, make the answer code; `link` resolves once the channel opens */
export async function guestAnswer(offer: string): Promise<{ code: string; candidates: number; link: Promise<Pipe>; cancel(): void }> {
  if (typeof RTCPeerConnection !== "function") throw new Error("This browser can't do direct connections (WebRTC).");
  const remote = await unpackSdp("offer", offer);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const channel = new Promise<RTCDataChannel>((resolve) => (pc.ondatachannel = (ev) => resolve(ev.channel)));
  await pc.setRemoteDescription({ type: "offer", sdp: remote });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const sdp = pc.localDescription!.sdp;
  // the host may take a while to scan the answer: wait up to 3 minutes for the channel
  const lost = new Promise<never>((_, reject) => {
    const fail = () => reject(new Error("The phones couldn't reach each other. Are both on the same hotspot or Wi-Fi?"));
    const t = setTimeout(fail, 180_000);
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") fail();
      if (pc.connectionState === "connected") clearTimeout(t);
    });
  });
  const link = Promise.race([
    channel.then(async (dc) => {
      await opened(dc, pc, 15_000);
      return channelPipe(pc, dc);
    }),
    lost,
  ]);
  lost.catch(() => {});
  return { code: await packSdp("answer", sdp), candidates: candidates(sdp), link, cancel: () => pc.close() };
}
