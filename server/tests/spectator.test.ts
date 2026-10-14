import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
import { starter } from "../../shared/catalog";
for (const transport of ["server", "webrtc"] as const)
  test("partial teams and spectator lifecycle: " + transport, async () => {
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
      for (let i = 0; i < 4; i++) {
        const r = (
          await send(-1, "/session", { preset: starter(), newSession: true })
        ).json();
        tokens.push(r.sessionToken);
        ids.push(r.playerId);
      }
      const code = (await send(0, "/create")).json().party.code;
      for (let i = 1; i < 4; i++)
        assert.equal((await send(i, "/join", { code })).statusCode, 200);
      await send(0, "/stage", { stage: "mode" });
      await send(0, "/mode", { mode: "1v1" });
      assert.equal(
        (await send(0, "/stage", { stage: "teams" })).statusCode,
        200,
      );
      await send(0, "/team", { team: 0 });
      assert.equal((await send(0, "/launch")).statusCode, 409);
      await send(1, "/team", { team: 1 });
      assert.equal((await send(2, "/team", { team: 0 })).statusCode, 409);
      assert.equal(
        (await send(2, "/team", { team: "spectator" })).statusCode,
        200,
      );
      const state = (await send(0, "/launch")).json().party;
      assert.equal(state.stage, "match");
      assert.equal(state.members[3].team, "spectator");
      const game = partyMatches.matches.get(code);
      if (transport === "server") {
        assert.ok(game);
        assert.equal(game.simulation.cars.length, 2);
        assert.equal(game.snapshot().stats?.length, 2);
        assert.equal(game.accept(ids[2], 1, {}), false);
        assert.ok(game.acceptChat(ids[2], "Spectator chat").message);
      }
      await send(2, "/leave");
      if (transport === "server") {
        assert.equal(partyMatches.matches.get(code), game);
        assert.equal(game!.sessionActive(ids[2]), false);
        assert.ok(
          game!.sessionMembers.some((m) => m.id === ids[2]),
          "chat retains validated sender metadata",
        );
        assert.ok(game!.acceptChat(ids[2], "left watcher").error);
      } else {
        assert.equal(
          (
            await app.inject({
              method: "GET",
              url: "/api/party",
              headers: { origin, "x-arena-party": tokens[0] },
            })
          ).json().party.stage,
          "match",
        );
      }
      await send(1, "/leave");
      if (game) assert.equal(partyMatches.matches.has(code), false);
    } finally {
      await app.close();
    }
  });
