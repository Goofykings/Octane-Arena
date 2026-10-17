import { DropshotView } from "../../shared/dropshot";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
import { starter } from "../../shared/catalog";
for (const transport of ["server", "webrtc"] as const)
  test("Dropshot late spectator and full state: " + transport, async () => {
    const origin = "http://localhost:5173";
    const { app, partyMatches } = await createApp({
      host: "127.0.0.1",
      port: 0,
      database: ":memory:",
      origins: [origin],
      production: false,
      trustProxy: false,
      authLimit: 100,
      sessionSeconds: 600,
      matchTransport: transport,
    });
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
    try {
      for (let i = 0; i < 3; i++) {
        const r = (
          await send(-1, "/session", { preset: starter(), newSession: true })
        ).json();
        tokens.push(r.sessionToken);
        ids.push(r.playerId);
      }
      const code = (await send(0, "/create")).json().party.code;
      await send(1, "/join", { code });
      await send(0, "/stage", { stage: "mode" });
      assert.equal(
        (await send(0, "/gamemode", { gameMode: "dropshot" })).statusCode,
        200,
      );
      await send(0, "/mode", { mode: "1v1" });
      await send(0, "/stage", { stage: "teams" });
      await send(0, "/team", { team: 0 });
      await send(1, "/team", { team: 1 });
      assert.equal((await send(0, "/launch")).statusCode, 200);
      const game = partyMatches.matches.get(code);
      if (game) {
        game.simulation.dropshot!.touch(ids[0], 0, 0);
        game.simulation.dropshot!.damage(90, 5, game.simulation.clock);
      }
      const response = await send(2, "/join", { code });
      assert.equal(response.statusCode, 200);
      assert.equal(
        response
          .json()
          .party.members.find((m: { id: string }) => m.id === ids[2]).team,
        "spectator",
      );
      assert.equal(response.json().party.stage, "match");
      if (game) {
        assert.equal(game.players.length, 2);
        assert.ok(game.sessionActive(ids[2]));
        const snapshot = game.snapshot();
        assert.equal(snapshot.dropshot!.tiles![90], "1");
        assert.ok(snapshot.sessionMembers?.some((m) => m.id === ids[2]));
      }
      await send(2, "/leave");
      if (game) assert.equal(game.sessionActive(ids[2]), false);
    } finally {
      await app.close();
    }
  });

