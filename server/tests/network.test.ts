import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { NetworkMatch, initializeMatchPhysics } from "../src/network-match.js";
import { starter } from "../../shared/catalog";
import { neutralInput } from "../../shared/player";
import type { MatchSnapshot, NetPlayer } from "../../shared/network";
import { isArenaId } from "../../shared/arenas";

test("server-owned physics, pads, goals, reset, clock and bots", async () => {
  await initializeMatchPhysics();
  const roster: NetPlayer[] = Array.from({ length: 4 }, (_, i) => ({
    id: `p${i}`,
    name: `Driver ${i}`,
    team: (i < 2 ? 0 : 1) as 0 | 1,
    controller: i < 2 ? "remote" : "bot",
    preset: starter(),
  }));
  const game = new NetworkMatch(roster);
  try {
    assert.equal(game.snapshot().cars.length, 4);
    assert.equal(game.match.phase, "countdown");
    assert.equal(
      game.snapshot().kickoffFormationId,
      game.match.kickoffFormationId,
    );
    assert.ok(game.snapshot().kickoffFormationId);
    const kickoffCar = game.simulation.cars[0],
      kickoffPosition = { ...kickoffCar.body.translation() },
      kickoffRotation = { ...kickoffCar.body.rotation() };
    assert.ok(
      game.accept(
        "p0",
        0,
        { ...neutralInput(), steer: 1, throttle: 1, boost: true, jump: true },
        0,
      ),
    );
    game.step(0);
    assert.ok(Math.abs(game.snapshot().cars[0].steer) > 0.2);
    assert.deepEqual({ ...kickoffCar.body.translation() }, kickoffPosition);
    assert.deepEqual({ ...kickoffCar.body.rotation() }, kickoffRotation);
    assert.equal(kickoffCar.boost, 33);
    game.disconnect("p0");
    for (let i = 1; i < 360; i++) game.step(0);
    assert.equal(game.match.phase, "playing");
    game.connected("p0");
    assert.ok(
      game.accept("p0", 1, { ...neutralInput(), throttle: 1, boost: true }, 0),
    );
    assert.equal(
      game.accept("p0", 1, neutralInput(), 0),
      false,
      "stale sequence rejected",
    );
    assert.equal(
      game.accept("p1", 1, { ...neutralInput(), throttle: 2 }, 0),
      false,
    );
    assert.equal(
      game.accept("p1", 1, { ...neutralInput(), position: { x: 99 } }, 0),
      false,
    );
    assert.equal(
      game.accept("p2", 1, neutralInput(), 0),
      false,
      "humans cannot drive bot IDs",
    );
    const z = game.simulation.cars[0].body.translation().z,
      botStart = { ...game.simulation.cars[2].body.translation() };
    for (let i = 0; i < 120; i++) {
      game.accept(
        "p0",
        i + 2,
        { ...neutralInput(), throttle: 1, boost: true },
        i,
      );
      game.step(i);
    }
    assert.ok(game.simulation.cars[0].body.translation().z < z - 5);
    assert.ok(game.simulation.cars[0].boost < 33);
    const bot = game.simulation.cars[2],
      botPosition = bot.body.translation(),
      botVelocity = bot.body.linvel();
    // A moving flip can point the nose opposite travel. Measure world motion
    // and actual displacement instead of signed local forward speed at one tick.
    assert.ok(
      Math.hypot(
        botPosition.x - botStart.x,
        botPosition.y - botStart.y,
        botPosition.z - botStart.z,
      ) > 1,
      "bot travels on server",
    );
    assert.ok(
      Math.hypot(botVelocity.x, botVelocity.y, botVelocity.z) > 1,
      "bot moves on server during flips",
    );
    assert.ok(game.match.remaining < 300);
    game.step(1000);
    assert.equal(
      game.simulation.cars[0].boosting,
      false,
      "stale input goes neutral",
    );
    const pad = game.pads.items[0],
      car = game.simulation.cars[0];
    car.reset(pad.x, pad.z, 0);
    car.boost = 0;
    game.pads.tick(game.simulation.cars);
    assert.equal(car.boost, 100);
    assert.equal(game.snapshot().pads[0], 10);
    game.simulation.lastTouchId = "p0";
    game.simulation.ball.setTranslation({ x: 0, y: 1, z: -53 }, true);
    game.match.tick(game.simulation);
    assert.deepEqual(game.snapshot().score, [1, 0]);
    assert.equal(game.match.lastGoal?.scorerId, "p0");
    assert.equal(game.snapshot().ball.enabled, false);
    const reset = game.match.resetSequence;
    for (let i = 0; i < 600 && game.match.phase === "goal"; i++)
      game.step(1000 + i);
    assert.equal(game.match.phase, "replay");
    assert.ok(game.skipReplay("p0", game.match.replay!.clip.goal.id));
    assert.ok(game.skipReplay("p1", game.match.replay!.clip.goal.id));
    assert.ok(game.match.resetSequence > reset);
    assert.equal(game.match.phase, "countdown");
    game.match.phase = "playing";
    game.match.remaining = 0;
    game.simulation.ball.setTranslation({ x: 0, y: 0.93, z: 0 }, true);
    game.match.tick(game.simulation);
    assert.equal(game.match.phase, "finished");
  } finally {
    game.dispose();
  }
});

