import type { FastifyInstance } from "fastify";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerConfig } from "./config.js";
import type { PartyState } from "../../shared/party";
import type { ServerMessage } from "../../shared/network";
import { partyRoster } from "../../shared/match-roster";
import { FixedLoop } from "../../src/physics/loop";
import { NetworkMatch } from "./network-match.js";
import { chooseMatchArena, type ArenaId } from "../../shared/arenas";
import { replayMessage } from "../../shared/replay";

type Identity = { id: string; code: string | null; touch: () => void };
export class NetworkMatches {
  matches = new Map<string, NetworkMatch>();
  private sockets = new Map<
    string,
    { socket: WebSocket; seen: number; replayId?: string }
  >();
  private replayPayloads = new Map<string, { id: string; payload: string }>();
  private missing = new Map<string, number>();
  private loops = new Map<string, FixedLoop>();
  private broadcastTick = new Map<string, number>();
  private previousArena?: ArenaId;
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
            const clip = game.match.replay?.clip;
            if (
              connection?.socket.readyState === WebSocket.OPEN &&
              clip &&
              connection.replayId !== `${game.id}:${clip.goal.id}` &&
              connection.socket.bufferedAmount < 128000
            ) {
              let cached = this.replayPayloads.get(code);
              if (cached?.id !== clip.goal.id) {
                cached = {
                  id: clip.goal.id,
                  payload: JSON.stringify(replayMessage(game.id, clip)),
                };
                this.replayPayloads.set(code, cached);
              }
              connection.socket.send(cached.payload);
              connection.replayId = `${game.id}:${clip.goal.id}`;
            }
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
          for (const game of this.matches.values()) game.connected(player.id);
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
          } else if (message.type === "REPLAY_SKIP_REQUEST") {
            const game = player.code ? this.matches.get(player.code) : null;
            if (
              game &&
              game.id === message.matchId &&
              typeof message.replayId === "string"
            )
              game.skipReplay(player.id, message.replayId);
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
    const players = partyRoster(party);
    const arenaId = chooseMatchArena(this.previousArena);
    const game = new NetworkMatch(players, arenaId);
    this.previousArena = arenaId;
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
    this.replayPayloads.delete(code);
    for (const p of game.players) this.missing.delete(p.id);
    game.dispose();
    this.ended(code, reason);
  }
}
