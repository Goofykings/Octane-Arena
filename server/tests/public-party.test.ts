import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { configuration } from "../src/config.js";
import { starter } from "../../shared/catalog.js";

const origin = "https://goofykings.github.io";
test("silent network loss expires membership and transfers host without SSE renewing presence", async () => {
  const { app } = await createApp(
    configuration({ NODE_ENV: "production", FRONTEND_ORIGINS: origin }),
  );
  const clock = Date.now;
  let now = clock();
  Date.now = () => now;
  const headers = {
    origin,
    "content-type": "application/json",
    "x-arena-client": "1",
  };
  const send = (token: string, path: string, payload = {}) =>
    app.inject({
      method: "POST",
      url: "/api/party" + path,
      headers: { ...headers, "x-arena-party": token },
      payload,
    });
  try {
    const host = (
      await send("", "/session", { newSession: true, preset: starter() })
    ).json();
    const guest = (
      await send("", "/session", { newSession: true, preset: starter() })
    ).json();
    const code = (await send(host.sessionToken, "/create")).json().party.code;
    await send(guest.sessionToken, "/join", { code });
    now += 40000;
    assert.equal(
      (await send(guest.sessionToken, "/heartbeat")).statusCode,
      204,
    );
    now += 10000;
    const remaining = (
      await app.inject({
        method: "GET",
        url: "/api/party",
        headers: { ...headers, "x-arena-party": guest.sessionToken },
      })
    ).json().party;
    assert.equal(remaining.members.length, 1);
    assert.equal(remaining.hostId, guest.playerId);
    assert.equal((await send(host.sessionToken, "/heartbeat")).statusCode, 401);
  } finally {
    Date.now = clock;
    await app.close();
  }
});
test("public production config requires exact origins and honors host/PORT", () => {
  const config = configuration({
    NODE_ENV: "production",
    PORT: "9231",
    FRONTEND_ORIGINS: `${origin},http://localhost:5173`,
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 9231);
  assert.equal(configuration({}).host, "127.0.0.1");
  for (const extra of [
    {},
    { FRONTEND_ORIGINS: "*" },
    { FRONTEND_ORIGINS: origin + "/Octane-Arena/" },
    { FRONTEND_ORIGINS: "http://public.example" },
    { FRONTEND_ORIGINS: origin, PORT: "0" },
  ])
    assert.throws(() => configuration({ NODE_ENV: "production", ...extra }));
});

test("Pages origin: CORS, cookie-free sessions, SSE snapshots, capacity, host transfer and disconnect", async () => {
  const { app } = await createApp(
    configuration({
      NODE_ENV: "production",
      FRONTEND_ORIGINS: `${origin},http://localhost:5173`,
    }),
  );
  await app.listen({ host: "0.0.0.0", port: 0 });
  const address = app.server.address() as { address: string; port: number };
  assert.equal(address.address, "0.0.0.0");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = {
    origin,
    "content-type": "application/json",
    "x-arena-client": "1",
  };
  const send = (
    token: string,
    path: string,
    payload = {},
    method: "GET" | "POST" = "POST",
  ) =>
    app.inject({
      method,
      url: "/api/party" + path,
      headers: { ...headers, "x-arena-party": token },
      ...(method === "GET" ? {} : { payload }),
    });
  const controller = new AbortController();
  try {
    assert.deepEqual(
      (await app.inject({ method: "GET", url: "/health" })).json(),
      { status: "ok" },
    );
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/health" })).statusCode,
      200,
    );
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/party/session",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "content-type,x-arena-client,x-arena-party",
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], origin);
    assert.match(
      String(preflight.headers["access-control-allow-headers"]),
      /X-Arena-Party/i,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/party/session",
          headers: { ...headers, origin: "https://evil.example" },
          payload: {},
        })
      ).statusCode,
      403,
    );
    const clients = [];
    for (let i = 0; i < 5; i++) {
      const r = await send("", "/session", {
        preset: starter(),
        newSession: true,
      });
      assert.equal(r.statusCode, 200);
      assert.match(String(r.headers["set-cookie"]), /Secure/);
      clients.push(r.json());
    }
    const [host, guest] = clients;
    const created = (await send(host.sessionToken, "/create")).json().party;
    assert.match(created.code, /^[A-HJKMNP-Z2-9]{6}$/);
    assert.equal(created.hostId, host.playerId);
    assert.equal(created.maxPlayers, 4);
    const response = await fetch(base + "/api/party/events", {
      headers: { origin, "x-arena-party": host.sessionToken },
      signal: controller.signal,
    });
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    const reader = response.body!.getReader();
    let buffer = "";
    const snapshot = async (members: number) => {
      const deadline = AbortSignal.timeout(5000);
      while (!deadline.aborted) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            deadline.addEventListener(
              "abort",
              () => reject(Error("Missing SSE update")),
              { once: true },
            ),
          ),
        ]);
        assert.equal(chunk.done, false);
        buffer += new TextDecoder().decode(chunk.value);
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (event.startsWith("data: ")) {
            const state = JSON.parse(event.slice(6));
            if (state.party?.members.length === members) return state.party;
          }
        }
      }
      throw Error("Missing snapshot");
    };
    await snapshot(1);
    assert.equal(
      (await send(guest.sessionToken, "/join", { code: "!!!!" })).statusCode,
      400,
    );
    assert.equal(
      (await send(guest.sessionToken, "/join", { code: "ZZZZZZ" })).statusCode,
      404,
    );
    const joined = (
      await send(guest.sessionToken, "/join", { code: created.code })
    ).json().party;
    assert.deepEqual((await snapshot(2)).members, joined.members);
    assert.equal(
      (await send(guest.sessionToken, "/join", { code: created.code })).json()
        .party.members.length,
      2,
      "Repeated joins do not duplicate a member",
    );
    for (let i = 2; i < 4; i++)
      await send(clients[i].sessionToken, "/join", { code: created.code });
    assert.equal(
      (
        await send(clients[4].sessionToken, "/join", { code: created.code })
      ).json().error.message,
      "PARTY FULL",
    );
    assert.equal(
      (await send(guest.sessionToken, "/heartbeat")).statusCode,
      204,
    );
    await send(clients[2].sessionToken, "/leave");
    assert.equal(
      (await send(guest.sessionToken, "", {}, "GET")).json().party.members
        .length,
      3,
    );
    await send(host.sessionToken, "/disconnect");
    const remaining = (await send(guest.sessionToken, "", {}, "GET")).json()
      .party;
    assert.equal(remaining.members.length, 2);
    assert.equal(remaining.hostId, guest.playerId);
    await send(guest.sessionToken, "/leave");
    await send(clients[3].sessionToken, "/leave");
    assert.equal(
      (await send(clients[4].sessionToken, "/join", { code: created.code }))
        .statusCode,
      404,
    );
    for (const allowed of [origin, "http://localhost:5173"]) {
      const socket = new WebSocket(
        base.replace("http:", "ws:") + "/api/match/socket",
        { headers: { origin: allowed } },
      );
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      socket.close();
    }
    const socket = new WebSocket(
      base.replace("http:", "ws:") + "/api/match/socket",
      { headers: { origin: "https://evil.example" } },
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        socket.close();
        reject(Error("Disallowed WS origin accepted"));
      });
      socket.once("error", (error) => {
        assert.match(error.message, /403/);
        resolve();
      });
    });
  } finally {
    controller.abort();
    await app.close();
  }
});
