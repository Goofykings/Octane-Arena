import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { starter } from "../../shared/catalog.js";

test("LAN accepts the page hostname without allowing unrelated origins; deployments retain their allowlist", async () => {
  for (const allowSameOrigin of [true, false]) {
    const { app } = await createApp({
      host: "0.0.0.0",
      port: 8090,
      database: ":memory:",
      origins: ["http://127.0.0.1:8090"],
      production: false,
      trustProxy: false,
      authLimit: 50,
      sessionSeconds: 600,
      allowSameOrigin,
    });
    try {
      const send = (origin: string) =>
        app.inject({
          method: "POST",
          url: "/api/party/session",
          headers: {
            host: "arena-pc.local:8090",
            origin,
            "x-arena-client": "1",
            "content-type": "application/json",
          },
          payload: { preset: starter(), newSession: true },
        });
      assert.equal(
        (await send("http://arena-pc.local:8090")).statusCode,
        allowSameOrigin ? 200 : 403,
      );
      assert.equal(
        (await send("http://unrelated.example:8090")).statusCode,
        403,
      );
      assert.equal((await send("http://arena-pc.local:8091")).statusCode, 403);
    } finally {
      await app.close();
    }
  }
});
