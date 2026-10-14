import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app";
import { starter } from "../../shared/catalog";
import { DEFAULT_MUTATORS as D } from "../../shared/mutators";
import { P } from "../../src/config/physics";
test("server mutators: validated host-only setup, shared party config, authoritative match physics", async () => {
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
  const tokens: string[] = [];
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
    for (let i = 0; i < 2; i++)
      tokens.push(
        (
          await send(-1, "/session", { preset: starter(), newSession: true })
        ).json().sessionToken,
      );
    const code = (await send(0, "/create")).json().party.code;
    await send(1, "/join", { code });
    await send(0, "/stage", { stage: "mode" });
    const mutators = {
      ...D,
      matchLength: "UNLIMITED",
      gravity: "LOW",
      ballSize: "GIGANTIC",
      boostAmount: "NO BOOST",
    };
    assert.equal((await send(1, "/mutators", { mutators })).statusCode, 403);
    assert.equal(
      (
        await send(0, "/mutators", {
          mutators: { ...mutators, gravity: "INVALID" },
        })
      ).statusCode,
      400,
    );
    assert.equal((await send(0, "/mutators", { mutators })).statusCode, 200);
    const state = (
      await app.inject({
        method: "GET",
        url: "/api/party",
        headers: { origin, "x-arena-party": tokens[1] },
      })
    ).json().party;
    assert.deepEqual(state.mutators, mutators);
    assert.equal((await send(0, "/launch")).statusCode, 200);
    const game = partyMatches.matches.get(code)!;
    assert.ok(game);
    assert.deepEqual(game.snapshot().mutators, mutators);
    assert.equal(game.match.timed, false);
    assert.equal(game.simulation.world.gravity.y, -P.gravity * 0.5);
    assert.equal(game.simulation.cars[0].boost, 0);
    assert.equal((await send(0, "/mutators", { mutators: D })).statusCode, 409);
  } finally {
    await app.close();
  }
});
