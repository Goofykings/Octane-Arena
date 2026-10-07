const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { createServer } = require("node:https");
const http = require("node:http");
const { mkdtempSync, readFileSync, rmSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join, extname } = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");

(async () => {
  const directory = mkdtempSync(join(tmpdir(), "arena-party-tls-"));
  let app, proxy, browser;
  const origin = "https://goofykings.github.io";
  try {
    const openssl =
      process.env.OPENSSL_PATH ||
      (process.platform === "win32"
        ? "C:/Program Files/Git/usr/bin/openssl.exe"
        : "openssl");
    execFileSync(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=api.arena.test",
        "-addext",
        "subjectAltName=DNS:api.arena.test",
      ],
      { stdio: "ignore", windowsHide: true },
    );
    const { createApp } = await import(
      pathToFileURL(resolve("server/dist/server/src/app.js")).href
    );
    ({ app } = await createApp({
      host: "0.0.0.0",
      port: 0,
      database: ":memory:",
      production: true,
      origins: [origin],
      trustProxy: false,
      authLimit: 100,
      sessionSeconds: 86400,
    }));
    await app.listen({ host: "0.0.0.0", port: 0 });
    const port = app.server.address().port;
    let offline = false;
    let blockStreams = false;
    const counts = new Map();
    proxy = createServer(
      {
        key: readFileSync(join(directory, "key.pem")),
        cert: readFileSync(join(directory, "cert.pem")),
      },
      (req, res) => {
        counts.set(
          `${req.method} ${req.url}`,
          (counts.get(`${req.method} ${req.url}`) || 0) + 1,
        );
        if (offline || (blockStreams && req.url === "/api/party/events")) {
          res.writeHead(503, {
            "access-control-allow-origin": origin,
            "access-control-allow-credentials": "true",
            "content-type": "application/json",
          });
          res.end(
            JSON.stringify({
              error: {
                message: "Unable to connect to multiplayer server. Try again.",
              },
            }),
          );
          return;
        }
        const upstream = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: `127.0.0.1:${port}` },
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers);
            res.flushHeaders();
            response.pipe(res);
          },
        );
        upstream.on("error", () => {
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        res.on("close", () => upstream.destroy());
        req.pipe(upstream);
      },
    );
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const api = `https://api.arena.test:${proxy.address().port}`;
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: [
        "--enable-unsafe-swiftshader",
        "--no-proxy-server",
        "--host-resolver-rules=MAP api.arena.test 127.0.0.1",
        "--test-third-party-cookie-phaseout",
        // The simulated public origin intentionally reaches a loopback TLS proxy.
        // This exception is test-only; real deployments use a public backend.
        "--disable-features=LocalNetworkAccessChecks",
      ],
    });
    const errors = [];
    const page = async (normalPath = false) => {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 720 },
      });
      context.setDefaultTimeout(20000);
      await context.addInitScript(() =>
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        ),
      );
      // Make the test strictly independent of cross-site cookies.
      await context.route(api + "/**", async (route) => {
        const headers = await route.request().allHeaders();
        delete headers.cookie;
        await route.continue({ headers });
      });
      await context.route(origin + "/**", async (route) => {
        const path = new URL(route.request().url()).pathname.replace(
          /^\/Octane-Arena\//,
          "",
        );
        if (path === "config.json")
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ apiUrl: api }),
          });
        const file = resolve("dist", path || "index.html");
        assert.ok(
          file.startsWith(resolve("dist") + require("node:path").sep),
          "Asset remains inside dist",
        );
        assert.ok(existsSync(file), file);
        const mime = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".woff2": "font/woff2",
          ".ttf": "font/ttf",
          ".svg": "image/svg+xml",
        };
        await route.fulfill({
          contentType: mime[extname(file)] || "application/octet-stream",
          body: readFileSync(file),
        });
      });
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(origin + "/Octane-Arena/" + (normalPath ? "" : "?test"));
      if (normalPath) {
        await p.waitForFunction(
          () =>
            window.octaneArenaNetwork?.diagnostics().partyConnection ===
            "connected",
        );
        return p;
      }
      await p.waitForFunction(
        () =>
          window.__arena?.party.connection === "connected" &&
          !window.__arena.party.busy,
      );
      assert.equal(
        await p.evaluate(() => window.__arena.party.matchConnection.url),
        api.replace("https:", "wss:") + "/api/match/socket",
      );
      return p;
    };
    const host = await page(),
      guest = await page();
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state?.code);
    const code = await host.evaluate(() => window.__arena.party.state.code);
    assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/);
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill("ZZZZZZ");
    await guest.locator("#party-join button[type=submit]").click();
    await guest.waitForFunction(
      () => window.__arena.party.message === "PARTY NOT FOUND",
    );
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    for (const p of [host, guest]) {
      await p.waitForFunction(
        () => window.__arena.party.state?.members.length === 2,
      );
      assert.equal(await p.locator("#party-members .party-avatar").count(), 2);
    }
    assert.deepEqual(
      await host.evaluate(() => window.__arena.party.state),
      await guest.evaluate(() => window.__arena.party.state),
    );
    console.log(
      "PASS simulated Pages HTTPS origin to HTTPS API: actual cross-origin HTTP/SSE, cookie-free Create/Join, member UI and WSS configuration",
    );
    const hostId = await host.evaluate(() => window.__arena.party.playerId);
    const guestId = await guest.evaluate(() => window.__arena.party.playerId);
    await host.waitForFunction(
      (id) => window.__arena.network.rtc.ready(id),
      guestId,
    );
    await guest.waitForFunction(
      (id) => window.__arena.network.rtc.ready(id),
      hostId,
    );
    const polls = counts.get("GET /api/party") || 0;
    await host.waitForTimeout(12000);
    assert.equal(
      counts.get("GET /api/party") || 0,
      polls,
      "Healthy SSE does not poll lobby snapshots",
    );
    const heartbeatDeadline = Date.now() + 15000;
    while (
      (counts.get("POST /api/party/heartbeat") || 0) < 2 &&
      Date.now() < heartbeatDeadline
    )
      await host.waitForTimeout(250);
    assert.ok((counts.get("POST /api/party/heartbeat") || 0) >= 2);
    const act = async (p, name, data = {}) => {
      await p.waitForFunction(() => !window.__arena.party.busy);
      const result = await p.evaluate(
        async ({ name, data }) => ({
          ok: await window.__arena.party.action(name, data),
          message: window.__arena.party.message,
        }),
        { name, data },
      );
      assert.equal(result.ok, true, result.message);
    };
    await act(host, "stage", { stage: "mode" });
    await act(host, "stage", { stage: "teams" });
    await act(host, "team", { team: 0 });
    await act(guest, "team", { team: 1 });
    for (const p of [host, guest])
      await p.evaluate(() => {
        window.qaRender = window.__arena.graphics.render;
        window.__arena.graphics.render = () => {};
      });
    await act(host, "launch");
    for (const p of [host, guest])
      await p.waitForFunction(
        () => window.__arena.network.latest?.phase === "playing",
        null,
        { timeout: 45000, polling: 50 },
      );
    assert.equal(
      await host.evaluate(() => window.__arena.network.latest.matchId),
      await guest.evaluate(() => window.__arena.network.latest.matchId),
    );
    console.log(
      "PASS simulated HTTPS Pages origin: real WebRTC shared match and host physics worker through public signaling API",
    );
    await act(host, "rtc-end", {
      matchId: await host.evaluate(() => window.__arena.network.latest.matchId),
      reason: "finished",
    });
    await act(host, "return");
    await act(host, "stage", { stage: "home" });
    for (const p of [host, guest]) {
      await p.waitForFunction(
        () =>
          window.__arena.ui.root.dataset.screen === "home" &&
          !window.__arena.network.latest,
      );
      await p.evaluate(
        () => (window.__arena.graphics.render = window.qaRender),
      );
    }
    await guest.locator("#party-leave").click();
    await host.waitForFunction(
      () => window.__arena.party.state?.members.length === 1,
    );
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    await host.waitForFunction(
      () => window.__arena.party.state?.members.length === 2,
    );
    await guest.close();
    await host.bringToFront();
    await host.waitForFunction(
      () => window.__arena.party.state?.members.length === 1,
      null,
      { timeout: 60000 },
    );
    console.log(
      "PASS SSE membership updates, presence-only heartbeat, leave/rejoin and browser-close cleanup",
    );
    await host.waitForFunction(() => !window.__arena.party.busy);
    await host.locator("#party-leave").click();
    await host.waitForFunction(
      () => !window.__arena.party.state && !window.__arena.party.busy,
    );
    offline = true;
    await host.locator("#party-create").click();
    await host.waitForFunction(
      () => window.__arena.party.connection === "offline",
    );
    await host.locator("#party-retry").waitFor({ state: "visible" });
    assert.match(
      await host.locator("#party-message").textContent(),
      /Unable to connect/,
    );
    offline = false;
    await host.locator("#party-retry").click();
    await host.waitForFunction(
      () =>
        window.__arena.party.connection === "connected" &&
        !window.__arena.party.busy,
    );
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state?.code);
    const restoredCode = await host.evaluate(
      () => window.__arena.party.state.code,
    );
    offline = true;
    proxy.closeAllConnections();
    await host.waitForFunction(
      () => window.__arena.party.connection === "offline",
    );
    await host.locator("#party-retry").waitFor({ state: "visible" });
    offline = false;
    await host.locator("#party-retry").click();
    await host.waitForFunction(
      () =>
        window.__arena.party.connection === "connected" &&
        !window.__arena.party.busy,
    );
    assert.equal(
      await host.evaluate(() => window.__arena.party.state.code),
      restoredCode,
      "Reconnect preserves the server-owned party",
    );
    blockStreams = true;
    proxy.closeAllConnections();
    const pollsBeforeFallback = counts.get("GET /api/party") || 0;
    const headers = {
      origin,
      "content-type": "application/json",
      "x-arena-client": "1",
    };
    const remote = (
      await app.inject({
        method: "POST",
        url: "/api/party/session",
        headers,
        payload: {
          newSession: true,
          preset: await host.evaluate(() => window.__arena.garage.current),
        },
      })
    ).json();
    await app.inject({
      method: "POST",
      url: "/api/party/join",
      headers: { ...headers, "x-arena-party": remote.sessionToken },
      payload: { code: restoredCode },
    });
    await host.waitForFunction(
      () => window.__arena.party.state?.members.length === 2,
    );
    assert.ok(
      (counts.get("GET /api/party") || 0) > pollsBeforeFallback,
      "Snapshot fallback works when streaming is unavailable",
    );
    console.log(
      "PASS lost-connection retry preserves party; HTTP snapshot fallback works when SSE is unavailable",
    );
    blockStreams = false;
    const normalHost = await page(true),
      normalGuest = await page(true);
    assert.equal(new URL(normalHost.url()).search, "");
    assert.equal(
      await normalHost.evaluate(() => typeof window.__arena),
      "undefined",
    );
    await normalHost.locator("#party-create").click();
    await normalHost.waitForFunction(
      () => !document.getElementById("party-code").hidden,
    );
    const normalCode = (await normalHost.locator("#party-code").textContent())
      .trim()
      .split(/\s+/)
      .pop();
    const joinNormal = async () => {
      await normalGuest.locator("#party-join-open").click();
      await normalGuest.locator("#party-input").fill(normalCode);
      await normalGuest.locator("#party-join button[type=submit]").click();
      for (const p of [normalHost, normalGuest])
        await p.waitForFunction(() =>
          window.octaneArenaNetwork
            .diagnostics()
            .peers.some(
              (peer) =>
                peer.connectionState === "connected" &&
                peer.bidirectionalVerified &&
                Object.values(peer.channels).every((s) => s === "open"),
            ),
        );
    };
    await joinNormal();
    const generation = await normalHost.evaluate(
      () => window.octaneArenaNetwork.diagnostics().peers[0].connectionId,
    );
    for (const p of [normalHost, normalGuest]) {
      assert.equal(await p.locator("#party-members .party-avatar").count(), 2);
      const trace = await p.evaluate(
        () => window.octaneArenaNetwork.diagnostics().peers[0],
      );
      assert.ok(
        trace.probesSent &&
          trace.probesReceived &&
          trace.repliesSent &&
          trace.repliesReceived,
      );
    }
    await normalGuest.locator("#party-leave").click();
    for (const p of [normalHost, normalGuest])
      await p.waitForFunction(
        () =>
          window.octaneArenaNetwork.diagnostics().peers.length === 0 &&
          window.octaneArenaNetwork
            .diagnostics()
            .closedPeers.some((peer) => peer.connectionState === "closed"),
      );
    await joinNormal();
    assert.notEqual(
      await normalHost.evaluate(
        () => window.octaneArenaNetwork.diagnostics().peers[0].connectionId,
      ),
      generation,
    );
    console.log(
      "PASS normal Pages URL without test query: connected peer/open channels, bidirectional ping/reply before gameplay, member UI, leave cleanup and fresh-generation reconnect (two contexts on one machine)",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS unavailable backend error, explicit retry without reload, recovered party creation and no browser exceptions",
    );
  } finally {
    if (browser) await browser.close();
    if (proxy) {
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
    }
    await app?.close();
    // Verified absolute temp directory, created by this harness only.
    assert.ok(
      directory.startsWith(resolve(tmpdir()) + require("node:path").sep),
    );
    rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
