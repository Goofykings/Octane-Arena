import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { starter } from "../../shared/catalog.js";
import { validPartyCode } from "../../shared/party.js";
const origin = "http://127.0.0.1:4186",
  headers = {
    origin,
    "x-arena-client": "1",
    "content-type": "application/json",
  };
test("authoritative party capacity, ownership, appearance, kick, leave and stable codes", async () => {
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
  try {
    const clients: { cookie: string; id: string }[] = [];
    const send = (
      client: number,
      path: string,
      payload: unknown = {},
      method: "POST" | "GET" | "PUT" = "POST",
    ) =>
      app.inject({
        method,
        url: "/api/party" + path,
        headers: { ...headers, cookie: clients[client]?.cookie ?? "" },
        ...(method === "GET" ? {} : { payload }),
      });
    for (let i = 0; i < 5; i++) {
      const r = await send(-1, "/session", {
        preset: { ...starter(), body: i % 2 ? "vector" : "ion" },
      });
      assert.equal(r.statusCode, 200);
      clients.push({
        cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
        id: r.json().playerId,
      });
    }
    assert.equal(new Set(clients.map((c) => c.id)).size, 5);
    assert.equal((await send(-1, "/create")).statusCode, 401);
    const created = (await send(0, "/create")).json(),
      code = created.party.code;
    assert.ok(validPartyCode(code) && code.length === 6);
    assert.equal(created.party.hostId, clients[0].id);
    assert.equal((await send(0, "/create")).json().party.code, code);
    assert.equal((await send(1, "/join", { code: "O0I1L" })).statusCode, 400);
    assert.equal(
      (await send(1, "/join", { code: "ZZZZZZ" })).json().error.message,
      "PARTY NOT FOUND",
    );
    for (let i = 1; i < 4; i++)
      assert.equal(
        (
          await send(i, "/join", { code: " " + code.toLowerCase() + " " })
        ).json().party.members.length,
        i + 1,
      );
    assert.equal(
      (await send(1, "/ready", { ready: true })).json().party.members[1].ready,
      true,
    );
    assert.equal((await send(1, "/mode", { mode: "2v2" })).statusCode, 403);
    assert.equal(
      (await send(0, "/mode", { mode: "2v2" })).json().party.mode,
      "2v2",
    );
    assert.equal((await send(2, "/team", { team: 0 })).statusCode, 200);
    assert.equal(
      (await send(3, "/team", { team: 0 })).json().error.message,
      "TEAM FULL",
    );
    assert.equal((await send(3, "/team", { team: 1 })).statusCode, 200);
    await send(2, "/ready", { ready: true });
    assert.equal(
      (await send(0, "", {}, "GET")).json().party.members[2].ready,
      true,
    );
    await send(0, "/mode", { mode: "1v1" });
    assert.equal(
      (await send(2, "", {}, "GET")).json().party.members[2].team,
      null,
    );
    assert.equal((await send(2, "/ready", { ready: true })).statusCode, 409);
    assert.equal((await send(2, "/team", { team: 3 })).statusCode, 400);
    assert.equal((await send(1, "/stage", { stage: "mode" })).statusCode, 403);
    assert.equal((await send(0, "/stage", { stage: "teams" })).statusCode, 409);
    assert.equal(
      (await send(0, "/stage", { stage: "mode" })).json().party.stage,
      "mode",
    );
    assert.equal(
      (await send(0, "/stage", { stage: "teams" })).statusCode,
      409,
      "four players cannot fit 1v1",
    );
    await send(0, "/mode", { mode: "2v2" });
    const lobby = (await send(0, "/stage", { stage: "teams" })).json().party;
    assert.equal(lobby.stage, "teams");
    assert.ok(lobby.members.every((m: { team: unknown }) => m.team === null));
    assert.equal((await send(0, "/mode", { mode: "1v1" })).statusCode, 409);
    await send(0, "/stage", { stage: "mode" });
    await send(0, "/mode", { mode: "2v2bots" });
    assert.equal(
      (await send(1, "/team", { team: 1 })).statusCode,
      409,
      "orange reserved for bots",
    );
    assert.equal(
      (await send(0, "/stage", { stage: "teams" })).statusCode,
      409,
      "bot mode has only two human slots",
    );
    await send(0, "/mode", { mode: "1v1" });
    await send(0, "/stage", { stage: "home" });
    const extra = await send(0, "/session", {
      preset: starter(),
      newSession: true,
    });
    assert.notEqual(
      extra.json().playerId,
      clients[0].id,
      "new tab does not inherit cookie identity",
    );
    const token = extra.json().sessionToken;
    const own = await app.inject({
      method: "GET",
      url: "/api/party",
      headers: {
        ...headers,
        "x-arena-party": token,
        cookie: clients[0].cookie,
      },
    });
    assert.equal(
      own.json().playerId,
      extra.json().playerId,
      "tab token takes precedence over shared cookies",
    );
    assert.equal(
      (await send(4, "/join", { code })).json().error.message,
      "PARTY FULL",
    );
    assert.equal(
      (await send(1, "/kick", { playerId: clients[2].id })).statusCode,
      403,
    );
    assert.equal(
      (await send(0, "/kick", { playerId: clients[0].id })).statusCode,
      400,
    );
    const preset = {
      ...starter(),
      body: "vector",
      wheels: "disc",
      boost: "ember",
      blue: "#138dba",
    };
    assert.equal(
      (await send(2, "/appearance", { preset }, "PUT")).statusCode,
      200,
    );
    let state = (await send(0, "", {}, "GET")).json();
    assert.deepEqual(state.party.members[2].preset, preset);
    assert.equal(state.party.code, code);
    assert.equal(
      (await send(0, "/kick", { playerId: clients[1].id })).statusCode,
      200,
    );
    const kicked = (await send(1, "", {}, "GET")).json();
    assert.equal(kicked.party, null);
    assert.equal(kicked.notice, "YOU WERE REMOVED FROM THE PARTY");
    assert.equal((await send(4, "/join", { code })).statusCode, 200);
    await send(0, "/leave");
    state = (await send(2, "", {}, "GET")).json();
    assert.equal(state.party.hostId, clients[2].id);
    assert.equal(state.party.code, code);
    await send(4, "/disconnect");
    assert.equal((await send(2, "", {}, "GET")).json().party.members.length, 2);
    await send(2, "/stage", { stage: "mode" });
    await send(2, "/mode", { mode: "2v2bots" });
    await send(2, "/stage", { stage: "teams" });
    assert.equal((await send(2, "/team", { team: 0 })).statusCode, 200);
    assert.equal((await send(3, "/team", { team: 0 })).statusCode, 200);
    assert.equal((await send(4, "/join", { code })).statusCode, 409);
    await send(2, "/stage", { stage: "mode" });
    await send(2, "/mode", { mode: "1v1" });
    await send(2, "/stage", { stage: "teams" });
    const competing = await Promise.all([
      send(2, "/team", { team: 0 }),
      send(3, "/team", { team: 0 }),
    ]);
    assert.deepEqual(competing.map((r) => r.statusCode).sort(), [200, 409]);
    for (const i of [2, 3]) await send(i, "/leave");
    assert.equal((await send(1, "/join", { code })).statusCode, 404);
    assert.notEqual((await send(0, "/create")).json().party.code, code);
    assert.equal(
      (
        await send(
          0,
          "/appearance",
          { preset: { ...starter(), body: "forged" } },
          "PUT",
        )
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});
