/**
 * Notebook Fighters game server: Colyseus (rooms, matchmaking by code, reconnection) over ws.
 *   pnpm --filter @nf/server start        (PORT=2567 by default)
 * GET /health → room / input / checksum / desync counters.
 */
import http from "node:http";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DEFAULT_SERVER_PORT } from "@nf/shared";
import { DuelRoom, ROOM_NAME, stats } from "./room";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const httpServer = http.createServer();
httpServer.on("request", (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, ...stats }));
  }
});
const server = new Server({ transport: new WebSocketTransport({ server: httpServer, pingInterval: 3000, pingMaxRetries: 2 }) });
server.define(ROOM_NAME, DuelRoom);
await server.listen(port);
console.log(`Notebook Fighters server on :${port} (rooms: "${ROOM_NAME}")`);
void matchMaker;
