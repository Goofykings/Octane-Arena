import assert from "node:assert/strict";
import { backendEndpoints } from "../src/game/backend";

for (const origin of [
  "http://172.20.10.2:8090",
  "http://arena-pc.local:8091",
  "http://localhost:8090",
  "https://arena.example",
  "http://[::1]:8090",
]) {
  const endpoints = backendEndpoints(
    { lan: true, apiUrl: "/" },
    "https://other.example/api",
    origin,
  );
  assert.equal(endpoints.apiUrl, origin);
  assert.equal(endpoints.websocketUrl, origin.replace(/^http/, "ws"));
}
assert.deepEqual(
  backendEndpoints({}, "https://api.example/base/", "https://user.github.io"),
  {
    apiUrl: "https://api.example/base",
    websocketUrl: "wss://api.example/base",
  },
);
assert.equal(
  backendEndpoints(
    { apiUrl: "https://runtime.example" },
    "https://configured.example",
    "https://user.github.io",
  ).apiUrl,
  "https://configured.example",
);
assert.equal(
  backendEndpoints({ apiUrl: "/" }, undefined, "http://arena-pc:8090").apiUrl,
  "http://arena-pc:8090",
);
assert.equal(
  backendEndpoints({}, undefined, "https://user.github.io").apiUrl,
  "",
);
assert.equal(
  backendEndpoints(
    {},
    undefined,
    "http://localhost:5173",
    "http://127.0.0.1:8787",
  ).apiUrl,
  "http://127.0.0.1:8787",
);
assert.throws(() =>
  backendEndpoints(
    {},
    "https://user:secret@api.example",
    "https://user.github.io",
  ),
);
for (const address of [
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://192.168.1.5:8090",
  "ws://api.example",
  "https://api.example?token=secret",
]) {
  assert.throws(() =>
    backendEndpoints({}, address, "https://goofykings.github.io"),
  );
}
console.log(
  "PASS LAN page-origin precedence, host/port preservation, WebSocket scheme, deployment override and Guest defaults",
);
