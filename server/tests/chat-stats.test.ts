import { test } from "node:test";
import assert from "node:assert/strict";
import { NetworkMatch, initializeMatchPhysics } from "../src/network-match";
import { starter } from "../../shared/catalog";
import { neutralInput } from "../../shared/player";
import { P } from "../../src/config/physics";
import { WebSocket } from "ws";
import { createApp } from "../src/app";
test("shared authority owns chat identity, rate limits, ping, stats and replay persistence", async () => {
  await initializeMatchPhysics();
  const players = [0, 1].map((team) => ({
    id: "p" + team,
    name: team ? "Bravo" : "Alpha",
    team: team as 0 | 1,
    controller: "remote" as const,
    preset: starter(),
  }));
  const game = new NetworkMatch(players);
  try {
    assert.ok(game.acceptChat("unknown", "spoof", 0).error);
    const a = game.acceptChat("p0", " Hello ", 0);
    assert.equal(a.message!.playerId, "p0");
    assert.equal(a.message!.text, "Hello");
    assert.ok(game.acceptChat("p0", "spam", 10).error);
    assert.ok(game.acceptChat("p1", "<script>no markup</script>", 10).message);
    assert.equal(game.snapshot().chat!.length, 2);
    game.ping("p0", 23.6);
    assert.equal(
      game.snapshot().stats!.find((s) => s.playerId === "p0")!.ping,
      24,
    );
    const m = game.match,
      s = game.simulation;
    m.phase = "playing";
    m.tick(s);
    s.lastTouchId = "p0";
    s.ball.setTranslation({ x: 0, y: 2, z: -P.arena.halfLength - 2 }, true);
    m.tick(s);
    assert.equal(m.stats!.players.get("p0")!.goals, 1);
    assert.equal(m.stats!.players.get("p0")!.score, 100);
    m.freeze = 0;
    m.tick(s);
    assert.equal(m.phase, "replay");
    const totals = m.stats!.snapshot().map(({ ping, ...s }) => s);
    assert.ok(game.acceptChat("p0", "Replay works", 1100).message);
    for (let i = 0; i < 20; i++) game.step(0);
    assert.deepEqual(
      m.stats!.snapshot().map(({ ping, ...s }) => s),
      totals,
    );
    for (const p of players) game.skipReplay(p.id, m.replay!.clip.goal.id);
    assert.equal(m.phase, "countdown");
    assert.equal(m.stats!.players.get("p0")!.goals, 1);
    game.disconnect("p0");
    assert.equal(m.stats!.players.get("p0")!.ping, null);
  } finally {
    game.dispose();
  }
});
test("authenticated WebSocket relay resolves sender identity and rejects chat flooding without closing match", async () => {
  const origin = "http://localhost:5173";
  const { app } = await createApp({
    host: "127.0.0.1",
    port: 0,
    database: ":memory:",
    origins: [origin],
    production: false,
    trustProxy: false,
    authLimit: 100,
    sessionSeconds: 600,
  });
  const sockets: WebSocket[] = [];
  try {
    const tokens: string[] = [],
      ids: string[] = [];
    const send = (i: number, path: string, payload: unknown = {}) =>
      app.inject({
        method: "POST",
        url: "/api/party" + path,
        headers: {
          origin,
          "x-arena-client": "1",
          "x-arena-party": tokens[i] ?? "",
        },
        payload,
      });
    for (let i = 0; i < 2; i++) {
      const r = (
        await send(-1, "/session", { preset: starter(), newSession: true })
      ).json();
      tokens.push(r.sessionToken);
      ids.push(r.playerId);
    }
    const code = (await send(0, "/create")).json().party.code;
    await send(1, "/join", { code });
    await send(0, "/stage", { stage: "mode" });
    const launch = (await send(0, "/launch")).json().party;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const messages: any[][] = [[], []];
    for (let i = 0; i < 2; i++) {
      const ws = new WebSocket("ws://127.0.0.1:" + port + "/api/match/socket", {
        origin,
      });
      sockets.push(ws);
      ws.on("message", (raw) => {
        const m = JSON.parse(raw.toString());
        messages[i].push(m);
        if (m.type === "latency-probe")
          ws.send(JSON.stringify({ type: "latency-reply", nonce: m.nonce }));
      });
      await new Promise<void>((resolve) =>
        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "auth", token: tokens[i] }));
          resolve();
        }),
      );
    }
    const until = async (f: () => boolean) => {
      for (let i = 0; i < 200 && !f(); i++)
        await new Promise((r) => setTimeout(r, 10));
      assert.ok(f());
    };
    await until(() =>
      messages.every((a) => a.some((m) => m.type === "snapshot")),
    );
    sockets[0].send(
      JSON.stringify({
        type: "chat-send",
        matchId: launch.matchId,
        playerId: ids[1],
        name: "Spoof",
        team: 1,
        text: "safe <b>plain</b>",
      }),
    );
    await until(() =>
      messages.every((a) => a.some((m) => m.type === "chat-message")),
    );
    for (const ms of messages) {
      const chat = ms.find((m) => m.type === "chat-message");
      assert.equal(chat.message.playerId, ids[0]);
      assert.equal(chat.message.text, "safe <b>plain</b>");
      assert.equal(chat.message.name, undefined);
    }
    sockets[0].send(
      JSON.stringify({
        type: "chat-send",
        matchId: launch.matchId,
        text: "flood",
      }),
    );
    await until(() => messages[0].some((m) => m.type === "chat-error"));
    assert.equal(sockets[0].readyState, WebSocket.OPEN);
    await until(() =>
      messages.every((a) =>
        a.some(
          (m) =>
            m.type === "snapshot" && m.stats?.some((s: any) => s.ping !== null),
        ),
      ),
    );
  } finally {
    for (const s of sockets) s.terminate();
    await app.close();
  }
});
