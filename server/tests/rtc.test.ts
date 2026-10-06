import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { createApp } from "../src/app";
import { configuration } from "../src/config";
import { iceConfiguration } from "../src/rtc-config";
import { starter } from "../../shared/catalog";
import { isArenaId } from "../../shared/arenas";

test("production RTC defaults, LAN compatibility and temporary TURN credentials", () => {
  const production = configuration({
    NODE_ENV: "production",
    FRONTEND_ORIGINS: "https://goofykings.github.io",
  });
  assert.equal(production.matchTransport, "webrtc");
  assert.equal(configuration({}).matchTransport, "server");
  const secret = randomBytes(32).toString("hex");
  const config = configuration({
    TURN_URLS: "turn:relay.example:3478,turns:relay.example:443?transport=tcp",
    TURN_SECRET: secret,
    ICE_POLICY: "relay",
  });
  const ice = iceConfiguration(config, "driver", 1000000);
  assert.equal(ice.relayAvailable, true);
  assert.equal(ice.iceTransportPolicy, "relay");
  assert.equal(ice.iceServers[1].username, "4600:driver");
  assert.equal(
    ice.iceServers[1].credential,
    createHmac("sha1", secret).update("4600:driver").digest("base64"),
  );
  assert.equal(JSON.stringify(ice).includes(secret), false);
  assert.throws(() => configuration({ TURN_URLS: "turn:relay.example" }));
  assert.throws(() => configuration({ ICE_POLICY: "relay" }));
  assert.throws(() => configuration({ STUN_URLS: "https://invalid.example" }));
  assert.throws(() => configuration({ STUN_URLS: "stun:" }));
  assert.throws(() => configuration({ STUN_URLS: "stun:example:70000" }));
});

test("session-bound signaling, party/host isolation, RTC match lifecycle and no backend simulation", async () => {
  const origin = "http://localhost:5173";
  const { app, partyMatches } = await createApp({
    ...configuration({}),
    matchTransport: "webrtc",
    stunUrls: [],
  });
  const clients: { playerId: string; sessionToken: string }[] = [];
  const send = (
    i: number,
    path: string,
    payload = {},
    method: "POST" | "GET" = "POST",
  ) =>
    app.inject({
      method,
      url: "/api/party" + path,
      headers: {
        origin,
        "content-type": "application/json",
        "x-arena-client": "1",
        "x-arena-party": clients[i]?.sessionToken ?? "",
      },
      ...(method === "GET" ? {} : { payload }),
    });
  try {
    for (let i = 0; i < 3; i++)
      clients.push(
        (
          await send(-1, "/session", { preset: starter(), newSession: true })
        ).json(),
      );
    const party = (await send(0, "/create")).json().party;
    assert.equal(party.transport, "webrtc");
    await send(1, "/join", { code: party.code });
    const signal = {
      to: clients[1].playerId,
      connectionId: randomUUID(),
      data: {
        kind: "description",
        description: { type: "offer", sdp: "v=0\r\n" },
      },
    };
    assert.equal(
      (await send(0, "/signal", { ...signal, from: "spoof" })).statusCode,
      400,
    );
    assert.equal(
      (await send(0, "/signal", { ...signal, to: clients[2].playerId }))
        .statusCode,
      403,
    );
    assert.equal(
      (await send(1, "/signal", { ...signal, to: clients[0].playerId }))
        .statusCode,
      403,
    );
    assert.equal((await send(0, "/signal", signal)).statusCode, 200);
    const received = (await send(1, "/signals?after=0", {}, "GET")).json()
      .signals;
    assert.equal(received.length, 1);
    assert.equal(received[0].from, clients[0].playerId);
    assert.equal(received[0].code, party.code);
    assert.equal(
      (await send(0, "/signals?after=0", {}, "GET")).json().signals.length,
      0,
    );
    assert.equal(
      (
        await send(1, "/signals?after=" + received[0].sequence, {}, "GET")
      ).json().signals.length,
      0,
    );
    const ice = (await send(1, "/rtc-config", {}, "GET")).json();
    assert.deepEqual(ice.iceServers, []);
    assert.equal(ice.relayAvailable, false);
    await send(0, "/stage", { stage: "mode" });
    await send(0, "/stage", { stage: "teams" });
    await send(0, "/team", { team: 0 });
    await send(1, "/team", { team: 1 });
    const launched = (await send(0, "/launch")).json().party;
    assert.ok(isArenaId(launched.matchArenaId));
    assert.equal(launched.matchHostId, clients[0].playerId);
    assert.equal(
      partyMatches.matches.size,
      0,
      "The signaling backend must not run WebRTC physics",
    );
    assert.equal((await send(0, "/return")).statusCode, 409);
    assert.equal(
      (
        await send(1, "/rtc-end", {
          matchId: launched.matchId,
          reason: "finished",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await send(0, "/rtc-end", { matchId: "stale", reason: "finished" }))
        .statusCode,
      409,
    );
    assert.equal(
      (
        await send(0, "/rtc-end", {
          matchId: launched.matchId,
          reason: "finished",
        })
      ).statusCode,
      200,
    );
    assert.equal((await send(0, "/return")).json().party.stage, "teams");
    await send(0, "/launch");
    await send(0, "/disconnect");
    const remaining = (await send(1, "", {}, "GET")).json().party;
    assert.equal(remaining.stage, "teams");
    assert.equal(remaining.hostId, clients[1].playerId);
    assert.equal(remaining.matchId, undefined);
  } finally {
    await app.close();
  }
});
