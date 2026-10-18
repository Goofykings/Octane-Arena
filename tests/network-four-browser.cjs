const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8286);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: [
        "--enable-unsafe-swiftshader",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });
    const pages = [],
      errors = [];
    for (let i = 0; i < 4; i++) {
      const context = await browser.newContext({
        viewport: { width: 800, height: 450 },
      });
      context.setDefaultTimeout(90000);
      await context.addInitScript((i) => {
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
        localStorage.setItem(
          "octane-arena-profile",
          JSON.stringify({
            profileVersion: 1,
            localPlayerId: crypto.randomUUID(),
            name: "Four Pilot " + i,
            avatarId: "helmet",
          }),
        );
        document.hasFocus = () => true;
        Object.defineProperty(document, "hidden", { get: () => false });
      }, i);
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(server.url);
      await page.waitForFunction(() => window.__arena);
      pages.push(page);
    }
    async function action(p, name, data = {}) {
      await p.waitForFunction(() => !__arena.party.busy);
      const r = await p.evaluate(
        async ({ name, data }) => ({
          ok: await __arena.party.action(name, data),
          message: __arena.party.message,
        }),
        { name, data },
      );
      assert.ok(r.ok, name + ": " + r.message);
    }
    const host = pages[0];
    await action(host, "create");
    const code = await host.evaluate(() => __arena.party.state.code);
    for (const p of pages.slice(1)) await action(p, "join", { code });
    for (const p of pages)
      await p.waitForFunction(
        () =>
          __arena.party.state.members.length === 4 &&
          octaneArenaNetwork
            .diagnostics()
            .peers.every((p) => p.bidirectionalVerified),
      );
    await action(host, "stage", { stage: "mode" });
    await action(host, "mode", { mode: "2v2" });
    await action(host, "stage", { stage: "teams" });
    for (let i = 0; i < 4; i++)
      await action(pages[i], "team", { team: i < 2 ? 0 : 1 });
    await action(host, "launch");
    for (const p of pages)
      await p.waitForFunction(
        () =>
          __arena.networkView &&
          __arena.network.latest?.phase === "playing" &&
          !__arena.matchLoader.active,
      );
    const ids = await Promise.all(
      pages.map((p) => p.evaluate(() => __arena.party.playerId)),
    );
    assert.equal(new Set(ids).size, 4);
    await host.evaluate(() => {
      __arena.input.keys.add(__arena.input.bindings.throttle);
      __arena.input.keys.add(__arena.input.bindings.boost);
    });
    await pages[1].evaluate(() =>
      __arena.network.testNetwork.configure({
        latencyMs: 100,
        jitterMs: 25,
        loss: 0.05,
      }),
    );
    await host.waitForTimeout(2500);
    const diagnostics = await Promise.all(
      pages.map((p) =>
        p.evaluate(() => ({
          metrics: octaneArenaNetwork.diagnostics(),
          ids: __arena.network.latest.cars.map((c) => c.id),
          prediction: !!__arena.networkView.prediction,
          local: __arena.networkView.prediction.car.id,
          pending: __arena.networkView.prediction.pendingCount,
          match: __arena.network.latest.matchId,
          finite: __arena.networkView.cars.every((c) =>
            c.position.toArray().every(Number.isFinite),
          ),
        })),
      ),
    );
    for (let i = 0; i < 4; i++) {
      const d = diagnostics[i];
      assert.deepEqual([...d.ids].sort(), [...ids].sort());
      assert.ok(d.prediction && d.finite);
      assert.equal(d.local, ids[i]);
      assert.ok(d.metrics.snapshotReceiveHz > 15);
      assert.ok(d.metrics.bufferLength <= 32);
      assert.equal(d.match, diagnostics[0].match);
      assert.ok(d.pending <= 120);
    }
    await host.evaluate(() => __arena.input.clear());
    await action(pages[3], "leave");
    for (const p of pages.slice(0, 3))
      await p.waitForFunction(
        () =>
          __arena.party.state.members.length === 3 &&
          __arena.party.state.stage !== "match",
      );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      ".tools/network-four-browser.json",
      JSON.stringify(diagnostics, null, 2),
    );
    console.log(
      "PASS four independent real PeerJS players, host authority, local prediction per ID, shared 2v2, 100ms/jitter/loss, bounded buffers and leave cleanup",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
