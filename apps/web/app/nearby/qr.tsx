"use client";

/**
 * QR codes for play nearby, all bundled (no CDN, works offline):
 *  · <QrCode text>  draws a code with qrcode-generator (MIT)
 *  · <QrScanner onCode>  reads one from the camera: the browser's BarcodeDetector where it exists
 *    (Chrome on Android / macOS / ChromeOS), otherwise jsQR (Apache-2.0) on video frames from
 *    getUserMedia (iOS Safari, Firefox, desktop Chrome on Windows / Linux).
 */
import qrcode from "qrcode-generator";
import { useEffect, useRef, useState } from "react";

export function QrCode({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !text) return;
    const qr = qrcode(0, "L");
    qr.addData(text, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    const cell = Math.max(3, Math.floor(720 / (n + quiet * 2)));
    const size = (n + quiet * 2) * cell;
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) if (qr.isDark(r, q)) ctx.fillRect((q + quiet) * cell, (r + quiet) * cell, cell, cell);
    c.dataset.modules = String(n);
  }, [text]);
  return <canvas ref={ref} className="qr-code" role="img" aria-label={label} data-testid={testId} />;
}

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

/** which camera decoder this browser will use */
export async function scannerKind(): Promise<"native" | "js"> {
  const BD = (globalThis as unknown as { BarcodeDetector?: { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!BD) return "js";
  try {
    const f = (await BD.getSupportedFormats?.()) ?? [];
    return f.includes("qr_code") ? "native" : "js";
  } catch {
    return "js";
  }
}

export function QrScanner({ onCode, accept, testId }: { onCode: (text: string) => void; accept: (text: string) => boolean; testId?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"starting" | "scanning" | "denied" | "none">("starting");
  const [kind, setKind] = useState<"native" | "js" | "">("");
  const cb = useRef(onCode);
  cb.current = onCode;
  const ok = useRef(accept);
  ok.current = accept;

  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState("none");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        if (!stop) setState((e as DOMException)?.name === "NotAllowedError" ? "denied" : "none");
        return;
      }
      if (stop) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const v = video.current!;
      v.srcObject = stream;
      v.setAttribute("playsinline", "");
      v.muted = true;
      await v.play().catch(() => {});
      const k = await scannerKind();
      setKind(k);
      setState("scanning");
      let detector: Detector | null = null;
      let jsQR: typeof import("jsqr").default | null = null;
      if (k === "native") detector = new (globalThis as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector({ formats: ["qr_code"] });
      else jsQR = (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const tick = async () => {
        if (stop) return;
        try {
          if (v.readyState >= 2 && v.videoWidth) {
            let text = "";
            if (detector) {
              const found = await detector.detect(v);
              text = found.find((f) => ok.current(f.rawValue))?.rawValue ?? "";
            } else if (jsQR) {
              const scale = Math.min(1, 800 / Math.max(v.videoWidth, v.videoHeight));
              canvas.width = Math.round(v.videoWidth * scale);
              canvas.height = Math.round(v.videoHeight * scale);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
              if (hit && ok.current(hit.data)) text = hit.data;
            }
            if (text && !stop) {
              stop = true;
              stream?.getTracks().forEach((t) => t.stop());
              cb.current(text);
              return;
            }
          }
        } catch {
          // a frame that couldn't be read: try the next
        }
        timer = setTimeout(tick, 120);
      };
      void tick();
    })();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="qr-scanner" data-testid={testId} data-state={state} data-decoder={kind}>
      <video ref={video} playsInline muted aria-label="Camera" />
      <span className="qr-frame" aria-hidden="true" />
      <p className="qr-scanner-note" role="status">
        {state === "starting"
          ? "Starting the camera…"
          : state === "scanning"
            ? "Point the camera at the QR code on the other phone."
            : state === "denied"
              ? "Camera blocked. Allow the camera in the browser settings, or paste the code below."
              : "No camera here. Paste the code below instead."}
      </p>
    </div>
  );
}
