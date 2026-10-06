import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { configuration } from "../src/config.js";
test("online account/auth routes are removed; parties remain available", async () => {
  const origin = "http://127.0.0.1:4179";
  const { app } = await createApp({
    ...configuration({}),
    database: ":memory:",
    origins: [origin],
    production: false,
  });
  try {
    for (const [method, url] of [
      ["POST", "/api/auth/register"],
      ["POST", "/api/auth/login"],
      ["POST", "/api/auth/logout"],
      ["GET", "/api/me"],
      ["PUT", "/api/me/save"],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: {
          origin,
          "x-arena-client": "1",
          "content-type": "application/json",
        },
        ...(method === "GET" ? {} : { payload: {} }),
      });
      assert.equal(response.statusCode, 404, url);
    }
    assert.equal(
      (await app.inject({ method: "GET", url: "/api/health" })).statusCode,
      200,
    );
  } finally {
    await app.close();
  }
});