test("snapshots publish double-jump visuals, skip first jumps and clear at kickoff", async () => {
  await initializeMatchPhysics();
  const game = new NetworkMatch([
    {
      id: "jump-driver",
      name: "Driver",
      team: 0,
      controller: "remote",
      preset: starter(),
    },
  ]);
  try {
    const car = game.simulation.cars[0],
      neutral = neutralInput();
    car.reset(0, 15, 0);
    for (let i = 0; i < 60; i++) game.simulation.step([neutral]);
    game.simulation.step([{ ...neutral, jump: true }]);
    assert.equal(game.snapshot().cars[0].normalJump?.sequence, 0);
    game.simulation.step([neutral]);
    game.simulation.step([{ ...neutral, jump: true }]);
    const event = JSON.parse(JSON.stringify(game.snapshot())).cars[0]
      .normalJump;
    assert.equal(event.sequence, 1);
    assert.ok(event.age < 0.02);
    assert.ok(event.normal.y > 0.99);
    assert.ok(event.origin.y < car.body.translation().y);
    for (let i = 0; i < 12; i++) game.simulation.step([neutral]);
    assert.equal(game.snapshot().cars[0].normalJump?.sequence, 1);
    game.match.kickoff(game.simulation);
    assert.equal(game.snapshot().cars[0].normalJump?.sequence, 0);
    assert.ok(Number.isFinite(game.snapshot().cars[0].normalJump?.age));
  } finally {
    game.dispose();
  }
});

test("authenticated sockets share a match, isolate inputs, and return on party leave", async () => {
  const origin = "http://localhost:4186";
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
  const clients: WebSocket[] = [];
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as { port: number };
    const headers = {
      origin,
      "x-arena-client": "1",
      "content-type": "application/json",
    };
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++)
      tokens.push(
        (
          await app.inject({
            method: "POST",
            url: "/api/party/session",
            headers,
            payload: { preset: starter(), newSession: true },
          })
        ).json().sessionToken,
      );
    const send = (i: number, path: string, payload: unknown = {}) =>
      app.inject({
        method: "POST",
        url: "/api/party/" + path,
        headers: { ...headers, "x-arena-party": tokens[i] },
        payload,
      });
    const code = (await send(0, "create")).json().party.code;
    await send(1, "join", { code });
    await send(0, "stage", { stage: "mode" });
    await send(0, "stage", { stage: "teams" });
    assert.equal((await send(0, "launch")).statusCode, 409);
    await send(0, "team", { team: 0 });
    await send(1, "team", { team: 1 });
    assert.equal((await send(1, "launch")).statusCode, 403);
    const replies: MatchSnapshot[][] = [[], []];
    for (let i = 0; i < 2; i++)
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${address.port}/api/match/socket`,
          { origin },
        );
        clients.push(socket);
        socket.on("error", reject);
        socket.on("open", () =>
          socket.send(JSON.stringify({ type: "auth", token: tokens[i] })),
        );
        socket.on("message", (data) => {
          const m = JSON.parse(data.toString());
          if (m.type === "connected") resolve();
          if (m.type === "snapshot") replies[i].push(m);
        });
      });
    assert.equal((await send(0, "launch")).statusCode, 200);
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(replies[0].length > 0 && replies[1].length > 0);
    assert.equal(replies[0][0].matchId, replies[1][0].matchId);
    assert.ok(isArenaId(replies[0][0].arenaId));
    assert.equal(replies[0][0].arenaId, replies[1][0].arenaId);
    assert.ok(replies[0].every((s) => s.arenaId === replies[0][0].arenaId));
    const tick = replies[0][0].tick,
      other = replies[1].find((s) => s.tick === tick);
    assert.ok(other);
    assert.deepEqual(replies[0][0], other);
    assert.ok(other.kickoffFormationId);
    assert.equal((await send(0, "team", { team: 1 })).statusCode, 409);
    assert.equal((await send(0, "return")).statusCode, 409);
    await send(1, "leave");
    const state = (
      await app.inject({
        method: "GET",
        url: "/api/party",
        headers: { ...headers, "x-arena-party": tokens[0] },
      })
    ).json();
    assert.equal(state.party.stage, "teams");
    assert.equal(state.party.matchId, undefined);
  } finally {
    for (const socket of clients) socket.terminate();
    await app.close();
  }
});
