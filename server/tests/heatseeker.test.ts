import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
import { starter } from "../../shared/catalog";
const origin = "http://localhost:5173";
for (const transport of ["server", "webrtc"] as const)
  test("Host-only Match Setup and Heatseeker " + transport, async () => {
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
    const tokens: string[] = [];
    const send = (
      client: number,
      path: string,
      payload: unknown = {},
      method: "POST" | "GET" = "POST",
    ) =>
      app.inject({
        method,
        url: "/api/party" + path,
        headers: {
          origin,
          "x-arena-client": "1",
          "x-arena-party": tokens[client] ?? "",
        },
        ...(method === "POST" ? { payload } : {}),
      });
    try {
      for (let i = 0; i < 4; i++)
        tokens.push(
          (
            await send(-1, "/session", { preset: starter(), newSession: true })
          ).json().sessionToken,
        );
      const created = (await send(0, "/create")).json();
      assert.equal(created.party.gameMode, "soccar");
      await send(1, "/join", { code: created.party.code });
      await send(0, "/stage", { stage: "mode" });
      assert.equal(
        (await send(1, "/gamemode", { gameMode: "heatseeker" })).statusCode,
        403,
      );
      assert.equal((await send(1, "/launch")).statusCode, 403);
      assert.equal(
        (await send(0, "/gamemode", { gameMode: "invalid" })).statusCode,
        400,
      );
      assert.equal(
        (await send(0, "/gamemode", { gameMode: "heatseeker" })).statusCode,
        200,
      );
      assert.equal(
        (await send(1, "", "", "GET")).json().party.gameMode,
        "heatseeker",
      );
      const launch = (await send(0, "/launch")).json().party;
      assert.equal(launch.stage, "match");
      assert.equal(launch.gameMode, "heatseeker");
      assert.ok(launch.matchArenaId);
      assert.deepEqual(
        launch.members.map((m: { team: number }) => m.team).sort(),
        [0, 1],
      );
      const peer = (await send(1, "", {}, "GET")).json().party;
      assert.equal(peer.matchId, launch.matchId);
      assert.equal(peer.matchArenaId, launch.matchArenaId);
      assert.equal(
        (await send(0, "/gamemode", { gameMode: "soccar" })).statusCode,
        409,
      );
      if (transport === "server") {
        const game = partyMatches.matches.get(launch.code)!;
        assert.equal(game.gameMode, "heatseeker");
        assert.equal(game.snapshot().heatseeker!.active, false);
        partyMatches.stop(launch.code);
      } else {
        assert.equal(partyMatches.matches.size, 0);
        await send(0, "/rtc-end", {
          matchId: launch.matchId,
          reason: "finished",
        });
        await send(0, "/return");
      }
      await send(0, "/stage", { stage: "mode" });
      await send(0, "/mode", { mode: "2v2bots" });
      const bots = (await send(0, "/launch")).json().party;
      assert.equal(bots.mode, "2v2bots");
      assert.ok(bots.members.every((m: { team: number }) => m.team === 0));
      if (transport === "server") {
        const game = partyMatches.matches.get(bots.code)!;
        assert.equal(game.players.length, 4);
        assert.equal(
          game.players.filter((p) => p.controller === "bot").length,
          2,
        );
        partyMatches.stop(bots.code);
      } else {
        await send(0, "/rtc-end", {
          matchId: bots.matchId,
          reason: "finished",
        });
        await send(0, "/return");
      }
      await send(0, "/stage", { stage: "mode" });
      await send(0, "/mode", { mode: "2v2" });
      assert.equal(
        (await send(0, "/launch")).statusCode,
        409,
        "Need enough humans; never start divergent rosters",
      );
      for (const client of [2, 3])
        await send(client, "/join", { code: created.party.code });
      await send(0, "/gamemode", { gameMode: "soccar" });
      const four = (await send(0, "/launch")).json().party;
      assert.equal(four.stage, "match");
      assert.equal(
        four.members.filter((m: { team: number }) => m.team === 0).length,
        2,
      );
      assert.equal(
        four.members.filter((m: { team: number }) => m.team === 1).length,
        2,
      );
      assert.equal(four.gameMode, "soccar");
    } finally {
      await app.close();
    }
  });
