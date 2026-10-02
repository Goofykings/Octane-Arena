import type { FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerConfig } from "./config.js";
import type { PartyState } from "../../shared/party";
import type { NetPlayer, ServerMessage } from "../../shared/network";
import { starter } from "../../shared/catalog";
import { FixedLoop } from "../../src/physics/loop";
import { NetworkMatch } from "./network-match.js";

type Identity = { id: string; code: string | null; touch: () => void };
export class NetworkMatches {
  matches = new Map<string, NetworkMatch>();
  private sockets = new Map<string, { socket: WebSocket; seen: number }>();
  private missing = new Map<string, number>();
  private loops = new Map<string, FixedLoop>();
  private broadcastTick = new Map<string, number>();
  constructor(
    app: FastifyInstance,
    config: ServerConfig,
    private identity: (token: string) => Identity | null,
    private ended: (code: string, reason: string) => void,
  ) {
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: 4096,
      perMessageDeflate: false,
    });
    app.server.on("upgrade", (req, socket, head) => {
      const origin = req.headers.origin;
      if (
        req.url !== "/api/match/socket" ||
        !origin ||
        !(
          config.origins.includes(origin) ||
          (config.allowSameOrigin && origin === `http://${req.headers.host}`)
        )
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws));
    });
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        dt = (now - previous) / 1000;
      previous = now;
      for (const [id, connection] of this.sockets)
        if (now - connection.seen > 5000) {
          connection.socket.terminate();
          this.sockets.delete(id);
        }
      for (const [code, game] of this.matches) {
        let lost = false;
        for (const p of game.players.filter((p) => p.controller !== "bot")) {
          if (this.sockets.has(p.id)) this.missing.delete(p.id);
          else {
            game.disconnect(p.id);
            if (!this.missing.has(p.id)) this.missing.set(p.id, now);
            if (now - this.missing.get(p.id)! > 10000) lost = true;
          }
        }
        if (lost) {
          this.stop(code, "PLAYER DISCONNECTED — MATCH ENDED");
          continue;
        }
        this.loops.get(code)!.advance(dt, () => game.step(now));
        if (game.tick - (this.broadcastTick.get(code) ?? -4) >= 4) {
          this.broadcastTick.set(code, game.tick);
          const message = JSON.stringify(game.snapshot());
          for (const p of game.players) {
            const connection = this.sockets.get(p.id);
            if (
              connection?.socket.readyState === WebSocket.OPEN &&
              connection.socket.bufferedAmount < 128000
            )
              connection.socket.send(message);
          }
        }
      }
    }, 8);
    timer.unref();
    app.addHook("preClose", async () => {
      clearInterval(timer);
      for (const connection of this.sockets.values())
        connection.socket.terminate();
      wss.close();
      for (const game of this.matches.values()) game.dispose();
      this.matches.clear();
    });
  }
  private connect(socket: WebSocket) {
    let token = "",
      player: Identity | null = null,
      count = 0,
      windowStart = performance.now();
    const timeout = setTimeout(() => {
      if (!player) socket.close(1008, "Authenticate first");
    }, 5000);
    socket.on("error", () => {});
    socket.on("message", (raw) => {
      const now = performance.now();
      if (now - windowStart > 1000) {
        count = 0;
        windowStart = now;
      }
      if (++count > 180) {
        socket.close(1008, "Too many inputs");
        return;
      }
      try {
        const message = JSON.parse(raw.toString());
        if (!player) {
          if (message.type !== "auth" || typeof message.token !== "string")
            throw Error();
          token = message.token;
          player = this.identity(token);
          if (!player) throw Error();
          clearTimeout(timeout);
          this.sockets
            .get(player.id)
            ?.socket.close(1000, "Replaced connection");
          this.sockets.set(player.id, { socket, seen: now });
          for (const game of this.matches.values()) game.disconnect(player.id);
          socket.send(
            JSON.stringify({ type: "connected" } satisfies ServerMessage),
          );
        } else {
          const current = this.identity(token);
          if (!current || current.id !== player.id) throw Error();
          player = current;
          const connection = this.sockets.get(player.id);
          if (connection?.socket !== socket) throw Error();
          connection.seen = now;
          player.touch();
          if (message.type === "input") {
            const game = player.code ? this.matches.get(player.code) : null;
            if (game && game.id === message.matchId)
              game.accept(player.id, message.sequence, message.input, now);
          } else if (message.type !== "ping") throw Error();
        }
      } catch {
        socket.close(1008, "Invalid match message");
      }
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      if (player && this.sockets.get(player.id)?.socket === socket) {
        this.sockets.delete(player.id);
        for (const game of this.matches.values()) game.disconnect(player.id);
      }
    });
  }
  start(party: PartyState) {
    if (this.matches.has(party.code)) return this.matches.get(party.code)!;
    if (this.matches.size >= 8) throw Error("SERVER IS FULL");
    const players: NetPlayer[] = party.members.map((m) => ({
      id: m.id,
      name: m.name,
      team: m.team as 0 | 1,
      controller: "remote",
      preset: structuredClone(m.preset),
    }));
    if (party.mode === "2v2bots")
      for (let i = 0; i < 2; i++)
        players.push({
          id: `bot-${party.code}-${i}`,
          name: i ? "Relay" : "Circuit",
          team: 1,
          controller: "bot",
          preset: { ...starter(), body: "vector" },
        });
    const game = new NetworkMatch(players);
    this.matches.set(party.code, game);
    this.loops.set(party.code, new FixedLoop());
    return game;
  }
  stop(code: string, reason = "") {
    const game = this.matches.get(code);
    if (!game) return;
    this.matches.delete(code);
    this.loops.delete(code);
    this.broadcastTick.delete(code);
    for (const p of game.players) this.missing.delete(p.id);
    game.dispose();
    this.ended(code, reason);
  }
}
