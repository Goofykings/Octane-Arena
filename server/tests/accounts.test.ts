import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { configuration, type ServerConfig } from "../src/config.js";
import type { AccountData, AccountSave } from "../../shared/accounts.js";

const origin = "http://127.0.0.1:4179";
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 8787,
  database: ":memory:",
  origins: [origin],
  production: false,
  trustProxy: false,
  authLimit: 100,
  sessionSeconds: 604800,
};
const headers = {
  origin,
  "x-arena-client": "1",
  "content-type": "application/json",
};
const save = (a: AccountData): AccountSave => ({
  revision: a.revision,
  presets: a.presets,
  selected: a.selected,
  settings: a.settings,
  avatarId: a.avatarId as AccountSave["avatarId"],
  titleId: a.titleId as AccountSave["titleId"],
});
test("persistent accounts, validation, authority, independent sessions and backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-api-"));
  const database = join(dir, "accounts.sqlite");
  let instance = await createApp({ ...config, database });
  let app = instance.app;
  try {
    const send = (
      url: string,
      payload: unknown,
      cookie = "",
      method: "POST" | "PUT" = "POST",
    ) => app.inject({ method, url, headers: { ...headers, cookie }, payload });
    for (const payload of [
      { username: "abc", password: "password123" },
      { username: "bad!name", password: "password123" },
      { username: "Driver", password: "short" },
      { username: "x' OR 1=1--", password: "password123" },
      { username: "Driver", password: "x".repeat(129) },
    ])
      assert.equal((await send("/api/auth/register", payload)).statusCode, 400);
    const credentials = {
      username: "Driver_One",
      password: "A normal password! 123",
    };
    const register = await send("/api/auth/register", credentials);
    assert.equal(register.statusCode, 201, register.body);
    let account: AccountData = register.json().account;
    const id = account.id;
    assert.match(id, /^[0-9a-f-]{36}$/);
    assert.equal(account.xp, 0);
    assert.equal(account.level, 1);
    assert.equal(account.owned.body.length, 2);
    assert.equal(account.ratings.length, 3);
    const cookie = String(register.headers["set-cookie"]).split(";")[0];
    assert.match(String(register.headers["set-cookie"]), /HttpOnly/);
    assert.match(String(register.headers["set-cookie"]), /SameSite=Lax/);
    assert.equal(
      (
        await send("/api/auth/register", {
          ...credentials,
          username: "driver_one",
        })
      ).statusCode,
      409,
    );
    const wrong = await send("/api/auth/login", {
        ...credentials,
        password: "incorrect123",
      }),
      unknown = await send("/api/auth/login", {
        ...credentials,
        username: "NoSuchUser",
      });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.body, unknown.body);
    const row = instance.store.db
      .prepare("SELECT password_hash FROM accounts WHERE id=?")
      .get(id)!;
    assert.match(
      String(row.password_hash),
      /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/,
    );
    assert.ok(!register.body.includes("password"));
    assert.ok(
      !JSON.stringify(
        instance.store.db.prepare("SELECT * FROM sessions").all(),
      ).includes(cookie.split("=")[1]),
    );
    assert.equal((await app.inject({ url: "/api/me" })).statusCode, 401);
    for (const extra of [
      { xp: 99999 },
      { level: 99 },
      { owned: { body: ["hacked"] } },
      { ratings: [{ mode: "1v1", rating: 9999 }] },
    ])
      assert.equal(
        (
          await send(
            "/api/me/save",
            { ...save(account), ...extra },
            cookie,
            "PUT",
          )
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await send(
          "/api/me/save",
          { ...save(account), titleId: "skybound" },
          cookie,
          "PUT",
        )
      ).statusCode,
      403,
    );
    const invalid = save(account);
    invalid.settings.camera.fov = 999;
    assert.equal(
      (await send("/api/me/save", invalid, cookie, "PUT")).statusCode,
      400,
    );
    account = (await app.inject({ url: "/api/me", headers: { cookie } })).json()
      .account;
    const data = save(account);
    data.avatarId = "fox";
    data.titleId = "line-runner";
    data.presets[0].body = "vector";
    data.settings.camera.fov = 85;
    const saved = await send("/api/me/save", data, cookie, "PUT");
    assert.equal(saved.statusCode, 200, saved.body);
    account = saved.json().account;
    assert.equal(account.revision, 1);
    assert.equal(
      (await send("/api/me/save", data, cookie, "PUT")).statusCode,
      409,
    );
    const second = await send("/api/auth/login", {
      ...credentials,
      username: "DRIVER_ONE",
    });
    assert.equal(second.statusCode, 200);
    const cookie2 = String(second.headers["set-cookie"]).split(";")[0];
    assert.notEqual(cookie, cookie2);
    assert.equal(second.json().account.avatarId, "fox");
    assert.equal(second.json().account.presets[0].body, "vector");
    await send("/api/auth/logout", {}, cookie);
    assert.equal(
      (await app.inject({ url: "/api/me", headers: { cookie } })).statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ url: "/api/me", headers: { cookie: cookie2 } }))
        .statusCode,
      200,
    );
    await backup(instance.store.db, join(dir, "backup.sqlite"));
    const copy = new DatabaseSync(join(dir, "backup.sqlite"), {
      readOnly: true,
    });
    assert.equal(
      copy.prepare("SELECT avatar_id FROM profiles WHERE account_id=?").get(id)!
        .avatar_id,
      "fox",
    );
    copy.close();
    await app.close();
    instance = await createApp({ ...config, database });
    app = instance.app;
    const restored = await app.inject({
      url: "/api/me",
      headers: { cookie: cookie2 },
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().account.settings.camera.fov, 85);
    assert.equal(restored.json().account.id, id);
    instance.store.db.prepare("UPDATE sessions SET expires_at=0").run();
    assert.equal(
      (await app.inject({ url: "/api/me", headers: { cookie: cookie2 } }))
        .statusCode,
      401,
    );
    assert.ok(
      !readFileSync(database).includes(Buffer.from(credentials.password)),
    );
    instance.store.db.exec("DROP TABLE sessions");
    const fail = await app.inject({
      url: "/api/me",
      headers: { cookie: cookie2 },
    });
    assert.equal(fail.statusCode, 503);
    assert.ok(!fail.body.includes("SQLITE"));
    assert.ok(!fail.body.includes("stack"));
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("CORS, CSRF, malformed input, rate limits and production cookies", async () => {
  const { app } = await createApp({
    ...config,
    production: true,
    origins: ["https://example.github.io"],
    authLimit: 2,
  });
  try {
    const payload = {
      username: "SecureUser",
      password: "test secure password",
    };
    const allowed = { ...headers, origin: "https://example.github.io" };
    for (const h of [
      { ...allowed, origin: "https://evil.test" },
      { ...allowed, origin: "" },
      { ...allowed, "x-arena-client": "" },
    ])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/register",
            headers: h,
            payload,
          })
        ).statusCode,
        403,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/register",
          headers: allowed,
          payload: "{bad",
        })
      ).statusCode,
      400,
    );
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: allowed,
      payload,
    });
    assert.equal(response.statusCode, 201, response.body);
    const cookie = String(response.headers["set-cookie"]);
    for (const pattern of [
      /__Host-oa_session=/,
      /Secure/,
      /HttpOnly/,
      /SameSite=None/,
      /Partitioned/,
      /Path=\//,
    ])
      assert.match(cookie, pattern);
    assert.ok(!cookie.includes("Domain="));
    assert.equal(
      response.headers["access-control-allow-origin"],
      "https://example.github.io",
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/register",
          headers: allowed,
          payload,
        })
      ).statusCode,
      429,
    );
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/me/save",
      headers: {
        origin: "https://example.github.io",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "x-arena-client,content-type",
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers["access-control-allow-credentials"], "true");
    assert.equal((await app.inject({ url: "/api/admin" })).statusCode, 404);
  } finally {
    await app.close();
  }
  assert.throws(() => configuration({ NODE_ENV: "production" }));
  assert.throws(() =>
    configuration({
      NODE_ENV: "production",
      FRONTEND_ORIGINS: "http://example.com",
    }),
  );
  assert.throws(() =>
    configuration({ FRONTEND_ORIGINS: "https://example.com/path" }),
  );
  assert.throws(() => configuration({ FRONTEND_ORIGINS: "*" }));
});