test("Dropshot socket clients agree on damage, charge, goal, replay and reset", async () => {
  const { WebSocket } = await import("ws");
  const origin = "http://localhost:5173";
  const { app, partyMatches } = await createApp({
    host: "127.0.0.1",
    port: 0,
    database: ":memory:",
    origins: [origin],
    production: false,
    trustProxy: false,
    authLimit: 100,
    sessionSeconds: 600,
    matchTransport: "server",
  });
  const tokens: string[] = [],
    ids: string[] = [],
    sockets: InstanceType<typeof WebSocket>[] = [];
  const packets: any[][] = [[], [], []];
  const floorViews = [
    new DropshotView(),
    new DropshotView(),
    new DropshotView(),
  ];
  let keepAlive: ReturnType<typeof setInterval> | undefined;
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
  const wait = async (condition: () => boolean) => {
    const start = performance.now();
    while (!condition()) {
      if (performance.now() - start > 12000)
        throw Error("Dropshot socket state timed out");
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const last = (i: number) =>
    packets[i].filter((m) => m.type === "snapshot").at(-1);
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as { port: number };
    for (let i = 0; i < 3; i++) {
      const p = (
        await send(-1, "/session", { preset: starter(), newSession: true })
      ).json();
      tokens.push(p.sessionToken);
      ids.push(p.playerId);
    }
    const code = (await send(0, "/create")).json().party.code;
    await send(1, "/join", { code });
    await send(0, "/stage", { stage: "mode" });
    await send(0, "/gamemode", { gameMode: "dropshot" });
    await send(0, "/mode", { mode: "1v1" });
    await send(0, "/stage", { stage: "teams" });
    await send(0, "/team", { team: 0 });
    await send(1, "/team", { team: 1 });
    const connect = (i: number) =>
      new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(
          "ws://127.0.0.1:" + address.port + "/api/match/socket",
          { headers: { origin } },
        );
        sockets[i] = ws;
        ws.on("error", reject);
        ws.on("open", () =>
          ws.send(JSON.stringify({ type: "auth", token: tokens[i] })),
        );
        ws.on("message", (data) => {
          const m = JSON.parse(data.toString());
          packets[i].push(m);
          if (m.type === "snapshot" && m.dropshot)
            floorViews[i].apply(m.dropshot);
          if (m.type === "connected") resolve();
        });
      });
    await Promise.all([connect(0), connect(1)]);
    keepAlive = setInterval(
      () =>
        sockets.forEach((s) => {
          if (s.readyState === WebSocket.OPEN)
            s.send(JSON.stringify({ type: "ping" }));
        }),
      1000,
    );
    assert.equal((await send(0, "/launch")).statusCode, 200);
    const game = partyMatches.matches.get(code)!;
    await wait(
      () => last(0)?.phase === "playing" && last(1)?.phase === "playing",
    );
    const ds = game.simulation.dropshot!;
    ds.touch(ids[0], 0, 30);
    ds.damage(90, 8, game.simulation.clock);
    await wait(() =>
      [0, 1].every(
        (i) =>
          last(i)?.dropshot.revision === 1 &&
          last(i)?.stats.find((s: any) => s.playerId === ids[0])?.damage === 7,
      ),
    );
    assert.equal((await send(2, "/join", { code })).statusCode, 200);
    await connect(2);
    await wait(() => last(2)?.dropshot?.tiles?.[90] === "1");
    assert.equal(last(2).cars.length, 2);
    ds.touch(ids[0], 0, 30);
    await wait(() =>
      [0, 1, 2].every((i) => last(i)?.dropshot.chargeLevel === 1),
    );
    await wait(() => game.simulation.clock >= ds.events.at(-1)!.time + 0.21);
    ds.energy = 0;
    ds.damage(90, 8, game.simulation.clock);
    const p = ds.arena.tiles[90].translation(),
      s = game.simulation;
    s.lastTouchId = ids[0];
    s.lastTouchTime = s.clock;
    s.cars.forEach((c) => c.body.setEnabled(false));
    s.ball.setTranslation({ x: p.x, y: 4, z: p.z }, true);
    s.ball.setLinvel({ x: 0, y: -8, z: 0 }, true);
    s.ballPose.snap();
    await wait(() => [0, 1, 2].every((i) => last(i)?.phase === "goal"));
    const reset = last(0).reset;
    for (const i of [0, 1, 2]) {
      assert.deepEqual(last(i).score, [1, 0]);
      assert.equal(
        last(i).stats.find((s: any) => s.playerId === ids[0]).damage,
        8,
      );
      assert.equal(
        last(i).stats.find((s: any) => s.playerId === ids[0]).goals,
        1,
      );
    }
    await wait(() =>
      [0, 1, 2].every(
        (i) =>
          last(i)?.phase === "replay" &&
          packets[i].some((m) => m.type === "replay"),
      ),
    );
    const replay = packets[0].find((m) => m.type === "replay");
    for (const i of [0, 1, 2])
      assert.ok(
        packets[i]
          .find((m) => m.type === "replay")
          .clip.dropshot.some((e: any) => e.state.tiles[90] === "2"),
      );
    sockets[2].send(
      JSON.stringify({
        type: "REPLAY_SKIP_REQUEST",
        matchId: game.id,
        replayId: replay.clip.goal.id,
      }),
    );
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(
      game.match.phase,
      "replay",
      "Late watcher cannot vote for drivers",
    );
    for (const i of [0, 1])
      sockets[i].send(
        JSON.stringify({
          type: "REPLAY_SKIP_REQUEST",
          matchId: game.id,
          replayId: replay.clip.goal.id,
        }),
      );
    await wait(() =>
      [0, 1, 2].every(
        (i) => last(i)?.phase === "countdown" && last(i).reset > reset,
      ),
    );
    for (const i of [0, 1, 2]) {
      assert.equal(floorViews[i].tiles, "0".repeat(140));
      assert.ok(
        packets[i].some(
          (m) =>
            m.type === "snapshot" &&
            m.reset > reset &&
            m.dropshot?.tiles === "0".repeat(140),
        ),
        "Each socket received the full reset before subsequent deltas",
      );
      assert.equal(last(i).dropshot.energy, 0);
      assert.equal(
        last(i).stats.find((s: any) => s.playerId === ids[0]).score,
        180,
      );
    }
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    sockets.forEach((s) => s.terminate());
    await app.close();
  }
});
