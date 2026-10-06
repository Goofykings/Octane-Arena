import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLan } from "../src/lan.js";

test("LAN serves a production Pages build and same-host config without rebuilding for root", async () => {
  // npm --prefix server test runs in server/; the LAN host serves the root build.
  const previousDirectory = process.cwd();
  process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
  const html = readFileSync(resolve("dist/index.html"), "utf8");
  const script = html.match(/<script[^>]*\ssrc="([^"]*\/assets\/[^"]+)"/)![1];
  const asset = new URL(script, "http://localhost").pathname;
  const prefix = asset.slice(0, asset.lastIndexOf("/assets/") + 1);
  const { app } = await startLan(8097, ":memory:");
  try {
    for (const url of ["/", prefix])
      assert.equal((await app.inject({ method: "GET", url })).statusCode, 200);
    const response = await app.inject({ method: "GET", url: asset });
    assert.equal(response.statusCode, 200);
    assert.ok(response.headers["content-type"]?.includes("javascript"));
    for (const url of new Set(["/config.json", prefix + "config.json"])) {
      const config = await app.inject({ method: "GET", url });
      assert.equal(config.statusCode, 200);
      assert.deepEqual(config.json(), { lan: true, apiUrl: "/" });
    }
  } finally {
    await app.close();
    process.chdir(previousDirectory);
  }
});
