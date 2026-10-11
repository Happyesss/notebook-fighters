/**
 * Notebook Fighters on ONE Cloudflare Worker.
 *   · static game site: Workers Static Assets (apps/web/out), served without running this code
 *   · online 1v1: one Durable Object per room code (./room.ts), native WebSockets + Hibernation
 *
 * Routes (only /api/* and /r/* reach this code; see run_worker_first in wrangler.jsonc):
 *   GET  /api/health              → { ok: true }
 *   POST /api/rooms               → { code }   (claims a fresh 6-char code)
 *   GET  /api/rooms/:code         → that room's counters (phase, inputs, checksums, desyncs, …)
 *   GET  /api/rooms/:code/ws      → WebSocket upgrade, handed to the room's Durable Object
 *   GET  /r/:code                 → 302 /online?join=CODE (the share link)
 *   anything else                 → static assets (404.html when nothing matches)
 */
import { isRoomCode, makeRoomCode } from "@nf/shared";
export { Room } from "./room";
import type { Room } from "./room";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });

const room = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (path === "/api/health") return json({ ok: true, service: "notebook-fighters", time: new Date().toISOString() });

      if (path === "/api/rooms" && request.method === "POST") {
        let physics: "rapier" | "classic" = "rapier";
        try {
          const body = (await request.json()) as { physics?: string };
          if (body?.physics === "classic") physics = "classic";
        } catch {
          // no body: defaults
        }
        // a random code is almost always free; the room itself refuses a code that's in use
        for (let i = 0; i < 8; i++) {
          const code = makeRoomCode();
          if (await room(env, code).claim(code, physics)) return json({ code }, 201);
        }
        return json({ error: "no free room code, try again" }, 503);
      }

      const m = path.match(/^\/api\/rooms\/([A-Za-z0-9]{6})(\/ws)?$/);
      if (m) {
        const code = m[1].toUpperCase();
        if (!isRoomCode(code)) return json({ error: "bad room code" }, 400);
        if (m[2]) {
          if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "expected a WebSocket upgrade" }, 426);
          return room(env, code).fetch(request);
        }
        if (request.method === "GET") return json(await room(env, code).info());
      }
      return json({ error: "not found" }, 404);
    }

    const r = path.match(/^\/r\/([A-Za-z0-9]{6})\/?$/);
    if (r && isRoomCode(r[1].toUpperCase())) {
      return new Response(null, { status: 302, headers: { location: `/online?join=${r[1].toUpperCase()}`, "cache-control": "no-store" } });
    }
    if (path.startsWith("/r/")) return Response.redirect(new URL("/online", url).toString(), 302);

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
